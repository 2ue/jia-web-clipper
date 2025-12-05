import { join, dirname } from 'path';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { nanoid } from 'nanoid';
import config from '../utils/config.js';
import logger from '../utils/logger.js';
import QueueManager from './queue-manager.js';
import InFlightRegistry from './inflight-registry.js';
import cacheIndex from './cache-index.js';
import storageDriver from '../downloads/storage-driver.js';
import fetchWorker, { DownloadError } from '../downloads/fetch-worker.js';
import MetadataBuilder from '../downloads/metadata-builder.js';
import pathGuard from '../security/path-guard.js';

class JobService {
  constructor() {
    this.jobs = new Map();
    this.queueManager = new QueueManager();
    this.inflightRegistry = new InFlightRegistry();
    this.metadataBuilder = new MetadataBuilder();
    this.nextPollMs = 1500;
    this.jobsDir = config.get('paths.jobsDir');
    this.ensureJobsDir();
    this.loadPersistedJobs();
    this.heartbeatTimer = setInterval(() => this.refreshHeartbeats(), 5000);
    this.queueReasonTimer = setInterval(() => this.syncQueueReasons(), 500);
  }

  ensureJobsDir() {
    if (!existsSync(this.jobsDir)) {
      mkdirSync(this.jobsDir, { recursive: true });
    }
  }

  loadPersistedJobs() {
    try {
      const files = existsSync(this.jobsDir) ? readdirSync(this.jobsDir) : [];
      for (const file of files) {
        if (!file.endsWith('.json')) {
          continue;
        }
        const jobPath = join(this.jobsDir, file);
        try {
          const parsed = JSON.parse(readFileSync(jobPath, 'utf-8'));
          if (['running', 'queued'].includes(parsed.status)) {
            parsed.status = 'failed';
            parsed.errorMessage = 'Server restarted during execution';
            parsed.results = parsed.results?.map(res => {
              if (res.status === 'running' || res.status === 'queued') {
                return {
                  ...res,
                  status: 'failed',
                  errorCode: 'SERVER_RESTART',
                  errorMessage: 'Server restarted before completion'
                };
              }
              return res;
            }) || [];
          }
          this.jobs.set(parsed.id, parsed);
        } catch (error) {
          logger.warn('Failed to load job file', { file: jobPath, error: error.message });
        }
      }
    } catch (error) {
      logger.error('Failed to load persisted jobs', { error: error.message });
    }
  }

  refreshHeartbeats() {
    const now = new Date().toISOString();
    for (const job of this.jobs.values()) {
      if (['queued', 'running'].includes(job.status)) {
        job.heartbeatAt = now;
        this.persistJob(job);
      }
    }
  }

  syncQueueReasons() {
    for (const job of this.jobs.values()) {
      if (!['queued', 'running'].includes(job.status)) {
        continue;
      }
      let jobQueueReason = null;
      for (const resource of job.results) {
        if (resource.status === 'queued' && resource.queueTaskId) {
          const task = this.queueManager.getTask(resource.queueTaskId);
          if (task) {
            resource.queueReason = task.queueReason;
            if (!jobQueueReason && task.queueReason) {
              jobQueueReason = task.queueReason;
            }
          }
        }
      }
      job.queueReason = jobQueueReason;
    }
  }

  validatePayload(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Request body must be an object');
    }

    const { resources, saveDir, docPath, relativeTo, relativeProfile = 'default' } = payload;

    if (!Array.isArray(resources) || resources.length === 0) {
      throw new Error('resources must be a non-empty array');
    }

    for (const resource of resources) {
      if (!resource.url || typeof resource.url !== 'string') {
        throw new Error('Each resource must include a valid url');
      }
    }

    if (!saveDir || typeof saveDir !== 'string') {
      throw new Error('saveDir is required');
    }

    // 验证 docPath 是否在白名单内 (如果提供)
    if (docPath) {
      pathGuard.validatePath(docPath, relativeProfile);
    }

    if (relativeTo) {
      pathGuard.validatePath(relativeTo, relativeProfile);
    }

    return {
      resources,
      saveDir,
      docPath: docPath || null,
      relativeTo: relativeTo || null,
      relativeProfile,
      priority: payload.priority || 0
    };
  }

  deriveFilename(resource, index) {
    if (resource.filename) {
      return resource.filename;
    }

    try {
      const parsed = new URL(resource.url);
      const pathname = parsed.pathname.split('/').filter(Boolean);
      if (pathname.length > 0) {
        const candidate = pathname[pathname.length - 1];
        if (candidate) {
          return candidate;
        }
      }
    } catch (error) {
      logger.warn('Failed to derive filename from URL', { url: resource.url, error: error.message });
    }

    return `resource-${index + 1}.bin`;
  }

  async createJob(payload) {
    const normalized = this.validatePayload(payload);
    const jobId = `job_${Date.now()}_${nanoid(6)}`;

    const job = {
      id: jobId,
      status: 'queued',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      queueReason: null,
      options: normalized,
      stats: {
        total: normalized.resources.length,
        completed: 0,
        failed: 0,
        running: 0,
        queued: 0
      },
      results: []
    };

    normalized.resources.forEach(resource => {
      const index = job.results.length;
      const filename = this.deriveFilename(resource, index);
      const targetPath = storageDriver.prepareSavePath(normalized.saveDir, filename, normalized.relativeProfile);
      const relativePaths = storageDriver.calculateRelativePaths(targetPath, normalized.relativeTo, normalized.docPath);
      const urlHash = cacheIndex.hashUrl(resource.url);

      const resourceEntry = {
        id: `${jobId}-res-${index}`,
        url: resource.url,
        filename,
        urlHash,
        targetPath,
        status: 'queued',
        queueTaskId: null,
        queueReason: null,
        error: null,
        retryCount: 0,
        relativePath: relativePaths.relativePath,
        relativePathFromDoc: relativePaths.relativePathFromDoc
      };

      const cachePath = cacheIndex.lookup(urlHash);
      if (cachePath) {
        const samePath = cachePath === targetPath;
        try {
          const storageResult = samePath
            ? storageDriver.handleCacheHitSamePath(cachePath, normalized.relativeTo, normalized.docPath)
            : storageDriver.handleCacheHitDifferentPath(cachePath, targetPath, normalized.relativeTo, normalized.docPath);

          cacheIndex.update(urlHash, storageResult.absolutePath);

          const metadata = this.metadataBuilder.buildSuccess({
            resource: resourceEntry,
            storage: storageResult,
            cacheDetails: {
              cacheHit: true,
              copiedFromCache: !samePath,
              fromPath: samePath ? null : cachePath,
              copyMethod: samePath ? null : storageResult.copyMethod
            }
          });

          resourceEntry.status = 'success';
          resourceEntry.result = metadata;
          job.stats.completed += 1;
        } catch (error) {
          logger.warn('Failed to reuse cache entry', { error: error.message, url: resource.url });
          this.scheduleDownload(job, resourceEntry);
        }
      } else {
        this.scheduleDownload(job, resourceEntry);
      }

      job.results.push(resourceEntry);
    });

    this.updateJobStatus(job);
    this.jobs.set(jobId, job);
    this.persistJob(job);
    return this.serializeJob(job);
  }

  scheduleDownload(job, resourceEntry) {
    job.stats.queued += 1;
    const queueTask = this.queueManager.addTask({
      id: resourceEntry.id,
      url: resourceEntry.url,
      priority: job.options.priority,
      metadata: { jobId: job.id, resourceId: resourceEntry.id },
      execute: () => this.executeDownload(job, resourceEntry)
    });

    resourceEntry.queueTaskId = queueTask.id;

    queueTask.promise
      .then(result => {
        this.handleResourceSuccess(job, resourceEntry, result);
      })
      .catch(error => {
        this.handleResourceFailure(job, resourceEntry, error);
      });
  }

  async executeDownload(job, resourceEntry) {
    this.markResourceRunning(job, resourceEntry);
    const abortController = new AbortController();
    resourceEntry.abortController = abortController;

    const { isPrimary, promise } = this.inflightRegistry.run(resourceEntry.urlHash, async () => {
      const downloadInfo = await fetchWorker.download({ url: resourceEntry.url }, { signal: abortController.signal });
      const storageResult = storageDriver.handleDownloadResult(
        downloadInfo.tempPath,
        resourceEntry.targetPath,
        job.options.relativeTo,
        job.options.docPath
      );
      cacheIndex.update(resourceEntry.urlHash, storageResult.absolutePath);
      return { storageResult, downloadInfo };
    });

    if (isPrimary) {
      const { storageResult, downloadInfo } = await promise;
      return this.metadataBuilder.buildSuccess({
        resource: resourceEntry,
        storage: storageResult,
        downloadInfo,
        cacheDetails: { cacheHit: false, copiedFromCache: false }
      });
    }

    await promise;
    const cachePath = cacheIndex.lookup(resourceEntry.urlHash);
    if (!cachePath) {
      throw new Error('Cache missing after in-flight completion');
    }

    const samePath = cachePath === resourceEntry.targetPath;
    const storageResult = samePath
      ? storageDriver.handleCacheHitSamePath(cachePath, job.options.relativeTo, job.options.docPath)
      : storageDriver.handleCacheHitDifferentPath(cachePath, resourceEntry.targetPath, job.options.relativeTo, job.options.docPath);

    cacheIndex.update(resourceEntry.urlHash, storageResult.absolutePath);

    return this.metadataBuilder.buildSuccess({
      resource: resourceEntry,
      storage: storageResult,
      cacheDetails: {
        cacheHit: true,
        copiedFromCache: !samePath,
        fromPath: samePath ? null : cachePath,
        copyMethod: samePath ? null : storageResult.copyMethod
      }
    });
  }

  markResourceRunning(job, resourceEntry) {
    if (resourceEntry.status !== 'running') {
      resourceEntry.status = 'running';
      job.stats.running += 1;
      if (job.stats.queued > 0) {
        job.stats.queued -= 1;
      }
      this.updateJobStatus(job);
    }
  }

  handleResourceSuccess(job, resourceEntry, metadata) {
    resourceEntry.status = 'success';
    resourceEntry.result = metadata;
    resourceEntry.queueReason = null;
    resourceEntry.abortController = null;
    job.stats.completed += 1;
    if (job.stats.running > 0) {
      job.stats.running -= 1;
    }
    this.updateJobStatus(job);
    this.persistJob(job);
  }

  handleResourceFailure(job, resourceEntry, error) {
    const isCancelledError = (error instanceof DownloadError && error.code === 'CANCELLED')
      || (typeof error?.message === 'string' && error.message.toLowerCase().includes('cancelled'));
    resourceEntry.status = isCancelledError ? 'cancelled' : 'failed';
    resourceEntry.error = error?.message || 'Download failed';
    const isCancelled = resourceEntry.status === 'cancelled';

    if (!isCancelled) {
      resourceEntry.result = this.metadataBuilder.buildFailure({
        resource: resourceEntry,
        error: error instanceof DownloadError ? error : { message: error?.message, code: error?.code }
      });
      job.stats.failed += 1;
    } else {
      resourceEntry.result = null;
    }

    if (job.stats.running > 0) {
      job.stats.running -= 1;
    }

    if (!isCancelled) {
      this.updateJobStatus(job);
    }
    this.persistJob(job);
  }

  updateJobStatus(job) {
    const { completed, failed } = job.stats;
    if (completed + failed === job.stats.total) {
      if (failed === 0) {
        job.status = 'completed';
      } else if (completed === 0) {
        job.status = 'failed';
      } else {
        job.status = 'partial';
      }
    } else if (job.stats.running > 0) {
      job.status = 'running';
    } else {
      job.status = 'queued';
    }

    job.updatedAt = new Date().toISOString();
    job.heartbeatAt = new Date().toISOString();
  }

  persistJob(job) {
    try {
      if (!existsSync(this.jobsDir)) {
        mkdirSync(this.jobsDir, { recursive: true });
      }
      const filePath = join(this.jobsDir, `${job.id}.json`);
      writeFileSync(filePath, JSON.stringify(job, null, 2));
    } catch (error) {
      logger.warn('Failed to persist job', { jobId: job.id, error: error.message });
    }
  }

  serializeJob(job) {
    return {
      id: job.id,
      status: job.status,
      stats: job.stats,
      queueReason: job.queueReason,
      heartbeatAt: job.heartbeatAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      results: job.results.map(res => ({
        url: res.url,
        filename: res.filename,
        status: res.status,
        queueReason: res.queueReason,
        result: res.result || null
      })),
      nextPollAfterMs: this.nextPollMs
    };
  }

  getJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return null;
    }
    return this.serializeJob(job);
  }

  cancelJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return null;
    }

    if (['completed', 'failed', 'partial', 'cancelled'].includes(job.status)) {
      throw new Error('Job already finished');
    }

    for (const resource of job.results) {
      if (resource.status === 'queued' && resource.queueTaskId) {
        this.queueManager.cancelTask(resource.queueTaskId, 'cancelled');
        resource.status = 'cancelled';
        resource.queueReason = 'cancelled';
        job.stats.queued = Math.max(0, job.stats.queued - 1);
      } else if (resource.status === 'running' && resource.abortController) {
        resource.abortController.abort(new DownloadError('Task cancelled by user', { code: 'CANCELLED', retriable: false }));
        resource.status = 'cancelled';
        resource.queueReason = 'cancelled';
      }
    }

    job.status = 'cancelled';
    job.updatedAt = new Date().toISOString();
    job.heartbeatAt = new Date().toISOString();
    this.persistJob(job);
    return this.serializeJob(job);
  }
}

const jobService = new JobService();
export default jobService;
