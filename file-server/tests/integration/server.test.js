import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import nock from 'nock';
import { join } from 'path';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { app } from '../../src/server.js';
import config from '../../src/utils/config.js';

describe('Server Basic Tests', () => {
  let server;
  const token = config.get('auth.token');
  const testSaveDir = join(process.cwd(), 'data', 'test-api');
  const jobsDir = config.get('paths.jobsDir');
  const originalProfiles = JSON.parse(JSON.stringify(config.get('profiles')));
  const createdJobFiles = [];

  const ensureDir = dir => {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  };

  const removeFile = path => {
    if (existsSync(path)) {
      rmSync(path, { recursive: true, force: true });
    }
  };

  beforeAll(() => {
    ensureDir(testSaveDir);
    const profiles = { ...originalProfiles, test: [testSaveDir] };
    config.set('profiles', profiles);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    for (const file of createdJobFiles) {
      removeFile(file);
    }
    removeFile(testSaveDir);
    config.set('profiles', originalProfiles);
    if (server) {
      server.close();
    }
  });

  async function pollJob(jobId, predicate, timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const res = await request(app)
        .get(`/api/jobs/${jobId}`)
        .set('X-Auth-Token', token);

      if (res.status === 200 && predicate(res.body.job)) {
        return res.body.job;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for job ${jobId}`);
  }

  describe('Health Check', () => {
    it('should return 200 and server status', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('version');
      expect(res.body).toHaveProperty('uptime');
      expect(res.body).toHaveProperty('timestamp');
    });
  });

  describe('Authorization Page', () => {
    it('should return HTML page with token', async () => {
      const res = await request(app).get('/authorize');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain(token);
    });
  });

  describe('Authentication', () => {
    it('should reject requests without token', async () => {
      const res = await request(app)
        .post('/api/jobs')
        .send({ test: 'data' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error', 'Unauthorized');
    });

    it('should reject requests with invalid token', async () => {
      const res = await request(app)
        .post('/api/jobs')
        .set('X-Auth-Token', 'invalid-token')
        .send({ test: 'data' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error', 'Unauthorized');
    });

    it('should accept requests with valid token but fail validation', async () => {
      const res = await request(app)
        .post('/api/jobs')
        .set('X-Auth-Token', token)
        .send({ test: 'data' });

      expect(res.status).toBe(400);
    });
  });

  describe('404 Handler', () => {
    it('should return 404 for unknown routes with valid token', async () => {
      const res = await request(app)
        .get('/unknown-route')
        .set('X-Auth-Token', token);

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error', 'Not Found');
    });
  });
  describe('Jobs API', () => {
    it('creates a job and completes downloads', async () => {
      const url = 'http://files.test/image.png';
      nock('http://files.test')
        .get('/image.png')
        .reply(200, 'image-data', { 'Content-Type': 'image/png', 'Content-Length': '10' });

      const docPath = join(testSaveDir, 'note.md');
      const res = await request(app)
        .post('/api/jobs')
        .set('X-Auth-Token', token)
        .send({
          resources: [{ url, filename: 'image.png' }],
          saveDir: testSaveDir,
          docPath,
          relativeProfile: 'test'
        });

      expect(res.status).toBe(202);
      const { id } = res.body.job;
      createdJobFiles.push(join(jobsDir, `${id}.json`));

      const job = await pollJob(id, job => job.status === 'completed');
      expect(job.results[0].result.status).toBe('success');
      expect(job.results[0].result.absolutePath).toContain('image.png');
    });

    it('cancels a running job', async () => {
      const url = 'http://slow.test/large.bin';
      nock('http://slow.test')
        .get('/large.bin')
        .delay(500)
        .reply(200, 'slow-data', { 'Content-Type': 'application/octet-stream' });

      const res = await request(app)
        .post('/api/jobs')
        .set('X-Auth-Token', token)
        .send({
          resources: [{ url, filename: 'large.bin' }],
          saveDir: testSaveDir,
          docPath: join(testSaveDir, 'slow.md'),
          relativeProfile: 'test'
        });

      expect(res.status).toBe(202);
      const { id } = res.body.job;
      createdJobFiles.push(join(jobsDir, `${id}.json`));

      await new Promise(resolve => setTimeout(resolve, 50));

      const cancelRes = await request(app)
        .post(`/api/jobs/${id}/cancel`)
        .set('X-Auth-Token', token);

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.job.status).toBe('cancelled');

      const job = await request(app)
        .get(`/api/jobs/${id}`)
        .set('X-Auth-Token', token);

      expect(job.body.job.status).toBe('cancelled');
    });
  });
});
