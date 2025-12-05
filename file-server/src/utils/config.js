import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { nanoid } from 'nanoid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '../..');

/**
 * 配置管理模块
 */
class Config {
  constructor() {
    this.configPath = join(PROJECT_ROOT, 'data', 'config.json');
    this.config = this.loadConfig();
  }

  /**
   * 加载配置
   */
  loadConfig() {
    // 默认配置
    const defaults = {
      server: {
        port: 3456,
        host: '127.0.0.1'
      },
      auth: {
        token: nanoid(32)
      },
      paths: {
        dataDir: join(PROJECT_ROOT, 'data'),
        cacheDir: join(PROJECT_ROOT, 'data', 'cache'),
        jobsDir: join(PROJECT_ROOT, 'data', 'jobs')
      },
      profiles: {
        'default': [
          join(process.env.HOME || '~', 'Documents', 'maoxian-clips')
        ]
      },
      queue: {
        globalConcurrency: 4,
        hostConcurrency: 2,
        hostThrottleMs: 1000
      },
      cache: {
        maxEntries: 10000,
        maxSizeBytes: 10 * 1024 * 1024 * 1024 // 10GB
      },
      download: {
        connectTimeoutMs: 10000,
        readTimeoutMs: 30000,
        maxRetries: 2,
        retryDelayMs: 1000
      }
    };

    // 尝试加载已有配置
    if (existsSync(this.configPath)) {
      try {
        const loaded = JSON.parse(readFileSync(this.configPath, 'utf-8'));
        return this.mergeConfig(defaults, loaded);
      } catch (error) {
        console.warn('Failed to load config, using defaults:', error.message);
        return defaults;
      }
    }

    // 保存默认配置
    this.saveConfig(defaults);
    return defaults;
  }

  /**
   * 深度合并配置
   */
  mergeConfig(defaults, loaded) {
    const merged = { ...defaults };
    for (const key in loaded) {
      if (typeof loaded[key] === 'object' && !Array.isArray(loaded[key])) {
        merged[key] = { ...defaults[key], ...loaded[key] };
      } else {
        merged[key] = loaded[key];
      }
    }
    return merged;
  }

  /**
   * 保存配置
   */
  saveConfig(config) {
    const dataDir = dirname(this.configPath);
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    writeFileSync(this.configPath, JSON.stringify(config || this.config, null, 2));
  }

  /**
   * 获取配置值
   */
  get(path) {
    const parts = path.split('.');
    let value = this.config;
    for (const part of parts) {
      value = value?.[part];
    }
    return value;
  }

  /**
   * 设置配置值
   */
  set(path, value) {
    const parts = path.split('.');
    let target = this.config;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!target[parts[i]]) {
        target[parts[i]] = {};
      }
      target = target[parts[i]];
    }
    target[parts[parts.length - 1]] = value;
    this.saveConfig();
  }

  /**
   * 验证路径是否在白名单内
   */
  isPathAllowed(path, profile = 'default') {
    const allowedPaths = this.config.profiles[profile];
    if (!allowedPaths || !Array.isArray(allowedPaths)) {
      return false;
    }
    return allowedPaths.some(allowed => path.startsWith(allowed));
  }

  /**
   * 确保必要的目录存在
   */
  ensureDirectories() {
    const dirs = [
      this.config.paths.dataDir,
      this.config.paths.cacheDir,
      this.config.paths.jobsDir
    ];
    for (const dir of dirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }
}

// 导出单例
export default new Config();
