/**
 * ✅ Reuses objects: used in other contexts to minimize memory consumption and GC pressure.
 * Performance Impact: Reduces garbage collection overhead by 70–80%
 * Frequent object creation and destruction triggers expensive garbage collection.
 * Object pooling reuses objects, eliminating allocation overhead.
 * Based on code from: https://medium.com/@orami98/15-javascript-performance-hacks-that-will-make-your-website-10x-faster-04559e77f491
 *
 * My testing shows using this object pool results with significantly better
 * memory usage and minimal improvement in speed.
 * Example from fastJson stress test: 4.59 MB vs 180 MB for citylots.json file.
 *
 * Usage Examples:
 *
 * 1. Define a poolable object:
 *    class MyObject extends PoolObject {
 *        map = new Map<string, number>();
 *        reset(): void {
 *          // clear references to prevent memory leaks
 *          this.map.clear();
 *        }
 *    }
 *
 * 2. Create a pool:
 *    const pool = new ObjectPool(MyObject, 50);
 *
 * 3. Manual acquire/release (best performance for hot paths):
 *    const obj = pool.acquire(42);
 *    // ... use obj ...
 *    obj[Symbol.dispose](); // Auto-resets and returns to pool
 *
 * 4. Using pattern (safer, auto-cleanup):
 *    // Async:
 *    await pool.using(async (obj) => {
 *        // ... use obj ...
 *        return result;
 *    }, 42); // init args
 *
 *    // Sync:
 *    pool.usingSync((obj) => {
 *        // ... use obj ...
 *        return result;
 *    }, 42);
 *
 * 5. Native using syntax (ES2024):
 *    {
 *        using obj = pool.acquire(42);
 *          // ... use obj ...
 *          // optionally, call pool.release(obj);
 *    }     // automatically released to pool GC dispose
 *
 **/

export class PoolObject {
    #__op?: ObjectPool<PoolObject>; // JS "#" private member to prevent if from being serialized by stringify
    set __pool(pool: ObjectPool<PoolObject> | undefined) {
        this.#__op = pool;
    }
    get __pool(): ObjectPool<PoolObject> | undefined {
        return this.#__op;
    }

    // override these in derived classes
    init(..._args: unknown[]): this {
        return this;
    } // called from ctor
    reset(): void {} // remove references to prevent memory leaks

    // custom destructor to return object to pool
    [Symbol.dispose]() {
        this.reset();
        this.#__op?.release(this);
    }

    // Custom inspect to hide class name and show only enumerable properties
    [Symbol.for('nodejs.util.inspect.custom')]() {
        const obj: Record<string, unknown> = {};
        // Use for...in which is faster than Object.keys() for iteration
        for (const key in this) {
            if (Object.hasOwn(this, key)) {
                obj[key] = (this as Record<string, unknown>)[key];
            }
        }
        return obj;
    }
}

type CTor<T extends PoolObject> = new (...params: unknown[]) => T;

export class ObjectPool<T extends PoolObject> {
    ctor: CTor<T>;
    protected pool: T[] = [];
    protected timer: NodeJS.Timeout;

    constructor(createFn: CTor<T>, initialSize = 50, clearInterval = 30000) {
        this.ctor = createFn;

        // Pre-populate pool
        while (this.pool.length < initialSize) {
            const obj = new this.ctor();
            obj.__pool = this;
            this.pool.push(obj);
        }

        // Periodically clean up unused objects
        this.timer = setInterval(() => {
            this.pool.splice(Math.max(initialSize, this.pool.length / 2));
        }, clearInterval).unref();
    }

    acquire(...args: Parameters<T['init']>): T {
        let obj = this.pool.pop();
        if (!obj) {
            obj = new this.ctor();
            obj.__pool = this;
        }
        obj.init(...args);
        return obj;
    }

    // explicit release to pool
    release(obj: T) {
        if (obj.__pool === this) {
            this.pool.push(obj);
            obj.__pool = undefined;
        }
    }

    clear() {
        this.pool = [];
    }

    get size() {
        return this.pool.length;
    }

    // using pattern - synchronous version
    usingSync<R>(fn: (obj: T) => R, ...args: Parameters<T['init']>): R {
        const obj = this.acquire(...args);
        try {
            return fn(obj);
        } finally {
            obj[Symbol.dispose]();
        }
    }

    // using pattern - async version (primary async method)
    async using<R>(fn: (obj: T) => Promise<R>, ...args: Parameters<T['init']>): Promise<R> {
        const obj = this.acquire(...args);
        try {
            return fn(obj);
        } finally {
            obj[Symbol.dispose]();
        }
    }
}
