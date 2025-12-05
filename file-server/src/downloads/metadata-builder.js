import { extname } from 'path';

const MIME_MAP = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.html': 'text/html'
};

class MetadataBuilder {
  detectMime(filename, fallback) {
    const ext = extname(filename || '').toLowerCase();
    if (ext && MIME_MAP[ext]) {
      return MIME_MAP[ext];
    }
    return fallback || 'application/octet-stream';
  }

  buildSuccess({ resource, storage, downloadInfo = null, cacheDetails = {} }) {
    return {
      url: resource.url,
      filename: resource.filename,
      status: 'success',
      absolutePath: storage.absolutePath,
      relativePath: storage.relativePath,
      relativePathFromDoc: storage.relativePathFromDoc,
      size: storage.size,
      mimeType: this.detectMime(resource.filename, downloadInfo?.contentType || storage.mimeType),
      cacheHit: cacheDetails.cacheHit ?? false,
      copiedFromCache: cacheDetails.copiedFromCache ?? false,
      fromPath: cacheDetails.fromPath || null,
      copyMethod: cacheDetails.copyMethod || null,
      downloadDuration: downloadInfo?.downloadDurationMs ?? null,
      startedAt: downloadInfo?.startedAt ? new Date(downloadInfo.startedAt).toISOString() : null,
      completedAt: downloadInfo?.completedAt ? new Date(downloadInfo.completedAt).toISOString() : null
    };
  }

  buildFailure({ resource, error }) {
    return {
      url: resource.url,
      filename: resource.filename,
      status: 'failed',
      errorCode: error?.code || 'UNKNOWN_ERROR',
      errorMessage: error?.message || 'Unknown download error',
      retryCount: error?.retryCount ?? 0
    };
  }
}

export default MetadataBuilder;
