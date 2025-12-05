import { createHash } from 'crypto';
import { existsSync, writeFileSync, readFileSync, appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import config from '../utils/config.js';
import logger from '../utils/logger.js';

/**
 * 缓存索引 - 管理 URL 哈希到文件路径的映射
 */
class CacheIndex {
  constructor() {
    this.cache = new Map(); // urlHash -> { path, lastAccessedAt, hits }
    this.lruQueue = []; // LRU 队列 (按访问时间排序)

    // 启动时加载
    this.load();
  }

  /**
   * 动态获取日志路径
   */
  get logPath() {
    const dataDir = config.get('paths.cacheDir');
    return join(dataDir, 'cache-index.log');
  }

  /**
   * 动态获取快照路径
   */
  get snapshotPath() {
    const dataDir = config.get('paths.cacheDir');
    return join(dataDir, 'cache-index.json');
  }

  /**
   * 动态获取最大条目数
   */
  get maxEntries() {
    return config.get('cache.maxEntries') || 10000;
  }

  /**
   * 计算 URL 哈希 (SHA-1)
   */
  hashUrl(url) {
    return createHash('sha1').update(url.trim()).digest('hex');
  }

  /**
   * 查询缓存
   */
  lookup(urlHash) {
    const entry = this.cache.get(urlHash);

    if (!entry) {
      return null;
    }

    // 检查文件是否仍然存在
    if (!existsSync(entry.path)) {
      logger.debug('Cache entry invalid, file not found', { urlHash, path: entry.path });
      this.delete(urlHash);
      return null;
    }

    // 更新访问时间和计数
    entry.lastAccessedAt = Date.now();
    entry.hits = (entry.hits || 0) + 1;

    // 更新 LRU 队列
    this.updateLRU(urlHash);

    logger.debug('Cache hit', { urlHash, path: entry.path, hits: entry.hits });
    return entry.path;
  }

  /**
   * 更新缓存
   */
  update(urlHash, path) {
    const entry = {
      path,
      lastAccessedAt: Date.now(),
      hits: 1
    };

    this.cache.set(urlHash, entry);
    this.updateLRU(urlHash);

    // 检查是否需要淘汰
    if (this.cache.size > this.maxEntries) {
      this.evictLRU();
    }

    // 写入日志
    this.appendLog({ op: 'update', urlHash, path, timestamp: Date.now() });

    logger.debug('Cache updated', { urlHash, path });
  }

  /**
   * 删除缓存项
   */
  delete(urlHash) {
    if (!this.cache.has(urlHash)) {
      return false;
    }

    const entry = this.cache.get(urlHash);
    this.cache.delete(urlHash);

    // 从 LRU 队列中移除
    this.lruQueue = this.lruQueue.filter(hash => hash !== urlHash);

    // 写入日志
    this.appendLog({ op: 'delete', urlHash, timestamp: Date.now() });

    logger.debug('Cache entry deleted', { urlHash, path: entry.path });
    return true;
  }

  /**
   * 更新 LRU 队列
   */
  updateLRU(urlHash) {
    // 移除旧位置
    this.lruQueue = this.lruQueue.filter(hash => hash !== urlHash);
    // 添加到队尾 (最近使用)
    this.lruQueue.push(urlHash);
  }

  /**
   * LRU 淘汰
   */
  evictLRU() {
    if (this.lruQueue.length === 0) {
      return;
    }

    // 淘汰队首 (最久未使用)
    const victimHash = this.lruQueue.shift();
    const entry = this.cache.get(victimHash);

    if (entry) {
      logger.info('LRU eviction', { urlHash: victimHash, path: entry.path, hits: entry.hits });
      this.delete(victimHash);
    }
  }

  /**
   * 追加日志
   */
  appendLog(logEntry) {
    try {
      const logDir = dirname(this.logPath);
      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
      }

      appendFileSync(this.logPath, JSON.stringify(logEntry) + '\n');
    } catch (error) {
      logger.error('Failed to append cache log', { error: error.message });
    }
  }

  /**
   * 生成快照
   */
  snapshot() {
    try {
      const data = {
        version: 1,
        timestamp: Date.now(),
        entries: Array.from(this.cache.entries()).map(([urlHash, entry]) => ({
          urlHash,
          ...entry
        }))
      };

      const snapshotDir = dirname(this.snapshotPath);
      if (!existsSync(snapshotDir)) {
        mkdirSync(snapshotDir, { recursive: true });
      }

      writeFileSync(this.snapshotPath, JSON.stringify(data, null, 2));
      logger.info('Cache snapshot created', { entries: data.entries.length });

      return true;
    } catch (error) {
      logger.error('Failed to create snapshot', { error: error.message });
      return false;
    }
  }

  /**
   * 从快照加载
   */
  loadSnapshot() {
    if (!existsSync(this.snapshotPath)) {
      logger.debug('No snapshot found');
      return;
    }

    try {
      const data = JSON.parse(readFileSync(this.snapshotPath, 'utf-8'));

      for (const item of data.entries) {
        // 验证文件是否存在
        if (existsSync(item.path)) {
          this.cache.set(item.urlHash, {
            path: item.path,
            lastAccessedAt: item.lastAccessedAt,
            hits: item.hits || 0
          });
        }
      }

      // 重建 LRU 队列 (按访问时间排序)
      this.lruQueue = Array.from(this.cache.keys()).sort((a, b) => {
        return this.cache.get(a).lastAccessedAt - this.cache.get(b).lastAccessedAt;
      });

      logger.info('Cache snapshot loaded', { entries: this.cache.size });
    } catch (error) {
      logger.error('Failed to load snapshot', { error: error.message });
    }
  }

  /**
   * Replay 日志
   */
  replayLog() {
    if (!existsSync(this.logPath)) {
      logger.debug('No log file found');
      return;
    }

    try {
      const logs = readFileSync(this.logPath, 'utf-8').split('\n').filter(line => line.trim());

      let replayed = 0;
      for (const line of logs) {
        try {
          const entry = JSON.parse(line);

          if (entry.op === 'update') {
            if (existsSync(entry.path)) {
              this.cache.set(entry.urlHash, {
                path: entry.path,
                lastAccessedAt: entry.timestamp,
                hits: 1
              });
              replayed++;
            }
          } else if (entry.op === 'delete') {
            this.cache.delete(entry.urlHash);
          }
        } catch (parseError) {
          logger.warn('Failed to parse log entry', { error: parseError.message });
        }
      }

      logger.info('Cache log replayed', { entries: replayed });
    } catch (error) {
      logger.error('Failed to replay log', { error: error.message });
    }
  }

  /**
   * 加载缓存 (Snapshot + Log Replay)
   */
  load() {
    logger.info('Loading cache index...');

    // 1. 加载快照
    this.loadSnapshot();

    // 2. Replay 日志
    this.replayLog();

    logger.info('Cache index loaded', { entries: this.cache.size });
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      totalEntries: this.cache.size,
      maxEntries: this.maxEntries,
      utilizationPercent: ((this.cache.size / this.maxEntries) * 100).toFixed(2)
    };
  }

  /**
   * 清理所有缓存
   */
  clear() {
    this.cache.clear();
    this.lruQueue = [];
    logger.info('Cache cleared');
  }
}

export default new CacheIndex();
