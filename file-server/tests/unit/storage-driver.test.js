import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import storageDriver from '../../src/downloads/storage-driver.js';
import config from '../../src/utils/config.js';

describe('StorageDriver', () => {
  const testDir = join(process.cwd(), 'data', 'test-storage');
  const testProfile = 'test-profile';

  beforeEach(() => {
    // 创建测试目录
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }

    // 添加测试白名单
    config.set(`profiles.${testProfile}`, [testDir]);
  });

  afterEach(() => {
    // 清理测试目录
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }

    // 删除测试配置
    const profiles = config.get('profiles');
    delete profiles[testProfile];
    config.set('profiles', profiles);
  });

  describe('ensureDirectory', () => {
    it('should create directory if not exists', () => {
      const newDir = join(testDir, 'subdir', 'nested');
      storageDriver.ensureDirectory(newDir);

      expect(existsSync(newDir)).toBe(true);
    });

    it('should not throw if directory already exists', () => {
      storageDriver.ensureDirectory(testDir);
      expect(() => storageDriver.ensureDirectory(testDir)).not.toThrow();
    });
  });

  describe('prepareSavePath', () => {
    it('should validate and return absolute path', () => {
      const filename = 'test.txt';
      const result = storageDriver.prepareSavePath(testDir, filename, testProfile);

      expect(result).toBe(join(testDir, filename));
      expect(existsSync(testDir)).toBe(true);
    });

    it('should throw for invalid filename', () => {
      expect(() => {
        storageDriver.prepareSavePath(testDir, '../evil.txt', testProfile);
      }).toThrow();
    });

    it('should throw for path not in whitelist', () => {
      expect(() => {
        storageDriver.prepareSavePath('/tmp/evil', 'test.txt', testProfile);
      }).toThrow();
    });
  });

  describe('calculateRelativePaths', () => {
    it('should calculate both relative paths', () => {
      const absolutePath = join(testDir, 'assets', 'image.png');
      const relativeTo = testDir;
      const docPath = join(testDir, 'doc.md');

      const result = storageDriver.calculateRelativePaths(absolutePath, relativeTo, docPath);

      expect(result.absolutePath).toBe(absolutePath);
      expect(result.relativePath).toBe('assets/image.png');
      expect(result.relativePathFromDoc).toBe('assets/image.png');
    });

    it('should handle nested documents', () => {
      const absolutePath = join(testDir, 'assets', 'images', 'photo.jpg');
      const docPath = join(testDir, 'articles', '2025', 'post.md');

      const result = storageDriver.calculateRelativePaths(absolutePath, null, docPath);

      expect(result.relativePathFromDoc).toBe('../../assets/images/photo.jpg');
    });
  });

  describe('smartCopy', () => {
    it('should copy file successfully', () => {
      const sourcePath = join(testDir, 'source.txt');
      const targetPath = join(testDir, 'target.txt');

      // 创建源文件
      writeFileSync(sourcePath, 'test content');

      const result = storageDriver.smartCopy(sourcePath, targetPath);

      expect(result.success).toBe(true);
      expect(result.method).toMatch(/apfs-clone|hardlink|copy/);
      expect(existsSync(targetPath)).toBe(true);
    });

    it('should create target directory if not exists', () => {
      const sourcePath = join(testDir, 'source.txt');
      const targetPath = join(testDir, 'nested', 'dir', 'target.txt');

      writeFileSync(sourcePath, 'test content');

      storageDriver.smartCopy(sourcePath, targetPath);

      expect(existsSync(targetPath)).toBe(true);
    });
  });

  describe('handleCacheHitSamePath', () => {
    it('should return metadata for cached file', () => {
      const cachedPath = join(testDir, 'cached.txt');
      writeFileSync(cachedPath, 'cached content');

      const result = storageDriver.handleCacheHitSamePath(
        cachedPath,
        testDir,
        join(testDir, 'doc.md')
      );

      expect(result.absolutePath).toBe(cachedPath);
      expect(result.cacheHit).toBe(true);
      expect(result.copiedFromCache).toBe(false);
      expect(result.size).toBeGreaterThan(0);
    });

    it('should throw if cached file does not exist', () => {
      const nonExistentPath = join(testDir, 'nonexistent.txt');

      expect(() => {
        storageDriver.handleCacheHitSamePath(nonExistentPath, testDir, null);
      }).toThrow('Cached file does not exist');
    });
  });

  describe('handleCacheHitDifferentPath', () => {
    it('should copy cached file to new location', () => {
      const cachedPath = join(testDir, 'cached.txt');
      const targetPath = join(testDir, 'new-location.txt');

      writeFileSync(cachedPath, 'cached content');

      const result = storageDriver.handleCacheHitDifferentPath(
        cachedPath,
        targetPath,
        testDir,
        join(testDir, 'doc.md')
      );

      expect(result.absolutePath).toBe(targetPath);
      expect(result.cacheHit).toBe(true);
      expect(result.copiedFromCache).toBe(true);
      expect(result.fromPath).toBe(cachedPath);
      expect(result.copyMethod).toMatch(/apfs-clone|hardlink|copy/);
      expect(existsSync(targetPath)).toBe(true);
    });
  });

  describe('handleDownloadResult', () => {
    it('should move temp file to target', () => {
      const tempPath = join(testDir, 'temp.txt');
      const targetPath = join(testDir, 'final.txt');

      writeFileSync(tempPath, 'downloaded content');

      const result = storageDriver.handleDownloadResult(
        tempPath,
        targetPath,
        testDir,
        join(testDir, 'doc.md')
      );

      expect(result.absolutePath).toBe(targetPath);
      expect(result.cacheHit).toBe(false);
      expect(result.copiedFromCache).toBe(false);
      expect(existsSync(targetPath)).toBe(true);
      expect(existsSync(tempPath)).toBe(false);
    });
  });

  describe('getFileMetadata', () => {
    it('should return file metadata', () => {
      const filePath = join(testDir, 'test.png');
      writeFileSync(filePath, 'image data');

      const metadata = storageDriver.getFileMetadata(filePath);

      expect(metadata.size).toBeGreaterThan(0);
      expect(metadata.extension).toBe('png');
      expect(metadata.exists).toBe(true);
      expect(metadata.mtime).toBeInstanceOf(Date);
    });

    it('should throw if file does not exist', () => {
      expect(() => {
        storageDriver.getFileMetadata(join(testDir, 'nonexistent.txt'));
      }).toThrow('File does not exist');
    });
  });
});
