"use strict";

import Log from '../lib/log.js';
import MxWcConfig from '../lib/config.js';
import SavingTool from '../saving/new-saving-tool.js';

/**
 * File Server Handler
 * 与本地 file-server 通信,批量下载资源
 */

let TaskFetcher = null;
let cachedConfig = null;

function init(global) {
  TaskFetcher = global.TaskFetcher;
}

async function loadConfig() {
  if (!cachedConfig) {
    cachedConfig = await MxWcConfig.load();
  }
  return cachedConfig;
}

async function getInfo(callback) {
  const config = await loadConfig();

  if (!config.handlerFileServerEnabled || !config.fileServer) {
    callback({
      ok: false,
      ready: false,
      message: 'File Server not configured or disabled'
    });
    return;
  }

  try {
    const response = await fetch(`${config.fileServer.url}/health`, {
      method: 'GET',
      headers: {
        'X-Auth-Token': config.fileServer.token
      },
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      callback({
        ok: false,
        ready: false,
        message: `Server returned ${response.status}`
      });
      return;
    }

    const data = await response.json();
    callback({
      ok: true,
      ready: true,
      version: data.version || '0.1.0',
      uptime: data.uptime || 0
    });
  } catch (error) {
    callback({
      ok: false,
      ready: false,
      message: error.message
    });
  }
}

function testDownloadRequest(config, resolve, reject) {
  if (!config.handlerFileServerEnabled || !config.fileServer) {
    reject('File Server not configured or disabled');
    return;
  }

  getInfo((result) => {
    if (result.ok) {
      resolve();
    } else {
      reject(result.message);
    }
  });
}

function saveTextFile() {
  Log.warn('saveTextFile not implemented for file-server handler');
  return Promise.reject(new Error('Text file saving should use browser handler'));
}

async function saveClipping(clipping, feedback) {
  const config = await loadConfig();

  if (!config.handlerFileServerEnabled || !config.fileServer) {
    feedback.failed('File Server not enabled');
    return;
  }

  const savingTool = new SavingTool.SaveClipping(clipping, feedback, {
    mode: SavingTool.SaveClipping.MODE.COMPLETE_WHEN_ALL_TASK_FINISHED
  });

  try {
    // 收集所有需要下载的资源(URL类型任务)
    const resources = [];
    const taskMap = new Map();

    clipping.tasks.forEach((task) => {
      if (task.type === 'url') {
        // URL 类型任务(图片、字体等)需要通过 file-server 下载
        resources.push({
          url: task.url,
          filename: task.filename
        });
        taskMap.set(task.url, task);
      }
      // 文本类型任务(HTML, CSS等)由主文件处理,不需要通过 file-server
    });

    if (resources.length === 0) {
      // 没有需要下载的资源,直接完成
      savingTool.complete();
      return;
    }

    // 计算文档路径
    const docPath = clipping.mainFileTask ? clipping.mainFileTask.filename : null;

    // 提交批量下载任务
    const jobId = await submitDownloadJob(config, {
      resources,
      saveDir: config.rootFolder,
      docPath,
      relativeTo: config.rootFolder,
      relativeProfile: config.fileServer.relativeProfile || 'default'
    });

    Log.debug('File server job created', {jobId, resources: resources.length});

    // 轮询任务状态
    const pollInterval = config.fileServer.pollInterval || 2000;
    const maxPolls = config.fileServer.maxPolls || 300;
    let pollCount = 0;

    const pollTimer = setInterval(async () => {
      pollCount++;

      if (pollCount > maxPolls) {
        clearInterval(pollTimer);
        savingTool.failed('Download timeout: exceeded maximum poll attempts');
        return;
      }

      try {
        const job = await queryJob(config, jobId);

        if (!job) {
          clearInterval(pollTimer);
          savingTool.failed('Job not found');
          return;
        }

        // 更新任务进度
        job.results.forEach((result) => {
          const task = taskMap.get(result.url);
          if (!task) return;

          if (result.status === 'success' && result.result) {
            // 任务成功,标记完成
            savingTool.taskCompleted(task, {
              downloadItemId: null,
              fullFilename: result.result.absolutePath
            });
            taskMap.delete(result.url);
          } else if (result.status === 'failed' && result.result) {
            // 任务失败
            savingTool.taskFailed(task, result.result.errorMessage);
            taskMap.delete(result.url);
          }
        });

        // 检查任务是否完成
        if (['completed', 'failed', 'partial', 'cancelled'].includes(job.status)) {
          clearInterval(pollTimer);
          Log.debug('File server job finished', {jobId, status: job.status, stats: job.stats});
        }
      } catch (error) {
        Log.error('Failed to poll job status', error);
      }
    }, pollInterval);

  } catch (error) {
    Log.error('Failed to save clipping via file-server', error);
    savingTool.failed(error.message);
  }
}

async function submitDownloadJob(config, payload) {
  const response = await fetch(`${config.fileServer.url}/api/jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Auth-Token': config.fileServer.token
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.id;
}

async function queryJob(config, jobId) {
  const response = await fetch(`${config.fileServer.url}/api/jobs/${jobId}`, {
    method: 'GET',
    headers: {
      'X-Auth-Token': config.fileServer.token
    },
    signal: AbortSignal.timeout(5000)
  });

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`HTTP ${response.status}`);
  }

  return await response.json();
}

function retryTask(_task, feedback) {
  Log.warn('retryTask not yet implemented for file-server handler');
  feedback.failed('Retry not supported for file-server handler');
}

function handleClippingResult(clippingResult) {
  // 无需特殊处理
  return clippingResult;
}

function initDownloadFolder() {
  // File server 不需要初始化下载文件夹
  Log.debug('File server handler: initDownloadFolder called (no-op)');
}

const ClippingHandler_FileServer = Object.assign({name: 'FileServer'}, {
  init,
  getInfo,
  saveClipping,
  saveTextFile,
  retryTask,
  handleClippingResult,
  initDownloadFolder,
  testDownloadRequest,
});

export default ClippingHandler_FileServer;
