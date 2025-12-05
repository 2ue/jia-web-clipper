import axios from 'axios';
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { finished } from 'stream/promises';
import config from '../utils/config.js';
import logger from '../utils/logger.js';

class DownloadError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'DownloadError';
    this.code = options.code || 'DOWNLOAD_ERROR';
    this.statusCode = options.statusCode ?? null;
    this.retriable = options.retriable ?? false;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.details = options.details || null;
  }
}

class FetchWorker {
  constructor(overrides = {}) {
    this.overrides = overrides;
    this.http = axios.create({
      responseType: 'stream',
      decompress: true,
      validateStatus: () => true,
      transformRequest: [],
      transformResponse: []
    });
  }

  get connectTimeoutMs() {
    return this.overrides.connectTimeoutMs ?? config.get('download.connectTimeoutMs') ?? 10000;
  }

  get readTimeoutMs() {
    return this.overrides.readTimeoutMs ?? config.get('download.readTimeoutMs') ?? 30000;
  }

  get maxRetries() {
    return this.overrides.maxRetries ?? config.get('download.maxRetries') ?? 2;
  }

  get retryDelayMs() {
    return this.overrides.retryDelayMs ?? config.get('download.retryDelayMs') ?? 1000;
  }

  get maxRedirects() {
    return this.overrides.maxRedirects ?? 5;
  }

  get tempDir() {
    const dir = join(config.get('paths.dataDir'), 'tmp');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  createTempFilePath() {
    return join(this.tempDir, `${Date.now()}-${randomUUID()}.tmp`);
  }

  cleanupTempFile(tempPath) {
    if (!tempPath) return;
    try {
      rmSync(tempPath, { force: true });
    } catch (error) {
      logger.warn('Failed to cleanup temp file', { path: tempPath, error: error.message });
    }
  }

  parseRetryAfter(headerValue) {
    if (!headerValue) {
      return null;
    }

    const seconds = Number(headerValue);
    if (!Number.isNaN(seconds)) {
      return Math.max(0, seconds * 1000);
    }

    const timestamp = Date.parse(headerValue);
    if (!Number.isNaN(timestamp)) {
      const diff = timestamp - Date.now();
      return diff > 0 ? diff : null;
    }

    return null;
  }

  getBackoffDelay(attempt) {
    const base = this.retryDelayMs;
    return base * Math.pow(2, attempt - 1);
  }

  async sleep(ms) {
    if (!ms || ms <= 0) return;
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  normalizeHeaders(headers) {
    if (!headers) {
      return {};
    }

    if (typeof headers.toJSON === 'function') {
      try {
        return headers.toJSON();
      } catch (error) {
        logger.warn('Failed to serialize headers via toJSON', { error: error.message });
      }
    }

    const plain = {};
    for (const [key, value] of Object.entries(headers)) {
      plain[key] = value;
    }
    return plain;
  }

  shouldRetryStatus(status) {
    if (status === 429 || status === 408) {
      return true;
    }
    if (status >= 500 && status < 600) {
      return true;
    }
    return false;
  }

  createAbortController(externalSignal) {
    const controller = new AbortController();

    const onExternalAbort = () => {
      const reason = externalSignal.reason instanceof DownloadError
        ? externalSignal.reason
        : new DownloadError('Download aborted by caller', {
          code: 'ABORTED',
          retriable: false
        });
      controller.abort(reason);
    };

    if (externalSignal) {
      if (externalSignal.aborted) {
        onExternalAbort();
      } else {
        externalSignal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }

    const cleanup = () => {
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
    };

    return { controller, cleanup };
  }

  async download(resource, options = {}) {
    const { url, method = 'GET', headers = {} } = resource || {};
    if (!url) {
      throw new DownloadError('Download resource must include url', { retriable: false });
    }

    const maxAttempts = 1 + (options.maxRetries ?? this.maxRetries);
    let attempt = 0;
    let lastError = null;
    const jobStart = Date.now();

    while (attempt < maxAttempts) {
      attempt += 1;
      const tempPath = this.createTempFilePath();

      try {
        const result = await this.performAttempt({
          url,
          method,
          headers,
          tempPath,
          signal: options.signal
        });

        return {
          ...result,
          url,
          attempts: attempt,
          retryCount: attempt - 1,
          totalDurationMs: Date.now() - jobStart
        };
      } catch (error) {
        this.cleanupTempFile(tempPath);
        const downloadError = error instanceof DownloadError
          ? error
          : new DownloadError(error.message || 'Download failed', { retriable: false });
        downloadError.retryCount = attempt - 1;
        downloadError.attempts = attempt;
        downloadError.url = url;
        lastError = downloadError;

        if (!downloadError.retriable || attempt >= maxAttempts) {
          throw downloadError;
        }

        const retryDelay = downloadError.retryAfterMs ?? this.getBackoffDelay(attempt);
        logger.warn('Download attempt failed, retrying', {
          url,
          attempt,
          retryDelay
        });
        await this.sleep(retryDelay);
      }
    }

    throw lastError || new DownloadError('Download failed', { retriable: false });
  }

  async performAttempt({ url, method, headers, tempPath, signal }) {
    this.http.defaults.maxRedirects = this.maxRedirects;
    const { controller, cleanup } = this.createAbortController(signal);

    let connectTimer = null;
    let readTimer = null;
    const resetReadTimer = () => {
      if (readTimer) {
        clearTimeout(readTimer);
      }
      readTimer = setTimeout(() => {
        controller.abort(new DownloadError('Read timeout exceeded', {
          code: 'READ_TIMEOUT',
          retriable: true
        }));
      }, this.readTimeoutMs);
    };

    const clearTimers = () => {
      if (connectTimer) {
        clearTimeout(connectTimer);
      }
      if (readTimer) {
        clearTimeout(readTimer);
      }
    };

    connectTimer = setTimeout(() => {
      controller.abort(new DownloadError('Connection timeout exceeded', {
        code: 'CONNECT_TIMEOUT',
        retriable: true
      }));
    }, this.connectTimeoutMs);

    const attemptStart = Date.now();

    try {
      const response = await this.http.request({
        url,
        method,
        headers,
        signal: controller.signal,
        timeout: this.readTimeoutMs
      });

      clearTimeout(connectTimer);
      connectTimer = null;

      if (response.status < 200 || response.status >= 300) {
        const retryAfterMs = this.parseRetryAfter(response.headers?.['retry-after']);
        const retriable = this.shouldRetryStatus(response.status);
        throw new DownloadError(`HTTP ${response.status}`, {
          code: response.status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR',
          statusCode: response.status,
          retriable,
          retryAfterMs
        });
      }

      const contentLengthHeader = response.headers?.['content-length'];
      const contentLength = contentLengthHeader ? Number(contentLengthHeader) : null;
      const writer = createWriteStream(tempPath);
      let bytesWritten = 0;

      resetReadTimer();

      response.data.on('data', chunk => {
        bytesWritten += chunk.length;
        resetReadTimer();
      });

      response.data.on('error', err => {
        writer.destroy(err);
      });

      response.data.pipe(writer);
      await finished(writer);

      clearTimers();

      if (contentLength !== null && !Number.isNaN(contentLength) && bytesWritten !== contentLength) {
        throw new DownloadError('Content-Length mismatch', {
          code: 'CONTENT_LENGTH_MISMATCH',
          retriable: true
        });
      }

      const completedAt = Date.now();

      return {
        tempPath,
        bytesWritten,
        contentLength: Number.isNaN(contentLength) ? null : contentLength,
        statusCode: response.status,
        headers: this.normalizeHeaders(response.headers),
        contentType: response.headers?.['content-type'] || null,
        downloadDurationMs: completedAt - attemptStart,
        startedAt: attemptStart,
        completedAt
      };
    } catch (error) {
      clearTimers();

      if (error instanceof DownloadError) {
        throw error;
      }

      if (axios.isCancel(error)) {
        const reason = controller.signal.reason;
        if (reason instanceof DownloadError) {
          throw reason;
        }
        throw new DownloadError('Download aborted', {
          code: 'ABORTED',
          retriable: false
        });
      }

      const retriable = ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(error.code);
      throw new DownloadError(error.message || 'Network error', {
        code: error.code || 'NETWORK_ERROR',
        retriable
      });
    } finally {
      cleanup();
    }
  }
}

const fetchWorker = new FetchWorker();

export { FetchWorker, DownloadError };
export default fetchWorker;
