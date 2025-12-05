class InFlightRegistry {
  constructor() {
    this.registry = new Map();
  }

  has(key) {
    return this.registry.has(key);
  }

  pendingCount() {
    return this.registry.size;
  }

  run(key, executor) {
    if (!key) {
      throw new Error('InFlightRegistry key is required');
    }

    if (typeof executor !== 'function') {
      throw new Error('Executor function is required');
    }

    if (this.registry.has(key)) {
      const existing = this.registry.get(key);
      existing.waiters += 1;
      return { isPrimary: false, promise: existing.promise };
    }

    const entry = {
      waiters: 0,
      createdAt: Date.now()
    };

    entry.promise = Promise.resolve()
      .then(executor)
      .finally(() => {
        this.registry.delete(key);
      });

    this.registry.set(key, entry);
    return { isPrimary: true, promise: entry.promise };
  }
}

export default InFlightRegistry;
