import { afterEach, describe, expect, test } from 'bun:test';
import { apm } from './apm';

const { counter, meter, histogram, cInc, mInc, hInc } = apm;

describe('Counter tests', () => {
    afterEach(() => {
        apm.resetAll(true);
    });

    test('counter', () => {
        const cnt = counter('cnt');
        expect(cnt.val).toBe(0);
        cnt.add(2);
        expect(cnt.val).toBe(2);
        cnt.dec();
        expect(cnt.val).toBe(1);
        expect(cnt.isUsed).toBeTruthy();
        cnt.reset();
        expect(cnt.val).toBe(0);
    });

    test('cInc', () => {
        cInc('test1');
        cInc('test2');
        const test1 = cInc('test1');
        expect(test1).toBe(2);
    });

    test('meter', () => {
        // debug:true skips the internal setInterval so ticks are deterministic - we
        // drive the rate manually instead of relying on fake timers.
        const mtr = meter('mtr', { debug: true });
        mtr.add();
        // no ticks have happened yet, so rate is 0
        expect(mtr.val).toBe(0);
        for (let i = 0; i < 10; i++) mtr.rate.tick();
        expect(Math.round(mtr.val * 100) / 100).toBeGreaterThan(0);
        expect(mtr.isUsed).toBeTruthy();
    });

    test('histogram empty', () => {
        const hist = histogram('hist');
        expect(hist.isUsed).toBeFalsy();
        expect(hist.val).toBe(0);
        expect(hist.min).toBeUndefined();
    });

    test('histogram val', () => {
        const hist = histogram('hist');
        expect(hist.isUsed).toBeFalsy();
        hist.add(1);
        hist.add(2);
        expect(hist.isUsed).toBeTruthy();

        expect(hist.val).toBe(1.5); // median
    });

    test('histogram fullResults', () => {
        const hist = histogram('hist');
        expect(hist.isUsed).toBeFalsy();
        hist.add(1);
        hist.add(2);
        expect(hist.percentiles([0.75])[0.75]).toBe(2); // p75

        const res = hist.fullResults();
        expect(res.count).toBe(2);
        expect(res.ema).toBe(1 + 2 / 3);
        expect(res.max).toBe(2);
        expect(res.mean).toBe(1.5);
        expect(res.median).toBe(1.5);
        expect(res.min).toBe(1);
        expect(res.p75).toBe(2);
        expect(res.p95).toBe(2);
        expect(res.p99).toBe(2);
        expect(res.p999).toBe(2);
        expect(res.sum).toBe(3);
        expect(res.variance).toBe(0.5);
    });

    test('big histogram - sample is rotated', () => {
        const five = histogram('hist2');
        for (let i = 0; i < 5; i++) five.add(i);
        expect(five.val).toBe(2); // mean
        expect(five.percentiles([0.5])[0.5]).toBe(2); // p50
        expect(five.sample.toArray().length).toBe(5);

        const big = histogram('hist');
        for (let i = 0; i < 1030; i++) big.add(i);
        expect(big.val).toBe(514.5); // actual mean = 514.5
        const p50 = big.percentiles([0.5])[0.5] ?? 0;
        expect(p50).toBeGreaterThan(510);
        expect(p50).toBeLessThan(520); // actual p50 = 513.5
        expect(big.sample.toArray().length).toBeLessThan(1030);
    });

    test('getAll', () => {
        const c1 = apm.counter('cnt1');
        c1.add(2);
        const c2 = apm.counter('cnt2');
        c2.add(3);

        const mtr = meter('mtr', { tickInterval: 10, debug: true });
        mtr.add();
        for (let i = 0; i < 10; i++) mtr.rate.tick();

        const hist = histogram('hist');
        hist.add(1);
        hist.add(2);

        expect(Object.keys(apm.counters).length).toBe(2);
        expect(apm.counters['cnt2']?.val).toBe(3);

        expect(Object.keys(apm.meters).length).toBe(1);
        expect(apm.meters['mtr']?.val).toBeGreaterThan(0);

        expect(Object.keys(apm.histograms).length).toBe(1);
        expect(apm.histograms['hist']?.val).toBe(1.5);
    });

    test('counters merge', () => {
        const cnt1 = apm.counter('cnt1');
        cnt1.add();

        const cnt2 = apm.counter('cnt2');
        cnt2.add();

        const merge = apm.counter('merge', cnt1);
        merge.merge(cnt2);
        expect(merge.val).toBe(2);

        // merge in create
        const cnt3 = apm.counter('cnt1', 1); // same name as above cnt1
        expect(cnt3.val).toBe(cnt1.val); // should be 2

        const cnt4 = apm.counter('cnt1', 5); // same name as above cnt1
        expect(cnt4.val).toBe(7);
        expect(cnt4.val).toBe(apm.counters['cnt1']?.val ?? 0);
    });

    test('meters merge', () => {
        const mtr1 = meter('mtr1', { tickInterval: 10, debug: true });
        mtr1.add(5);
        for (let i = 0; i < 10; i++) mtr1.rate.tick();

        const mtr2 = meter('mtr2', { tickInterval: 10, debug: true });
        mtr2.add(10);
        for (let i = 0; i < 10; i++) mtr2.rate.tick();

        expect(mtr1.val).toBeGreaterThan(0);
        expect(mtr2.val).toBeGreaterThan(mtr1.val);

        const merge = meter('merge');
        merge.merge(mtr1);
        merge.merge(mtr2);
        expect(merge.val).toBeGreaterThan(mtr2.val);

        mtr1.merge(mtr2);
        expect(mtr1.val).toBe(merge.val);

        // merge in create
        const mtr3 = meter('mtr1'); // same as above mtr1
        expect(mtr3.val).toBe(mtr1.val);

        const mtr4 = meter('mtr1', mtr2); // same as above mtr1
        expect(mtr4.val).toBe(mtr1.val);
    });

    test('histogram shorthand and merge', () => {
        hInc('hst1', 1);
        const mean1 = hInc('hst1', 2);
        expect(mean1).toBe(1.5);

        const hst2 = histogram('hst2', apm.histograms['hst1']);
        expect(hst2.val).toBe(1.5);

        const merge = histogram('merge');
        merge.merge(hst2);
        merge.merge(hst2);

        expect(merge.val).toBe(1.5); // mean should not change

        // merge in create
        const mtr3 = histogram('hst1'); // same as above hst1
        expect(mtr3.val).toBe(mean1);

        const mtr4 = histogram('hst1', hst2); // same as above hst1
        expect(mtr4.val).toBe(1.5);
    });
});

describe('count and meter shorthands', () => {
    afterEach(() => {
        apm.resetAll(true);
    });

    test('count shorthand c_incs and registry', () => {
        expect(cInc('foo')).toBe(1); // set 1
        expect(cInc('foo', 2)).toBe(3); // inc by 2
        expect(apm.counters['foo']?.val).toBe(3); // Counter should be registered and c_inced
    });

    test('meter shorthand c_incs and registry', () => {
        expect(apm.meters['bar']).toBeUndefined();
        meter('bar', { tickInterval: 22, debug: true });
        expect(mInc('bar', 5)).toBe(0);
        expect(apm.meters['bar']?.val).toBe(0);
        expect(apm.meters['bar']?.count).toBe(5);
        expect(apm.meters['bar']?.tickInterval).toBe(22);
    });
});
