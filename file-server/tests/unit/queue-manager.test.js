import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import QueueManager from '../../src/jobs/queue-manager.js';
import config from '../../src/utils/config.js';

function createDeferred(fn) {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {
    promise,
    resolve,
    reject,
    start: fn
  };
}

describe('QueueManager', () => {
  const originalQueue = JSON.parse(JSON.stringify(config.get('queue')));

  beforeEach(() => {
    config.set('queue', originalQueue);
  });

  afterEach(() => {
    config.set('queue', originalQueue);
    vi.useRealTimers();
  });

  it('enforces global concurrency limit', async () => {
    const manager = new QueueManager({ globalConcurrency: 2, hostConcurrency: 2, hostThrottleMs: 0 });
    const runningCounts = [];
    let running = 0;
    const resolvers = [];

    const flush = async () => {
      await Promise.resolve();
      await Promise.resolve();
    };

    const spawnTask = index => {
      return manager.addTask({
        id: `task-${index}`,
        url: `http://example.com/${index}`,
        priority: 0,
        execute: () => {
          running += 1;
          runningCounts.push(running);
          return new Promise(resolve => {
            resolvers[index] = () => {
              running -= 1;
              resolve(index);
            };
          });
        }
      });
    };

    const tasks = [spawnTask(0), spawnTask(1), spawnTask(2), spawnTask(3)];

    await flush();

    expect(runningCounts).toHaveLength(2);
    expect(Math.max(...runningCounts)).toBeLessThanOrEqual(2);
    expect(manager.getTask('task-2').state).toBe('queued');

    resolvers[0]();
    await flush();
    expect(manager.getTask('task-2').state).toBe('running');
    expect(Math.max(...runningCounts)).toBeLessThanOrEqual(2);

    resolvers[1]();
    await flush();
    expect(manager.getTask('task-3').state).toBe('running');

    resolvers[2]();
    resolvers[3]();

    await Promise.all(tasks.map(t => t.promise));
  });

  it('applies host concurrency limit and queueReason', async () => {
    const manager = new QueueManager({ globalConcurrency: 5, hostConcurrency: 1, hostThrottleMs: 0 });

    let resolveFirst;
    const first = manager.addTask({
      id: 'first',
      url: 'http://images.test/a.png',
      execute: () => new Promise(resolve => {
        resolveFirst = resolve;
      })
    });

    const second = manager.addTask({
      id: 'second',
      url: 'http://images.test/b.png',
      execute: () => Promise.resolve('second')
    });

    await Promise.resolve();

    expect(manager.getTask('second').queueReason).toBe('waiting_host_limit');

    resolveFirst();
    await Promise.resolve();

    await expect(second.promise).resolves.toBe('second');
    expect(manager.getTask('second').state).toBe('completed');
  });

  it('enforces host throttle delay', async () => {
    vi.useFakeTimers();
    const manager = new QueueManager({ globalConcurrency: 2, hostConcurrency: 1, hostThrottleMs: 1000 });

    const flush = async () => {
      await Promise.resolve();
      await Promise.resolve();
    };

    let finishFirst;
    manager.addTask({
      id: 't1',
      url: 'http://assets.test/file1',
      execute: () => new Promise(resolve => {
        finishFirst = () => {
          resolve('done');
        };
      })
    });

    const second = manager.addTask({
      id: 't2',
      url: 'http://assets.test/file2',
      execute: () => Promise.resolve('second')
    });

    await flush();
    finishFirst();
    await flush();

    expect(manager.getTask('t2').queueReason).toBe('waiting_host_throttle');

    vi.advanceTimersByTime(1000);
    await flush();

    await expect(second.promise).resolves.toBe('second');
  });

  it('prioritizes higher priority tasks', async () => {
    const manager = new QueueManager({ globalConcurrency: 1, hostConcurrency: 1, hostThrottleMs: 0 });
    const completion = [];

    let releaseLow;
    manager.addTask({
      id: 'low',
      url: 'http://prio.test/low',
      priority: 0,
      execute: () => new Promise(resolve => {
        releaseLow = () => {
          completion.push('low');
          resolve('low');
        };
      })
    });

    const high = manager.addTask({
      id: 'high',
      url: 'http://prio.test/high',
      priority: 10,
      execute: () => {
        completion.push('high');
        return Promise.resolve('high');
      }
    });

    await Promise.resolve();
    expect(manager.getTask('high').queueReason).toBe('waiting_global_limit');

    releaseLow();
    await high.promise;

    expect(completion).toEqual(['low', 'high']);
  });
});
