import { describe, it, expect, beforeEach } from 'vitest';
import MetadataBuilder from '../../src/downloads/metadata-builder.js';

describe('MetadataBuilder', () => {
  let builder;

  beforeEach(() => {
    builder = new MetadataBuilder();
  });

  describe('detectMime', () => {
    it('should detect common image types', () => {
      expect(builder.detectMime('image.jpg')).toBe('image/jpeg');
      expect(builder.detectMime('image.jpeg')).toBe('image/jpeg');
      expect(builder.detectMime('image.png')).toBe('image/png');
      expect(builder.detectMime('image.gif')).toBe('image/gif');
      expect(builder.detectMime('image.webp')).toBe('image/webp');
      expect(builder.detectMime('image.svg')).toBe('image/svg+xml');
      expect(builder.detectMime('image.bmp')).toBe('image/bmp');
      expect(builder.detectMime('image.avif')).toBe('image/avif');
    });

    it('should detect video types', () => {
      expect(builder.detectMime('video.mp4')).toBe('video/mp4');
      expect(builder.detectMime('video.webm')).toBe('video/webm');
    });

    it('should detect audio types', () => {
      expect(builder.detectMime('audio.mp3')).toBe('audio/mpeg');
      expect(builder.detectMime('audio.wav')).toBe('audio/wav');
    });

    it('should detect document types', () => {
      expect(builder.detectMime('file.txt')).toBe('text/plain');
      expect(builder.detectMime('file.md')).toBe('text/markdown');
      expect(builder.detectMime('file.html')).toBe('text/html');
      expect(builder.detectMime('file.css')).toBe('text/css');
      expect(builder.detectMime('file.js')).toBe('text/javascript');
      expect(builder.detectMime('file.json')).toBe('application/json');
      expect(builder.detectMime('file.pdf')).toBe('application/pdf');
    });

    it('should be case insensitive', () => {
      expect(builder.detectMime('IMAGE.PNG')).toBe('image/png');
      expect(builder.detectMime('File.PDF')).toBe('application/pdf');
      expect(builder.detectMime('VIDEO.MP4')).toBe('video/mp4');
    });

    it('should return fallback for unknown extensions', () => {
      expect(builder.detectMime('file.unknown')).toBe('application/octet-stream');
      expect(builder.detectMime('file.xyz', 'custom/type')).toBe('custom/type');
    });

    it('should handle files without extensions', () => {
      expect(builder.detectMime('filename')).toBe('application/octet-stream');
      expect(builder.detectMime('filename', 'text/plain')).toBe('text/plain');
    });

    it('should handle null or undefined filename', () => {
      expect(builder.detectMime(null)).toBe('application/octet-stream');
      expect(builder.detectMime(undefined)).toBe('application/octet-stream');
      expect(builder.detectMime(null, 'custom/fallback')).toBe('custom/fallback');
    });

    it('should handle empty filename', () => {
      expect(builder.detectMime('')).toBe('application/octet-stream');
    });
  });

  describe('buildSuccess', () => {
    it('should build complete success metadata with download info', () => {
      const resource = {
        url: 'https://example.com/image.png',
        filename: 'image.png'
      };

      const storage = {
        absolutePath: '/path/to/image.png',
        relativePath: 'images/image.png',
        relativePathFromDoc: '../images/image.png',
        size: 1024,
        mimeType: 'image/png'
      };

      const downloadInfo = {
        contentType: 'image/png',
        downloadDurationMs: 500,
        startedAt: Date.now(),
        completedAt: Date.now() + 500
      };

      const cacheDetails = {
        cacheHit: false,
        copiedFromCache: false
      };

      const result = builder.buildSuccess({
        resource,
        storage,
        downloadInfo,
        cacheDetails
      });

      expect(result.url).toBe('https://example.com/image.png');
      expect(result.filename).toBe('image.png');
      expect(result.status).toBe('success');
      expect(result.absolutePath).toBe('/path/to/image.png');
      expect(result.relativePath).toBe('images/image.png');
      expect(result.relativePathFromDoc).toBe('../images/image.png');
      expect(result.size).toBe(1024);
      expect(result.mimeType).toBe('image/png');
      expect(result.cacheHit).toBe(false);
      expect(result.copiedFromCache).toBe(false);
      expect(result.fromPath).toBeNull();
      expect(result.copyMethod).toBeNull();
      expect(result.downloadDuration).toBe(500);
      expect(result.startedAt).not.toBeNull();
      expect(result.completedAt).not.toBeNull();
    });

    it('should build success metadata for cache hit (same path)', () => {
      const resource = {
        url: 'https://example.com/image.png',
        filename: 'image.png'
      };

      const storage = {
        absolutePath: '/path/to/image.png',
        relativePath: 'images/image.png',
        relativePathFromDoc: '../images/image.png',
        size: 2048,
        mimeType: 'image/png'
      };

      const cacheDetails = {
        cacheHit: true,
        copiedFromCache: false,
        fromPath: null,
        copyMethod: null
      };

      const result = builder.buildSuccess({
        resource,
        storage,
        cacheDetails
      });

      expect(result.status).toBe('success');
      expect(result.cacheHit).toBe(true);
      expect(result.copiedFromCache).toBe(false);
      expect(result.fromPath).toBeNull();
      expect(result.copyMethod).toBeNull();
      expect(result.downloadDuration).toBeNull();
    });

    it('should build success metadata for cache hit (different path)', () => {
      const resource = {
        url: 'https://example.com/image.png',
        filename: 'image.png'
      };

      const storage = {
        absolutePath: '/path/to/new/image.png',
        relativePath: 'new/image.png',
        relativePathFromDoc: '../new/image.png',
        size: 2048,
        mimeType: 'image/png',
        copyMethod: 'hardlink'
      };

      const cacheDetails = {
        cacheHit: true,
        copiedFromCache: true,
        fromPath: '/path/to/old/image.png',
        copyMethod: 'hardlink'
      };

      const result = builder.buildSuccess({
        resource,
        storage,
        cacheDetails
      });

      expect(result.cacheHit).toBe(true);
      expect(result.copiedFromCache).toBe(true);
      expect(result.fromPath).toBe('/path/to/old/image.png');
      expect(result.copyMethod).toBe('hardlink');
    });

    it('should detect MIME from filename extension', () => {
      const resource = {
        url: 'https://example.com/file.pdf',
        filename: 'file.pdf'
      };

      const storage = {
        absolutePath: '/path/to/file.pdf',
        relativePath: 'files/file.pdf',
        relativePathFromDoc: '../files/file.pdf',
        size: 5000,
        mimeType: null
      };

      const result = builder.buildSuccess({
        resource,
        storage,
        cacheDetails: {}
      });

      expect(result.mimeType).toBe('application/pdf');
    });

    it('should prefer download contentType over file extension', () => {
      const resource = {
        url: 'https://example.com/image',
        filename: 'image'
      };

      const storage = {
        absolutePath: '/path/to/image',
        relativePath: 'images/image',
        relativePathFromDoc: '../images/image',
        size: 1024,
        mimeType: null
      };

      const downloadInfo = {
        contentType: 'image/jpeg'
      };

      const result = builder.buildSuccess({
        resource,
        storage,
        downloadInfo,
        cacheDetails: {}
      });

      expect(result.mimeType).toBe('image/jpeg');
    });

    it('should handle missing download info', () => {
      const resource = {
        url: 'https://example.com/image.png',
        filename: 'image.png'
      };

      const storage = {
        absolutePath: '/path/to/image.png',
        relativePath: 'images/image.png',
        relativePathFromDoc: '../images/image.png',
        size: 1024,
        mimeType: 'image/png'
      };

      const result = builder.buildSuccess({
        resource,
        storage,
        cacheDetails: {}
      });

      expect(result.downloadDuration).toBeNull();
      expect(result.startedAt).toBeNull();
      expect(result.completedAt).toBeNull();
    });

    it('should use default values for missing cache details', () => {
      const resource = {
        url: 'https://example.com/image.png',
        filename: 'image.png'
      };

      const storage = {
        absolutePath: '/path/to/image.png',
        relativePath: 'images/image.png',
        relativePathFromDoc: '../images/image.png',
        size: 1024,
        mimeType: 'image/png'
      };

      const result = builder.buildSuccess({
        resource,
        storage
      });

      expect(result.cacheHit).toBe(false);
      expect(result.copiedFromCache).toBe(false);
      expect(result.fromPath).toBeNull();
      expect(result.copyMethod).toBeNull();
    });
  });

  describe('buildFailure', () => {
    it('should build complete failure metadata', () => {
      const resource = {
        url: 'https://example.com/image.png',
        filename: 'image.png'
      };

      const error = {
        code: 'NETWORK_ERROR',
        message: 'Failed to connect to server',
        retryCount: 2
      };

      const result = builder.buildFailure({
        resource,
        error
      });

      expect(result.url).toBe('https://example.com/image.png');
      expect(result.filename).toBe('image.png');
      expect(result.status).toBe('failed');
      expect(result.errorCode).toBe('NETWORK_ERROR');
      expect(result.errorMessage).toBe('Failed to connect to server');
      expect(result.retryCount).toBe(2);
    });

    it('should handle error without code', () => {
      const resource = {
        url: 'https://example.com/image.png',
        filename: 'image.png'
      };

      const error = {
        message: 'Something went wrong'
      };

      const result = builder.buildFailure({
        resource,
        error
      });

      expect(result.errorCode).toBe('UNKNOWN_ERROR');
      expect(result.errorMessage).toBe('Something went wrong');
      expect(result.retryCount).toBe(0);
    });

    it('should handle error without message', () => {
      const resource = {
        url: 'https://example.com/image.png',
        filename: 'image.png'
      };

      const error = {
        code: 'TIMEOUT'
      };

      const result = builder.buildFailure({
        resource,
        error
      });

      expect(result.errorCode).toBe('TIMEOUT');
      expect(result.errorMessage).toBe('Unknown download error');
    });

    it('should handle undefined error', () => {
      const resource = {
        url: 'https://example.com/image.png',
        filename: 'image.png'
      };

      const result = builder.buildFailure({
        resource,
        error: undefined
      });

      expect(result.errorCode).toBe('UNKNOWN_ERROR');
      expect(result.errorMessage).toBe('Unknown download error');
      expect(result.retryCount).toBe(0);
    });

    it('should handle null error', () => {
      const resource = {
        url: 'https://example.com/image.png',
        filename: 'image.png'
      };

      const result = builder.buildFailure({
        resource,
        error: null
      });

      expect(result.errorCode).toBe('UNKNOWN_ERROR');
      expect(result.errorMessage).toBe('Unknown download error');
      expect(result.retryCount).toBe(0);
    });

    it('should handle zero retry count', () => {
      const resource = {
        url: 'https://example.com/image.png',
        filename: 'image.png'
      };

      const error = {
        code: 'NOT_FOUND',
        message: '404 Not Found',
        retryCount: 0
      };

      const result = builder.buildFailure({
        resource,
        error
      });

      expect(result.retryCount).toBe(0);
    });
  });
});
