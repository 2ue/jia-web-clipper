import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { FetchWorker, DownloadError } from '../../src/downloads/fetch-worker.js';
import config from '../../src/utils/config.js';

describe('FetchWorker', () => {
  const testDir = join(process.cwd(), 'data', 'test-fetch-worker');
  const originalDataDir = config.get('paths.dataDir');
  let worker;

  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  beforeEach(() => {
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    config.set('paths.dataDir', testDir);
    worker = new FetchWorker({
      connectTimeoutMs: 50,
      readTimeoutMs: 50,
      maxRetries: 2,
      retryDelayMs: 10,
      maxRedirects: 5
    });
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
    config.set('paths.dataDir', originalDataDir);
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('downloads file successfully and writes to temp path', async () => {
    const url = 'http://files.test/image.png';
    nock('http://files.test')
      .get('/image.png')
      .reply(200, 'hello', {
        'Content-Length': '5',
        'Content-Type': 'text/plain'
      });

    const result = await worker.download({ url });

    expect(result.statusCode).toBe(200);
    expect(result.bytesWritten).toBe(5);
    expect(result.contentLength).toBe(5);
    expect(result.retryCount).toBe(0);
    expect(existsSync(result.tempPath)).toBe(true);
    expect(readFileSync(result.tempPath, 'utf-8')).toBe('hello');
  });

  it('follows redirects automatically', async () => {
    const url = 'http://files.test/redirect';
    nock('http://files.test')
      .get('/redirect')
      .reply(302, undefined, { Location: '/final' })
      .get('/final')
      .reply(200, 'ok', { 'Content-Length': '2' });

    const result = await worker.download({ url });
    expect(result.bytesWritten).toBe(2);
    expect(readFileSync(result.tempPath, 'utf-8')).toBe('ok');
  });

  it('retries when read timeout happens', async () => {
    const url = 'http://files.test/slow';
    nock('http://files.test')
      .get('/slow')
      .delayBody(200)
      .reply(200, 'late', { 'Content-Length': '4' })
      .get('/slow')
      .reply(200, 'ok', { 'Content-Length': '2' });

    const result = await worker.download({ url });
    expect(result.retryCount).toBe(1);
    expect(result.bytesWritten).toBe(2);
    expect(readFileSync(result.tempPath, 'utf-8')).toBe('ok');
  });

  it('uses Retry-After header for 429 responses', async () => {
    const url = 'http://files.test/rate';
    const sleepCalls = [];
    const originalSleep = worker.sleep.bind(worker);
    worker.sleep = async ms => {
      sleepCalls.push(ms);
      return undefined;
    };

    nock('http://files.test')
      .get('/rate')
      .reply(429, 'nope', { 'Retry-After': '2' })
      .get('/rate')
      .reply(200, 'ok', { 'Content-Length': '2' });

    try {
      const result = await worker.download({ url });
      expect(result.retryCount).toBe(1);
      expect(sleepCalls).toContain(2000);
    } finally {
      worker.sleep = originalSleep;
    }
  });

  it('throws DownloadError for 404 without retry', async () => {
    const url = 'http://files.test/missing';
    nock('http://files.test')
      .get('/missing')
      .reply(404, 'missing');

    await expect(worker.download({ url })).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      statusCode: 404,
      retriable: false
    });
  });

  it('detects content-length mismatch and retries', async () => {
    const url = 'http://files.test/mismatch';
    nock('http://files.test')
      .get('/mismatch')
      .reply(200, 'short', { 'Content-Length': '10' })
      .get('/mismatch')
      .reply(200, 'correct-body', { 'Content-Length': '12' });

    const result = await worker.download({ url });
    expect(result.retryCount).toBe(1);
    expect(result.bytesWritten).toBe(12);
  });

  it('supports cancellation via AbortController', async () => {
    const url = 'http://files.test/cancel';
    nock('http://files.test')
      .get('/cancel')
      .delayBody(200)
      .reply(200, 'late', { 'Content-Length': '4' });

    const controller = new AbortController();
    const downloadPromise = worker.download({ url }, { signal: controller.signal });

    controller.abort();

    await expect(downloadPromise).rejects.toMatchObject({
      code: 'ABORTED',
      retriable: false
    });
  });
});
