import { resolve, relative, dirname, basename } from 'path';
import { existsSync, mkdirSync, copyFileSync, linkSync, statSync, renameSync } from 'fs';
import { execSync } from 'child_process';
import pathGuard from '../security/path-guard.js';
import logger from '../utils/logger.js';

/**
 * 存储驱动 - 负责文件系统操作
 */
class StorageDriver {
  /**
   * 确保目录存在
   */
  ensureDirectory(dirPath) {
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
      logger.debug(`Directory created: ${dirPath}`);
    }
  }

  /**
   * 验证并准备保存路径
   */
  prepareSavePath(saveDir, filename, profile = 'default') {
    // 验证文件名安全
    pathGuard.validateFilename(filename);

    // 验证目录在白名单内
    const validatedDir = pathGuard.validatePath(saveDir, profile);

    // 确保目录存在
    this.ensureDirectory(validatedDir);

    // 返回完整路径
    return resolve(validatedDir, filename);
  }

  /**
   * 计算相对路径
   */
  calculateRelativePaths(absolutePath, relativeTo, docPath) {
    const result = {
      absolutePath,
      relativePath: null,
      relativePathFromDoc: null
    };

    // 计算相对于 relativeTo 的路径
    if (relativeTo) {
      try {
        result.relativePath = relative(relativeTo, absolutePath);
      } catch (error) {
        logger.warn('Failed to calculate relativePath', { error: error.message });
      }
    }

    // 计算相对于文档的路径
    if (docPath) {
      try {
        const docDir = dirname(docPath);
        result.relativePathFromDoc = relative(docDir, absolutePath);
      } catch (error) {
        logger.warn('Failed to calculate relativePathFromDoc', { error: error.message });
      }
    }

    return result;
  }

  /**
   * 尝试 APFS clone (macOS only)
   */
  tryApfsClone(sourcePath, targetPath) {
    if (process.platform !== 'darwin') {
      return false;
    }

    try {
      // 使用 cp -c 进行 APFS clone
      execSync(`cp -c "${sourcePath}" "${targetPath}"`, { stdio: 'ignore' });
      logger.debug('APFS clone successful', { from: sourcePath, to: targetPath });
      return true;
    } catch (error) {
      logger.debug('APFS clone failed', { error: error.message });
      return false;
    }
  }

  /**
   * 尝试创建硬链接
   */
  tryHardLink(sourcePath, targetPath) {
    try {
      linkSync(sourcePath, targetPath);
      logger.debug('Hard link created', { from: sourcePath, to: targetPath });
      return true;
    } catch (error) {
      logger.debug('Hard link failed', { error: error.message });
      return false;
    }
  }

  /**
   * 普通文件复制
   */
  copyFile(sourcePath, targetPath) {
    copyFileSync(sourcePath, targetPath);
    logger.debug('File copied', { from: sourcePath, to: targetPath });
    return true;
  }

  /**
   * 智能文件复制 (优先 APFS clone > 硬链接 > 普通复制)
   */
  smartCopy(sourcePath, targetPath) {
    // 确保目标目录存在
    this.ensureDirectory(dirname(targetPath));

    let method = 'copy';

    // 1. 尝试 APFS clone
    if (this.tryApfsClone(sourcePath, targetPath)) {
      method = 'apfs-clone';
    }
    // 2. 尝试硬链接
    else if (this.tryHardLink(sourcePath, targetPath)) {
      method = 'hardlink';
    }
    // 3. 普通复制
    else {
      this.copyFile(sourcePath, targetPath);
    }

    return {
      success: true,
      method,
      sourcePath,
      targetPath
    };
  }

  /**
   * 处理缓存命中 - 相同路径
   */
  handleCacheHitSamePath(cachedPath, relativeTo, docPath) {
    if (!existsSync(cachedPath)) {
      throw new Error(`Cached file does not exist: ${cachedPath}`);
    }

    const paths = this.calculateRelativePaths(cachedPath, relativeTo, docPath);
    const stats = statSync(cachedPath);

    return {
      ...paths,
      size: stats.size,
      cacheHit: true,
      copiedFromCache: false,
      fromPath: null,
      copyMethod: null
    };
  }

  /**
   * 处理缓存命中 - 不同路径 (需要复制)
   */
  handleCacheHitDifferentPath(cachedPath, targetPath, relativeTo, docPath) {
    if (!existsSync(cachedPath)) {
      throw new Error(`Cached file does not exist: ${cachedPath}`);
    }

    // 智能复制
    const copyResult = this.smartCopy(cachedPath, targetPath);

    const paths = this.calculateRelativePaths(targetPath, relativeTo, docPath);
    const stats = statSync(targetPath);

    return {
      ...paths,
      size: stats.size,
      cacheHit: true,
      copiedFromCache: true,
      fromPath: cachedPath,
      copyMethod: copyResult.method
    };
  }

  /**
   * 处理下载结果 (从临时文件移动到目标路径)
   */
  handleDownloadResult(tempPath, targetPath, relativeTo, docPath) {
    if (!existsSync(tempPath)) {
      throw new Error(`Temp file does not exist: ${tempPath}`);
    }

    // 确保目标目录存在
    this.ensureDirectory(dirname(targetPath));

    // 移动文件 (rename 是原子操作)
    renameSync(tempPath, targetPath);
    logger.debug('File moved from temp to target', { from: tempPath, to: targetPath });

    const paths = this.calculateRelativePaths(targetPath, relativeTo, docPath);
    const stats = statSync(targetPath);

    return {
      ...paths,
      size: stats.size,
      cacheHit: false,
      copiedFromCache: false,
      fromPath: null,
      copyMethod: null
    };
  }

  /**
   * 获取文件元数据
   */
  getFileMetadata(filePath) {
    if (!existsSync(filePath)) {
      throw new Error(`File does not exist: ${filePath}`);
    }

    const stats = statSync(filePath);
    const ext = basename(filePath).split('.').pop()?.toLowerCase();

    return {
      size: stats.size,
      mtime: stats.mtime,
      extension: ext || null,
      exists: true
    };
  }
}

export default new StorageDriver();
