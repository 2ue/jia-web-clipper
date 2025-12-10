import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { JobService } from '../../src/jobs/job-service.js';
import config from '../../src/utils/config.js';
import cacheIndex from '../../src/jobs/cache-index.js';
import pathGuard from '../../src/security/path-guard.js';

describe('JobService', () => {
  const testDir = join(process.cwd(), 'data', 'test-jobs');
  const testJobsDir = join(testDir, 'jobs');
  const testCacheDir = join(testDir, 'cache');
  const testFilesDir = join(testDir, 'files');

  const originalJobsDir = config.get('paths.jobsDir');
  const originalCacheDir = config.get('paths.cacheDir');
  const originalProfiles = config.get('profiles');

  let jobService;

  beforeEach(() => {
    // 创建测试目录
    [testJobsDir, testCacheDir, testFilesDir].forEach(dir => {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    });

    // 设置测试配置 - 使用绝对路径
    const absTestFilesDir = join(process.cwd(), 'data', 'test-jobs', 'files');
    config.set('paths.jobsDir', testJobsDir);
    config.set('paths.cacheDir', testCacheDir);
    config.set('profiles', {
      default: [absTestFilesDir]
    });

    // 清空缓存
    cacheIndex.clear();

    // 创建新的 JobService 实例
    jobService = new JobService();
  });

  afterEach(() => {
    // 清理定时器
    if (jobService.heartbeatTimer) {
      clearInterval(jobService.heartbeatTimer);
    }
    if (jobService.queueReasonTimer) {
      clearInterval(jobService.queueReasonTimer);
    }

    // 清理测试目录
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }

    // 恢复原始配置
    config.set('paths.jobsDir', originalJobsDir);
    config.set('paths.cacheDir', originalCacheDir);
    config.set('profiles', originalProfiles);
  });

  describe('validatePayload', () => {
    it('should validate a correct payload', () => {
      const payload = {
        resources: [{ url: 'https://example.com/image.png' }],
        saveDir: testFilesDir,
        docPath: join(testFilesDir, 'doc.html'),
        relativeTo: testFilesDir,
        relativeProfile: 'default'
      };

      const normalized = jobService.validatePayload(payload);

      expect(normalized.resources).toEqual(payload.resources);
      expect(normalized.saveDir).toBe(testFilesDir);
      expect(normalized.docPath).toBe(payload.docPath);
      expect(normalized.relativeTo).toBe(testFilesDir);
      expect(normalized.relativeProfile).toBe('default');
      expect(normalized.priority).toBe(0);
    });

    it('should throw error for missing resources', () => {
      const payload = {
        saveDir: testFilesDir
      };

      expect(() => jobService.validatePayload(payload)).toThrow('resources must be a non-empty array');
    });

    it('should throw error for empty resources array', () => {
      const payload = {
        resources: [],
        saveDir: testFilesDir
      };

      expect(() => jobService.validatePayload(payload)).toThrow('resources must be a non-empty array');
    });

    it('should throw error for invalid resource URL', () => {
      const payload = {
        resources: [{ url: '' }],
        saveDir: testFilesDir
      };

      expect(() => jobService.validatePayload(payload)).toThrow('Each resource must include a valid url');
    });

    it('should throw error for missing saveDir', () => {
      const payload = {
        resources: [{ url: 'https://example.com/image.png' }]
      };

      expect(() => jobService.validatePayload(payload)).toThrow('saveDir is required');
    });

    it('should throw error for path outside whitelist', () => {
      const payload = {
        resources: [{ url: 'https://example.com/image.png' }],
        saveDir: testFilesDir,
        docPath: '/tmp/outside/doc.html',  // docPath 不在白名单
        relativeProfile: 'default'
      };

      // validatePayload 会检查 docPath 是否在白名单内
      expect(() => jobService.validatePayload(payload)).toThrow();
    });

    it('should use default priority if not provided', () => {
      const payload = {
        resources: [{ url: 'https://example.com/image.png' }],
        saveDir: testFilesDir
      };

      const normalized = jobService.validatePayload(payload);
      expect(normalized.priority).toBe(0);
    });

    it('should accept custom priority', () => {
      const payload = {
        resources: [{ url: 'https://example.com/image.png' }],
        saveDir: testFilesDir,
        priority: 10
      };

      const normalized = jobService.validatePayload(payload);
      expect(normalized.priority).toBe(10);
    });
  });

  describe('deriveFilename', () => {
    it('should use provided filename', () => {
      const resource = {
        url: 'https://example.com/path/to/file.png',
        filename: 'custom.png'
      };

      const filename = jobService.deriveFilename(resource, 0);
      expect(filename).toBe('custom.png');
    });

    it('should derive filename from URL pathname', () => {
      const resource = {
        url: 'https://example.com/path/to/image.png'
      };

      const filename = jobService.deriveFilename(resource, 0);
      expect(filename).toBe('image.png');
    });

    it('should use fallback filename for URLs without path', () => {
      const resource = {
        url: 'https://example.com/'
      };

      const filename = jobService.deriveFilename(resource, 0);
      expect(filename).toBe('resource-1.bin');
    });

    it('should use fallback filename for invalid URLs', () => {
      const resource = {
        url: 'not-a-valid-url'
      };

      const filename = jobService.deriveFilename(resource, 5);
      expect(filename).toBe('resource-6.bin');
    });
  });

  describe('createJob', () => {
    it('should create a job with queued status', async () => {
      const payload = {
        resources: [
          { url: 'https://example.com/image1.png' },
          { url: 'https://example.com/image2.png' }
        ],
        saveDir: testFilesDir,
        relativeTo: testFilesDir
      };

      const job = await jobService.createJob(payload);

      expect(job.id).toMatch(/^job_\d+_[a-zA-Z0-9]{6}$/);
      expect(job.status).toBe('queued');
      expect(job.stats.total).toBe(2);
      expect(job.results).toHaveLength(2);
      expect(job.results[0].url).toBe('https://example.com/image1.png');
      expect(job.results[0].status).toBe('queued');
    });

    it('should immediately complete job if all resources are cached', async () => {
      // 先添加缓存
      const cachedPath = join(testFilesDir, 'cached.png');
      writeFileSync(cachedPath, 'cached content');

      const url = 'https://example.com/cached.png';
      const urlHash = cacheIndex.hashUrl(url);
      cacheIndex.update(urlHash, cachedPath);

      const payload = {
        resources: [{ url, filename: 'cached.png' }],
        saveDir: testFilesDir,
        relativeTo: testFilesDir
      };

      const job = await jobService.createJob(payload);

      expect(job.status).toBe('completed');
      expect(job.stats.completed).toBe(1);
      expect(job.stats.queued).toBe(0);
      expect(job.results[0].status).toBe('success');
      expect(job.results[0].result.cacheHit).toBe(true);
    });

    it('should persist job to disk', async () => {
      const payload = {
        resources: [{ url: 'https://example.com/image.png' }],
        saveDir: testFilesDir
      };

      const job = await jobService.createJob(payload);
      const jobFilePath = join(testJobsDir, `${job.id}.json`);

      expect(existsSync(jobFilePath)).toBe(true);
    });

    it('should assign unique IDs to each resource', async () => {
      const payload = {
        resources: [
          { url: 'https://example.com/image1.png' },
          { url: 'https://example.com/image2.png' }
        ],
        saveDir: testFilesDir
      };

      const job = await jobService.createJob(payload);

      // 从内部 Map 获取未序列化的 job
      const internalJob = jobService.jobs.get(job.id);

      expect(internalJob.results[0].id).toMatch(/^job_.*-res-0$/);
      expect(internalJob.results[1].id).toMatch(/^job_.*-res-1$/);
      expect(internalJob.results[0].id).not.toBe(internalJob.results[1].id);
    });

    it('should calculate relative paths for resources', async () => {
      const payload = {
        resources: [{ url: 'https://example.com/image.png' }],
        saveDir: join(testFilesDir, 'subdir'),
        relativeTo: testFilesDir,
        docPath: join(testFilesDir, 'doc.html')
      };

      const job = await jobService.createJob(payload);

      // 从内部 Map 获取未序列化的 job
      const internalJob = jobService.jobs.get(job.id);

      expect(internalJob.results[0].relativePath).toBeDefined();
      expect(internalJob.results[0].relativePathFromDoc).toBeDefined();
    });
  });

  describe('getJob', () => {
    it('should return job by ID', async () => {
      const payload = {
        resources: [{ url: 'https://example.com/image.png' }],
        saveDir: testFilesDir
      };

      const created = await jobService.createJob(payload);
      const retrieved = jobService.getJob(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved.id).toBe(created.id);
      // 状态可能会快速变化,所以只检查状态是有效的
      expect(['queued', 'running', 'completed', 'failed']).toContain(retrieved.status);
    });

    it('should return null for non-existent job', () => {
      const job = jobService.getJob('non-existent-id');
      expect(job).toBeNull();
    });

    it('should serialize job with nextPollAfterMs', async () => {
      const payload = {
        resources: [{ url: 'https://example.com/image.png' }],
        saveDir: testFilesDir
      };

      const job = await jobService.createJob(payload);

      expect(job.nextPollAfterMs).toBeDefined();
      expect(typeof job.nextPollAfterMs).toBe('number');
    });
  });

  describe('cancelJob', () => {
    it('should cancel a queued job', async () => {
      const payload = {
        resources: [{ url: 'https://example.com/image.png' }],
        saveDir: testFilesDir
      };

      const job = await jobService.createJob(payload);
      const cancelled = jobService.cancelJob(job.id);

      expect(cancelled.status).toBe('cancelled');
    });

    it('should throw error when cancelling completed job', async () => {
      // 创建一个已完成的任务
      const cachedPath = join(testFilesDir, 'cached.png');
      writeFileSync(cachedPath, 'cached content');

      const url = 'https://example.com/cached.png';
      const urlHash = cacheIndex.hashUrl(url);
      cacheIndex.update(urlHash, cachedPath);

      const payload = {
        resources: [{ url, filename: 'cached.png' }],
        saveDir: testFilesDir
      };

      const job = await jobService.createJob(payload);

      expect(() => jobService.cancelJob(job.id)).toThrow('Job already finished');
    });

    it('should return null for non-existent job', () => {
      const result = jobService.cancelJob('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('loadPersistedJobs', () => {
    it('should load jobs from disk on startup', () => {
      // 创建持久化的任务文件
      const jobId = 'job_test_123';
      const jobData = {
        id: jobId,
        status: 'completed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        stats: { total: 1, completed: 1, failed: 0 },
        results: []
      };

      writeFileSync(
        join(testJobsDir, `${jobId}.json`),
        JSON.stringify(jobData)
      );

      // 创建新实例以触发加载
      const newService = new JobService();
      const loaded = newService.getJob(jobId);

      expect(loaded).not.toBeNull();
      expect(loaded.id).toBe(jobId);
      expect(loaded.status).toBe('completed');

      // 清理
      clearInterval(newService.heartbeatTimer);
      clearInterval(newService.queueReasonTimer);
    });

    it('should mark unfinished jobs as failed on restart', () => {
      // 创建一个正在运行的任务
      const jobId = 'job_test_running';
      const jobData = {
        id: jobId,
        status: 'running',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        stats: { total: 1, completed: 0, failed: 0, running: 1 },
        results: [
          {
            url: 'https://example.com/image.png',
            filename: 'image.png',
            status: 'running',
            result: null
          }
        ]
      };

      writeFileSync(
        join(testJobsDir, `${jobId}.json`),
        JSON.stringify(jobData)
      );

      // 创建新实例以触发恢复
      const newService = new JobService();
      const loaded = newService.getJob(jobId);

      expect(loaded.status).toBe('failed');
      expect(loaded.results[0].status).toBe('failed');
      // 检查 result 中的 errorCode
      expect(loaded.results[0].result).not.toBeNull();
      expect(loaded.results[0].result.errorCode).toBe('SERVER_RESTART');

      // 清理
      clearInterval(newService.heartbeatTimer);
      clearInterval(newService.queueReasonTimer);
    });
  });

  describe('heartbeat', () => {
    it('should update heartbeat for active jobs', async () => {
      const payload = {
        resources: [{ url: 'https://example.com/image.png' }],
        saveDir: testFilesDir
      };

      const job = await jobService.createJob(payload);
      const initialHeartbeat = job.heartbeatAt;

      // 等待一小段时间
      await new Promise(resolve => setTimeout(resolve, 100));

      // 手动触发心跳更新
      jobService.refreshHeartbeats();

      const updated = jobService.getJob(job.id);
      expect(updated.heartbeatAt).not.toBe(initialHeartbeat);
    });
  });

  describe('updateJobStatus', () => {
    it('should set status to completed when all succeed', async () => {
      const job = {
        id: 'test-job',
        status: 'running',
        stats: { total: 2, completed: 2, failed: 0, running: 0 }
      };

      jobService.updateJobStatus(job);

      expect(job.status).toBe('completed');
    });

    it('should set status to failed when all fail', async () => {
      const job = {
        id: 'test-job',
        status: 'running',
        stats: { total: 2, completed: 0, failed: 2, running: 0 }
      };

      jobService.updateJobStatus(job);

      expect(job.status).toBe('failed');
    });

    it('should set status to partial when some succeed and some fail', async () => {
      const job = {
        id: 'test-job',
        status: 'running',
        stats: { total: 2, completed: 1, failed: 1, running: 0 }
      };

      jobService.updateJobStatus(job);

      expect(job.status).toBe('partial');
    });

    it('should set status to running when tasks are running', async () => {
      const job = {
        id: 'test-job',
        status: 'queued',
        stats: { total: 2, completed: 0, failed: 0, running: 1 }
      };

      jobService.updateJobStatus(job);

      expect(job.status).toBe('running');
    });

    it('should set status to queued when no tasks are running', async () => {
      const job = {
        id: 'test-job',
        status: 'created',
        stats: { total: 2, completed: 0, failed: 0, running: 0, queued: 2 }
      };

      jobService.updateJobStatus(job);

      expect(job.status).toBe('queued');
    });
  });

  describe('serializeJob', () => {
    it('should serialize job without internal fields', async () => {
      const payload = {
        resources: [{ url: 'https://example.com/image.png' }],
        saveDir: testFilesDir
      };

      const job = await jobService.createJob(payload);

      expect(job).not.toHaveProperty('abortController');
      expect(job).not.toHaveProperty('queueTaskId');
      expect(job).toHaveProperty('id');
      expect(job).toHaveProperty('status');
      expect(job).toHaveProperty('stats');
      expect(job).toHaveProperty('results');
      expect(job).toHaveProperty('nextPollAfterMs');
    });

    it('should serialize results without internal fields', async () => {
      const payload = {
        resources: [{ url: 'https://example.com/image.png' }],
        saveDir: testFilesDir
      };

      const job = await jobService.createJob(payload);

      expect(job.results[0]).toHaveProperty('url');
      expect(job.results[0]).toHaveProperty('filename');
      expect(job.results[0]).toHaveProperty('status');
      expect(job.results[0]).not.toHaveProperty('abortController');
      expect(job.results[0]).not.toHaveProperty('queueTaskId');
    });
  });
});
