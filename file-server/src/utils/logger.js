/**
 * 日志工具模块
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

class Logger {
  constructor(level = 'INFO') {
    this.level = LOG_LEVELS[level] || LOG_LEVELS.INFO;
    this.startTime = Date.now();
  }

  /**
   * 格式化日志消息
   */
  format(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const uptime = ((Date.now() - this.startTime) / 1000).toFixed(2);

    let msg = `[${timestamp}] [${level}] ${message}`;

    if (Object.keys(meta).length > 0) {
      msg += ' ' + JSON.stringify(meta);
    }

    msg += ` (uptime: ${uptime}s)`;
    return msg;
  }

  /**
   * Debug 级别日志
   */
  debug(message, meta) {
    if (this.level <= LOG_LEVELS.DEBUG) {
      console.log(this.format('DEBUG', message, meta));
    }
  }

  /**
   * Info 级别日志
   */
  info(message, meta) {
    if (this.level <= LOG_LEVELS.INFO) {
      console.log(this.format('INFO', message, meta));
    }
  }

  /**
   * Warn 级别日志
   */
  warn(message, meta) {
    if (this.level <= LOG_LEVELS.WARN) {
      console.warn(this.format('WARN', message, meta));
    }
  }

  /**
   * Error 级别日志
   */
  error(message, meta) {
    if (this.level <= LOG_LEVELS.ERROR) {
      console.error(this.format('ERROR', message, meta));
    }
  }

  /**
   * 设置日志级别
   */
  setLevel(level) {
    this.level = LOG_LEVELS[level] || LOG_LEVELS.INFO;
  }
}

// 导出单例
export default new Logger(process.env.LOG_LEVEL || 'INFO');
