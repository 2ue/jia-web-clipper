import { randomUUID } from 'crypto';
import { URL } from 'url';
import config from '../utils/config.js';
import logger from '../utils/logger.js';

class QueueManager {
  constructor(overrides = {}) {
    this.overrides = overrides;
    this.queue = [];
    this.tasks = new Map();
    this.sequence = 0;
    this.activeCount = 0;
    this.hostState = new Map();
    this.throttleTimers = new Map();
    this.processing = false;
    this.pendingProcess = false;
  }

  get globalLimit() {
    return this.overrides.globalConcurrency ?? config.get('queue.globalConcurrency') ?? 4;
  }

  get hostLimit() {
    return this.overrides.hostConcurrency ?? config.get('queue.hostConcurrency') ?? 2;
  }

  get hostThrottleMs() {
    return this.overrides.hostThrottleMs ?? config.get('queue.hostThrottleMs') ?? 1000;
  }

  addTask({ id, url, host, priority = 0, execute, metadata = {} }) {
    if (typeof execute !== 'function') {
      throw new Error('Queue task must provide execute function');
    }

    const taskId = id || randomUUID();
    const resolvedHost = host || this.extractHost(url) || 'default';
    const task = {
      id: taskId,
      host: resolvedHost,
      priority,
      execute,
      metadata,
      state: 'queued',
      queueReason: null,
      enqueueAt: Date.now(),
      seq: this.sequence++
    };

    task.promise = new Promise((resolve, reject) => {
      task._resolve = resolve;
      task._reject = reject;
    });

    this.tasks.set(taskId, task);
    this.queue.push(task);
    this.sortQueue();
    this.processQueue();

    return { id: taskId, promise: task.promise };
  }

  extractHost(url) {
    if (!url) {
      return null;
    }

    try {
      const parsed = new URL(url);
      return parsed.host || null;
    } catch (error) {
      logger.warn('Failed to parse host from url', { url, error: error.message });
      return null;
    }
  }

  sortQueue() {
    this.queue.sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return a.seq - b.seq;
    });
  }

  processQueue() {
    if (this.processing) {
      this.pendingProcess = true;
      return;
    }

    this.processing = true;

    try {
      let madeProgress = false;
      for (const task of [...this.queue]) {
        const reason = this.checkAvailability(task.host);
        if (reason === null) {
          this.startTask(task);
          madeProgress = true;
        } else {
          this.updateQueueReason(task, reason);
        }
      }

      if (madeProgress && this.queue.length > 0) {
        // Attempt to schedule remaining tasks again to catch newly freed slots.
        this.processQueue();
      }
    } finally {
      this.processing = false;
      if (this.pendingProcess) {
        this.pendingProcess = false;
        this.processQueue();
      }
    }
  }

  checkAvailability(host) {
    if (this.activeCount >= this.globalLimit) {
      return 'waiting_global_limit';
    }

    const state = this.hostState.get(host) || { active: 0, lastFinishedAt: 0 };
    if (state.active >= this.hostLimit) {
      return 'waiting_host_limit';
    }

    const throttleMs = this.hostThrottleMs;
    if (throttleMs > 0 && state.lastFinishedAt) {
      const elapsed = Date.now() - state.lastFinishedAt;
      if (elapsed < throttleMs) {
        this.scheduleThrottleWake(host, throttleMs - elapsed);
        return 'waiting_host_throttle';
      }
    }

    return null;
  }

  scheduleThrottleWake(host, delayMs) {
    if (this.throttleTimers.has(host)) {
      return;
    }

    const timer = setTimeout(() => {
      this.throttleTimers.delete(host);
      this.processQueue();
    }, delayMs);

    this.throttleTimers.set(host, timer);
  }

  updateQueueReason(task, reason) {
    if (task.queueReason !== reason) {
      task.queueReason = reason;
    }
  }

  startTask(task) {
    const index = this.queue.findIndex(item => item.id === task.id);
    if (index !== -1) {
      this.queue.splice(index, 1);
    }

    task.state = 'running';
    task.queueReason = null;
    const hostState = this.hostState.get(task.host) || { active: 0, lastFinishedAt: 0 };
    hostState.active += 1;
    this.hostState.set(task.host, hostState);
    this.activeCount += 1;

    Promise.resolve()
      .then(() => task.execute())
      .then(result => {
        this.finishTask(task, null, result);
      })
      .catch(error => {
        this.finishTask(task, error);
      });
  }

  finishTask(task, error, result) {
    const hostState = this.hostState.get(task.host);
    if (hostState) {
      hostState.active = Math.max(0, hostState.active - 1);
      hostState.lastFinishedAt = Date.now();
      this.hostState.set(task.host, hostState);
    }

    this.activeCount = Math.max(0, this.activeCount - 1);
    task.state = error ? 'failed' : 'completed';

    if (error) {
      task._reject(error);
    } else {
      task._resolve(result);
    }

    this.processQueue();
  }

  getTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      return null;
    }

    return {
      id: task.id,
      state: task.state,
      host: task.host,
      priority: task.priority,
      queueReason: task.queueReason,
      metadata: task.metadata,
      enqueueAt: task.enqueueAt
    };
  }

  cancelTask(taskId, reason = 'cancelled') {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }

    if (task.state === 'queued') {
      this.queue = this.queue.filter(item => item.id !== taskId);
      task.state = 'cancelled';
      task.queueReason = reason;
      task._reject(new Error(reason));
      this.processQueue();
      return true;
    }

    return false;
  }

  getStats() {
    return {
      queued: this.queue.length,
      active: this.activeCount,
      globalLimit: this.globalLimit,
      hostLimit: this.hostLimit,
      hostThrottleMs: this.hostThrottleMs
    };
  }
}

export default QueueManager;
