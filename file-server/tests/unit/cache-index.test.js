import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import CacheIndex from '../../src/jobs/cache-index.js';
import config from '../../src/utils/config.js';

describe('CacheIndex', () => {
  const testDir = join(process.cwd(), 'data', 'test-cache');
  const originalCacheDir = config.get('paths.cacheDir');
  const originalMaxEntries = config.get('cache.maxEntries');

  beforeEach(() => {
    // 创建测试目录
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }

    // 设置测试配置
    config.set('paths.cacheDir', testDir);
    config.set('cache.maxEntries', 5); // 小容量便于测试淘汰

    // 清空缓存实例
    CacheIndex.clear();
  });

  afterEach(() => {
    // 清理测试目录
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }

    // 恢复原始配置
    config.set('paths.cacheDir', originalCacheDir);
    config.set('cache.maxEntries', originalMaxEntries);
  });

  describe('hashUrl', () => {
    it('should generate consistent hash for same URL', () => {
      const url = 'https://example.com/image.png';
      const hash1 = CacheIndex.hashUrl(url);
      const hash2 = CacheIndex.hashUrl(url);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{40}$/); // SHA-1 is 40 hex chars
    });

    it('should generate different hashes for different URLs', () => {
      const hash1 = CacheIndex.hashUrl('https://example.com/image1.png');
      const hash2 = CacheIndex.hashUrl('https://example.com/image2.png');

      expect(hash1).not.toBe(hash2);
    });

    it('should trim whitespace from URL', () => {
      const hash1 = CacheIndex.hashUrl('  https://example.com/image.png  ');
      const hash2 = CacheIndex.hashUrl('https://example.com/image.png');

      expect(hash1).toBe(hash2);
    });
  });

  describe('update and lookup', () => {
    it('should store and retrieve cache entry', () => {
      const url = 'https://example.com/test.png';
      const urlHash = CacheIndex.hashUrl(url);
      const filePath = join(testDir, 'test.png');

      // 创建文件
      writeFileSync(filePath, 'test content');

      // 更新缓存
      CacheIndex.update(urlHash, filePath);

      // 查询缓存
      const result = CacheIndex.lookup(urlHash);

      expect(result).toBe(filePath);
    });

    it('should return null for non-existent hash', () => {
      const result = CacheIndex.lookup('nonexistent-hash');
      expect(result).toBe(null);
    });

    it('should return null if cached file does not exist', () => {
      const urlHash = CacheIndex.hashUrl('https://example.com/deleted.png');
      const filePath = join(testDir, 'deleted.png');

      // 创建文件并缓存
      writeFileSync(filePath, 'content');
      CacheIndex.update(urlHash, filePath);

      // 删除文件
      rmSync(filePath);

      // 查询应返回 null 并自动清理缓存
      const result = CacheIndex.lookup(urlHash);
      expect(result).toBe(null);
    });

    it('should update hits and lastAccessedAt on lookup', () => {
      const urlHash = CacheIndex.hashUrl('https://example.com/test.png');
      const filePath = join(testDir, 'test.png');
      writeFileSync(filePath, 'content');

      CacheIndex.update(urlHash, filePath);

      // 第一次查询
      CacheIndex.lookup(urlHash);

      // 获取缓存条目
      const entry = CacheIndex.cache.get(urlHash);
      expect(entry.hits).toBe(2); // update时为1, lookup时+1

      // 第二次查询
      CacheIndex.lookup(urlHash);
      expect(entry.hits).toBe(3);
    });
  });

  describe('delete', () => {
    it('should delete cache entry', () => {
      const urlHash = CacheIndex.hashUrl('https://example.com/test.png');
      const filePath = join(testDir, 'test.png');
      writeFileSync(filePath, 'content');

      CacheIndex.update(urlHash, filePath);
      expect(CacheIndex.cache.has(urlHash)).toBe(true);

      CacheIndex.delete(urlHash);
      expect(CacheIndex.cache.has(urlHash)).toBe(false);
    });

    it('should return false when deleting non-existent entry', () => {
      const result = CacheIndex.delete('nonexistent-hash');
      expect(result).toBe(false);
    });

    it('should remove entry from LRU queue', () => {
      const urlHash = CacheIndex.hashUrl('https://example.com/test.png');
      const filePath = join(testDir, 'test.png');
      writeFileSync(filePath, 'content');

      CacheIndex.update(urlHash, filePath);
      expect(CacheIndex.lruQueue).toContain(urlHash);

      CacheIndex.delete(urlHash);
      expect(CacheIndex.lruQueue).not.toContain(urlHash);
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used entry when maxEntries exceeded', () => {
      // 临时覆盖 maxEntries 为测试友好的值
      const originalGetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(CacheIndex), 'maxEntries');
      Object.defineProperty(CacheIndex, 'maxEntries', {
        get: () => 5,
        configurable: true
      });

      const maxEntries = 5;
      const entries = [];

      // 添加 5 个缓存项
      for (let i = 0; i < maxEntries; i++) {
        const urlHash = CacheIndex.hashUrl(`https://example.com/file${i}.png`);
        const filePath = join(testDir, `file${i}.png`);
        writeFileSync(filePath, `content ${i}`);
        CacheIndex.update(urlHash, filePath);
        entries.push({ urlHash, filePath });
      }

      expect(CacheIndex.cache.size).toBe(maxEntries);

      // 添加第 6 个,应该淘汰最久未使用的
      const newUrlHash = CacheIndex.hashUrl('https://example.com/new.png');
      const newFilePath = join(testDir, 'new.png');
      writeFileSync(newFilePath, 'new content');
      CacheIndex.update(newUrlHash, newFilePath);

      // 缓存大小应该还是 5
      expect(CacheIndex.cache.size).toBe(maxEntries);

      // 第一个应该被淘汰
      expect(CacheIndex.cache.has(entries[0].urlHash)).toBe(false);

      // 恢复原始 getter
      if (originalGetter) {
        Object.defineProperty(CacheIndex, 'maxEntries', originalGetter);
      }
    });

    it('should update LRU order on lookup', () => {
      // 临时覆盖 maxEntries
      const originalGetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(CacheIndex), 'maxEntries');
      Object.defineProperty(CacheIndex, 'maxEntries', {
        get: () => 5,
        configurable: true
      });

      const maxEntries = 5;
      const entries = [];

      // 添加 3 个缓存项
      for (let i = 0; i < 3; i++) {
        const urlHash = CacheIndex.hashUrl(`https://example.com/file${i}.png`);
        const filePath = join(testDir, `file${i}.png`);
        writeFileSync(filePath, `content ${i}`);
        CacheIndex.update(urlHash, filePath);
        entries.push({ urlHash, filePath });
      }

      // 访问第一个,它应该移到队尾
      CacheIndex.lookup(entries[0].urlHash);

      // 添加更多项直到触发淘汰
      for (let i = 3; i < maxEntries + 1; i++) {
        const urlHash = CacheIndex.hashUrl(`https://example.com/file${i}.png`);
        const filePath = join(testDir, `file${i}.png`);
        writeFileSync(filePath, `content ${i}`);
        CacheIndex.update(urlHash, filePath);
      }

      // 第一个应该还在 (因为被访问过)
      expect(CacheIndex.cache.has(entries[0].urlHash)).toBe(true);
      // 第二个应该被淘汰 (最久未访问)
      expect(CacheIndex.cache.has(entries[1].urlHash)).toBe(false);

      // 恢复原始 getter
      if (originalGetter) {
        Object.defineProperty(CacheIndex, 'maxEntries', originalGetter);
      }
    });
  });

  describe('snapshot', () => {
    it('should create snapshot file', () => {
      const urlHash = CacheIndex.hashUrl('https://example.com/test.png');
      const filePath = join(testDir, 'test.png');
      writeFileSync(filePath, 'content');

      CacheIndex.update(urlHash, filePath);

      const success = CacheIndex.snapshot();
      expect(success).toBe(true);

      // 使用 CacheIndex 的实际路径
      const snapshotPath = CacheIndex.snapshotPath;
      expect(existsSync(snapshotPath)).toBe(true);

      const data = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
      expect(data.version).toBe(1);
      expect(data.entries).toHaveLength(1);
      expect(data.entries[0].urlHash).toBe(urlHash);
      expect(data.entries[0].path).toBe(filePath);
    });

    it('should load from snapshot', () => {
      const urlHash = CacheIndex.hashUrl('https://example.com/test.png');
      const filePath = join(testDir, 'test.png');
      writeFileSync(filePath, 'content');

      CacheIndex.update(urlHash, filePath);
      CacheIndex.snapshot();

      // 清空缓存
      CacheIndex.clear();
      expect(CacheIndex.cache.size).toBe(0);

      // 从快照加载
      CacheIndex.loadSnapshot();
      expect(CacheIndex.cache.size).toBe(1);
      expect(CacheIndex.lookup(urlHash)).toBe(filePath);
    });

    it('should skip non-existent files when loading snapshot', () => {
      const urlHash1 = CacheIndex.hashUrl('https://example.com/exists.png');
      const urlHash2 = CacheIndex.hashUrl('https://example.com/deleted.png');
      const filePath1 = join(testDir, 'exists.png');
      const filePath2 = join(testDir, 'deleted.png');

      writeFileSync(filePath1, 'content1');
      writeFileSync(filePath2, 'content2');

      CacheIndex.update(urlHash1, filePath1);
      CacheIndex.update(urlHash2, filePath2);
      CacheIndex.snapshot();

      // 删除一个文件
      rmSync(filePath2);

      // 清空并重新加载
      CacheIndex.clear();
      CacheIndex.loadSnapshot();

      // 只应该加载存在的文件
      expect(CacheIndex.cache.size).toBe(1);
      expect(CacheIndex.lookup(urlHash1)).toBe(filePath1);
      expect(CacheIndex.lookup(urlHash2)).toBe(null);
    });
  });

  describe('log and replay', () => {
    it('should append log entries', () => {
      const urlHash = CacheIndex.hashUrl('https://example.com/test.png');
      const filePath = join(testDir, 'test.png');
      writeFileSync(filePath, 'content');

      CacheIndex.update(urlHash, filePath);

      // 使用 CacheIndex 的实际路径
      const logPath = CacheIndex.logPath;
      expect(existsSync(logPath)).toBe(true);

      const logContent = readFileSync(logPath, 'utf-8');
      const lines = logContent.trim().split('\n');

      expect(lines.length).toBeGreaterThan(0);

      const lastEntry = JSON.parse(lines[lines.length - 1]);
      expect(lastEntry.op).toBe('update');
      expect(lastEntry.urlHash).toBe(urlHash);
      expect(lastEntry.path).toBe(filePath);
    });

    it('should replay log on load', () => {
      const urlHash = CacheIndex.hashUrl('https://example.com/test.png');
      const filePath = join(testDir, 'test.png');
      writeFileSync(filePath, 'content');

      CacheIndex.update(urlHash, filePath);

      // 清空缓存但保留日志
      CacheIndex.cache.clear();
      CacheIndex.lruQueue = [];

      // Replay
      CacheIndex.replayLog();

      expect(CacheIndex.cache.size).toBe(1);
      expect(CacheIndex.lookup(urlHash)).toBe(filePath);
    });

    it('should handle delete operations in log', () => {
      const urlHash = CacheIndex.hashUrl('https://example.com/test.png');
      const filePath = join(testDir, 'test.png');
      writeFileSync(filePath, 'content');

      CacheIndex.update(urlHash, filePath);
      CacheIndex.delete(urlHash);

      // Replay
      CacheIndex.cache.clear();
      CacheIndex.lruQueue = [];
      CacheIndex.replayLog();

      // 应该被删除
      expect(CacheIndex.cache.has(urlHash)).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return cache statistics', () => {
      // 添加一些缓存项
      for (let i = 0; i < 3; i++) {
        const urlHash = CacheIndex.hashUrl(`https://example.com/file${i}.png`);
        const filePath = join(testDir, `file${i}.png`);
        writeFileSync(filePath, `content ${i}`);
        CacheIndex.update(urlHash, filePath);
      }

      const stats = CacheIndex.getStats();

      expect(stats.totalEntries).toBe(3);
      expect(stats.maxEntries).toBe(CacheIndex.maxEntries); // 使用实际值
      expect(parseFloat(stats.utilizationPercent)).toBeCloseTo((3 / CacheIndex.maxEntries) * 100, 1);
    });
  });

  describe('clear', () => {
    it('should clear all cache entries', () => {
      const urlHash = CacheIndex.hashUrl('https://example.com/test.png');
      const filePath = join(testDir, 'test.png');
      writeFileSync(filePath, 'content');

      CacheIndex.update(urlHash, filePath);
      expect(CacheIndex.cache.size).toBeGreaterThan(0);

      CacheIndex.clear();

      expect(CacheIndex.cache.size).toBe(0);
      expect(CacheIndex.lruQueue).toHaveLength(0);
    });
  });

  describe('load', () => {
    it('should load snapshot then replay log', () => {
      // 创建初始数据
      const urlHash1 = CacheIndex.hashUrl('https://example.com/file1.png');
      const filePath1 = join(testDir, 'file1.png');
      writeFileSync(filePath1, 'content1');
      CacheIndex.update(urlHash1, filePath1);

      // 保存快照
      CacheIndex.snapshot();

      // 添加更多数据 (只在日志中)
      const urlHash2 = CacheIndex.hashUrl('https://example.com/file2.png');
      const filePath2 = join(testDir, 'file2.png');
      writeFileSync(filePath2, 'content2');
      CacheIndex.update(urlHash2, filePath2);

      // 清空并重新加载
      CacheIndex.clear();
      CacheIndex.load();

      // 应该同时加载快照和日志的数据
      expect(CacheIndex.cache.size).toBe(2);
      expect(CacheIndex.lookup(urlHash1)).toBe(filePath1);
      expect(CacheIndex.lookup(urlHash2)).toBe(filePath2);
    });
  });
});
