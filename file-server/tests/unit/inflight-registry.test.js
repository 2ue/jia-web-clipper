import { describe, it, expect } from 'vitest';
import InFlightRegistry from '../../src/jobs/inflight-registry.js';

describe('InFlightRegistry', () => {
  it('deduplicates concurrent executions', async () => {
    const registry = new InFlightRegistry();
    let executions = 0;

    const run = () => registry.run('hash', async () => {
      executions += 1;
      return 'result';
    });

    const first = run();
    const second = run();

    expect(first.isPrimary).toBe(true);
    expect(second.isPrimary).toBe(false);

    await expect(Promise.all([first.promise, second.promise])).resolves.toEqual(['result', 'result']);
    expect(executions).toBe(1);
    expect(registry.pendingCount()).toBe(0);
  });

  it('cleans up after rejection so future calls re-run', async () => {
    const registry = new InFlightRegistry();
    let attempt = 0;

    const failing = () => registry.run('hash', async () => {
      attempt += 1;
      throw new Error('boom');
    });

    await expect(failing().promise).rejects.toThrow('boom');
    expect(registry.pendingCount()).toBe(0);

    await expect(failing().promise).rejects.toThrow('boom');
    expect(attempt).toBe(2);
  });

  it('throws when key or executor missing', () => {
    const registry = new InFlightRegistry();
    expect(() => registry.run('', () => Promise.resolve())).toThrow();
    expect(() => registry.run('key')).toThrow();
  });
});
