import { resolve, relative, dirname } from 'path';
import { existsSync, lstatSync } from 'fs';
import config from '../utils/config.js';
import logger from '../utils/logger.js';

/**
 * 路径安全守卫
 */
class PathGuard {
  /**
   * 验证路径是否安全
   */
  validatePath(targetPath, profile = 'default') {
    // 1. 解析为绝对路径
    const absolutePath = resolve(targetPath);

    // 2. 检查是否在白名单内
    if (!config.isPathAllowed(absolutePath, profile)) {
      logger.warn('Path not in whitelist', { path: absolutePath, profile });
      throw new Error(`Path "${absolutePath}" is not in the allowed whitelist for profile "${profile}"`);
    }

    // 3. 检查路径遍历攻击
    const allowedPaths = config.get(`profiles.${profile}`);
    let isWithinAllowed = false;

    for (const allowed of allowedPaths) {
      const resolvedAllowed = resolve(allowed);
      const relativePath = relative(resolvedAllowed, absolutePath);

      // 如果相对路径不以 .. 开头,说明在允许的目录内
      if (!relativePath.startsWith('..') && !resolve(resolvedAllowed, relativePath).includes('..')) {
        isWithinAllowed = true;
        break;
      }
    }

    if (!isWithinAllowed) {
      logger.warn('Path traversal detected', { path: absolutePath });
      throw new Error(`Path traversal detected: "${absolutePath}"`);
    }

    // 4. 检查符号链接逃逸
    if (existsSync(absolutePath)) {
      const stats = lstatSync(absolutePath);
      if (stats.isSymbolicLink()) {
        logger.warn('Symbolic link not allowed', { path: absolutePath });
        throw new Error(`Symbolic links are not allowed: "${absolutePath}"`);
      }
    }

    return absolutePath;
  }

  /**
   * 验证文件名是否安全
   */
  validateFilename(filename) {
    // 检查是否包含路径分隔符
    if (filename.includes('/') || filename.includes('\\')) {
      throw new Error(`Filename contains path separators: "${filename}"`);
    }

    // 检查控制字符
    if (/[\x00-\x1f\x7f]/.test(filename)) {
      throw new Error(`Filename contains control characters: "${filename}"`);
    }

    // 检查是否为保留名称 (Windows)
    const reserved = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'];
    const nameWithoutExt = filename.split('.')[0].toUpperCase();
    if (reserved.includes(nameWithoutExt)) {
      throw new Error(`Filename is a reserved name: "${filename}"`);
    }

    return filename;
  }

  /**
   * 验证保存目录和文件名
   */
  validateSavePath(saveDir, filename, profile = 'default') {
    this.validateFilename(filename);
    const validatedDir = this.validatePath(saveDir, profile);
    return resolve(validatedDir, filename);
  }
}

export default new PathGuard();
