import { equal, ok } from 'node:assert/strict';
import { describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { ObjectPool, PoolObject } from './objectPool';

// Test class extending ResetObject
class TestObject extends PoolObject {
    value: number = 0;
    initCalls = 0;

    init(value = 0, initCalled = true) {
        this.value = value;
        this.initCalls += initCalled ? 1 : 0;
        return this;
    }
}

describe('ObjectPool', () => {
    test('should pre-populate the pool with initialSize objects', () => {
        const size = 10;
        const pool = new ObjectPool(TestObject, size);

        equal(pool.size, size);
    });

    test('should acquire an object from the pool', () => {
        const pool = new ObjectPool(TestObject, 5);
        const initialPoolSize = pool.size;

        const obj = pool.acquire();

        equal(pool.size, initialPoolSize - 1);
        ok(obj instanceof TestObject);
        equal(obj.__pool, pool);
        equal(obj.initCalls, 1);
    });

    test('release back to the pool', () => {
        const pool = new ObjectPool(TestObject, 2);
        const obj = pool.acquire();
        const poolSizeAfterAcquire = pool.size;

        pool.release(obj);
        equal(pool.size, poolSizeAfterAcquire + 1);
        equal(obj.__pool, undefined);
    });

    test('create when pool is empty', () => {
        const pool = new ObjectPool(TestObject, 0);
        equal(pool.size, 0);

        const obj = pool.acquire();
        ok(obj instanceof TestObject);
        equal(obj.__pool, pool);
    });

    test('objects initialized on acquisition', () => {
        const pool = new ObjectPool(TestObject, 1);
        const obj = pool.acquire(0);
        obj.value = 42;
        Object(obj).marker = 'magic';
        pool.release(obj);

        const sameObj = pool.acquire(43, false);
        equal(sameObj.value, 43); // Value should be reset by init()
        equal(sameObj.initCalls, 1);
        equal(Object(obj).marker, 'magic');
        equal(obj, sameObj);
    });

    test('release when disposed', () => {
        const pool = new ObjectPool(TestObject, 1);
        const poolSizeAtStart = pool.size;

        {
            // Use block scope and Symbol.dispose to trigger automatic disposal
            const obj = pool.acquire();
            equal(pool.size, poolSizeAtStart - 1);
            obj[Symbol.dispose]();
        }

        equal(pool.size, poolSizeAtStart);
    });

    test('doesnt release twice', () => {
        const pool = new ObjectPool(TestObject, 1);
        const obj = pool.acquire();

        pool.release(obj); // First release
        const poolSizeAfterRelease = pool.size;

        pool.release(obj); // Second release should be ignored
        equal(pool.size, poolSizeAfterRelease);
    });

    test('doesnt release twice via disposal', () => {
        const pool = new ObjectPool(TestObject, 1);
        const obj = pool.acquire();

        obj[Symbol.dispose](); // First release via disposal
        const poolSizeAfterDisposal = pool.size;

        obj[Symbol.dispose](); // Second disposal should be ignored
        equal(pool.size, poolSizeAfterDisposal);
    });

    test('should clean the pool', () => {
        const pool = new ObjectPool(TestObject, 5);
        equal(pool.size, 5);

        pool.clear();
        equal(pool.size, 0);
    });

    test('incorrect object is not taken', () => {
        const pool = new ObjectPool(TestObject, 1);
        equal(pool.size, 1);

        const incorrectObj = {};
        // @ts-expect-error
        pool.release(incorrectObj);
        equal(pool.size, 1);
    });

    test('clear interval works', async () => {
        const pool = new ObjectPool(TestObject, 10, 2);

        const objs = [];
        for (let i = 0; i < 100; i++) {
            objs.push(pool.acquire());
        }
        for (let i = 0; i < 15; i++) {
            pool.release(objs[i]);
        }

        await sleep(20);
        ok(pool.size <= 10);
    });

    test('check that PoolObject members are not serialized', () => {
        const pool = new ObjectPool(TestObject, 1);
        const obj = pool.acquire();
        Object(obj).customProp = 'test';
        const serialized = JSON.stringify(obj);
        equal(serialized, '{"value":0,"initCalls":1,"customProp":"test"}');
    });

    test('usingSync pattern', () => {
        const pool = new ObjectPool(TestObject, 1);
        const initialSize = pool.size;

        const result = pool.usingSync((obj) => {
            equal(obj.initCalls, 1);
            obj.value = 42;
            return obj.value * 2;
        });

        equal(result, 84);
        equal(pool.size, initialSize); // Object returned to pool
    });

    test('usingSync pattern with exception', () => {
        const pool = new ObjectPool(TestObject, 1);
        const initialSize = pool.size;

        try {
            pool.usingSync((obj) => {
                obj.value = 42;
                throw new Error('Test error');
            });
        } catch (e) {
            equal((e as Error).message, 'Test error');
        }

        equal(pool.size, initialSize); // Object still returned to pool
    });

    test('using pattern (async)', async () => {
        const pool = new ObjectPool(TestObject, 1);
        const initialSize = pool.size;

        const result = await pool.using(async (obj) => {
            equal(obj.initCalls, 1);
            obj.value = 42;
            await sleep(1);
            return obj.value * 2;
        });

        equal(result, 84);
        equal(pool.size, initialSize); // Object returned to pool
    });

    test('using pattern (async) with exception', async () => {
        const pool = new ObjectPool(TestObject, 1);
        const initialSize = pool.size;

        try {
            await pool.using(async (obj) => {
                // pool is now empty
                equal(pool.size, 0);

                obj.value = 42;
                await sleep(1);
                throw new Error('Test error');
            });
        } catch (e) {
            equal((e as Error).message, 'Test error');
        }

        equal(pool.size, initialSize); // Object still returned to pool
    });
});
