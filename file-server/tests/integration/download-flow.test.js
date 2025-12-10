import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import config from '../../src/utils/config.js';

/**
 * 完整下载流程集成测试
 *
 * 注意: 这些测试需要一个运行中的 file-server 实例
 * 启动命令: npm start
 */

describe('Integration Tests - Full Download Flow', () => {
  const testDir = join(process.cwd(), 'data', 'test-integration');
  const serverUrl = 'http://localhost:3456';
  const token = config.get('server.token');

  beforeAll(() => {
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }

    // 设置测试白名单
    config.set('profiles', {
      test: [testDir]
    });
  });

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should complete full download flow for cache miss', async () => {
    const response = await fetch(`${serverUrl}/api/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': token
      },
      body: JSON.stringify({
        resources: [
          {
            url: 'http://localhost:3457/test-image.png',
            filename: 'test-image.png'
          }
        ],
        saveDir: testDir,
        relativeTo: testDir,
        relativeProfile: 'test'
      })
    });

    expect(response.status).toBe(202);

    const job = await response.json();
    expect(job.id).toBeDefined();
    expect(job.status).toBe('queued');

    // 轮询直到完成
    let completed = false;
    let attempts = 0;
    const maxAttempts = 30;

    while (!completed && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;

      const statusResponse = await fetch(`${serverUrl}/api/jobs/${job.id}`, {
        method: 'GET',
        headers: {
          'X-Auth-Token': token
        }
      });

      const status = await statusResponse.json();

      if (['completed', 'failed', 'partial'].includes(status.status)) {
        completed = true;
        expect(status.status).toBe('completed');
        expect(status.stats.completed).toBe(1);
        expect(status.results[0].status).toBe('success');
        expect(status.results[0].result.cacheHit).toBe(false);
      }
    }

    expect(completed).toBe(true);
  }, 60000);

  it('should handle cache hit with same path', async () => {
    // 这个测试假设上一个测试已经缓存了资源
    const response = await fetch(`${serverUrl}/api/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': token
      },
      body: JSON.stringify({
        resources: [
          {
            url: 'http://localhost:3457/test-image.png',
            filename: 'test-image.png'
          }
        ],
        saveDir: testDir,
        relativeTo: testDir,
        relativeProfile: 'test'
      })
    });

    const job = await response.json();

    // 应该立即完成(缓存命中)
    await new Promise(resolve => setTimeout(resolve, 500));

    const statusResponse = await fetch(`${serverUrl}/api/jobs/${job.id}`, {
      method: 'GET',
      headers: {
        'X-Auth-Token': token
      }
    });

    const status = await statusResponse.json();

    expect(status.status).toBe('completed');
    expect(status.results[0].result.cacheHit).toBe(true);
    expect(status.results[0].result.copiedFromCache).toBe(false);
  }, 10000);
});

/**
 * 注意: 这些是基础的集成测试
 * 更完整的测试场景包括:
 * - 12.3-12.11 中列出的各种场景
 * - 需要运行 mock HTTP 服务器
 * - 需要测试并发限制、节流、重试等
 *
 * 由于测试环境的复杂性,这里仅提供基础框架
 * 实际测试应在部署后通过手动测试验证
 */
