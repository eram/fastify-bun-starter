import type { Dict, RoDict } from './immutable';

// Copies each own key from `source` into `target` via `updater`, which decides how
// each key gets applied (plain assignment, or a type-specific merge for nested state).
function copyIn<T extends object>(
    target: T,
    source: Readonly<Partial<T>>,
    opts: { updater: (target: T, key: string, source: Readonly<Partial<T>>) => void },
) {
    for (const key of Object.keys(source as object)) {
        opts.updater(target, key, source);
    }
    return target;
}

interface IApm {
    reset(): void;
    merge(other: Readonly<unknown>): this;
    add(n?: number | Readonly<unknown>): number;
    readonly val: number;
    readonly isUsed: boolean;
}

/***
 * the below is losly based on @pm2\io\build\main\utils\metrics library
 ***/

class Counter implements IApm {
    private _count: number;

    private constructor(params: Readonly<Partial<Counter>> | number = {}) {
        this._count = typeof params === 'number' ? params : (Object(params)._count ?? 0);
    }

    static instance(params?: Readonly<Partial<Counter>> | number) {
        return new Counter(params);
    }

    reset(_count = 0) {
        this._count = _count;
    }

    merge(other: Readonly<Counter>) {
        this._count += other?.val ?? 0;
        return this;
    }

    get val() {
        return this._count;
    }

    get isUsed() {
        return this._count !== 0;
    }

    add(n: number | Readonly<Counter> = 1) {
        if (typeof n === 'number') {
            this._count += n;
        } else {
            this.merge(n);
        }
        return this.val;
    }

    dec(n = 1) {
        return this.add(-n);
    }
}

/**
 * Exponentially Weighted Moving Average implementation for APM.
 * It calculates the average rate of events over a specified time period.
 */
class MovingAvg implements IApm {
    private _count: number;
    private _rate: number;
    timePeriod: number;
    tickInterval: number;
    private readonly _alpha: number;

    constructor(params: Partial<MovingAvg> = {}) {
        this.timePeriod = Object(params)._timePeriod ?? 1 * 60 * 1000;
        this.tickInterval = Object(params)._tickInterval ?? 5000;
        this._count = 0;
        this._rate = 0;
        this._alpha = 1 - Math.exp(-this.tickInterval / this.timePeriod);
        this.reset();
    }

    reset() {
        this._count = 0;
        this._rate = 0;
    }

    add(val: number | Readonly<MovingAvg>) {
        if (typeof val === 'number') {
            this._count += val;
        } else if (val instanceof MovingAvg) {
            this._count += val._count;
            this._rate += val._rate;
        }
        return this.val;
    }

    merge(other: Readonly<MovingAvg>) {
        this.add(other);
        return this;
    }

    tick() {
        const instantRate = this._count / this.tickInterval;
        this._count = 0;
        this._rate += this._alpha * (instantRate - this._rate);
    }

    rate(timeUnit: number) {
        return this._rate * timeUnit;
    }

    get val() {
        return this._rate;
    }
    get count() {
        return this._count;
    }
    get isUsed() {
        return this._rate !== 0;
    }
}

class Meter implements IApm {
    tickInterval: number;
    seconds: number;
    timeframe: number;
    debug: boolean;
    rate: MovingAvg;

    private constructor(params: Readonly<Partial<Meter>> = {}) {
        this.tickInterval = Object(params).tickInterval ?? 1000; // is the frequency (in milliseconds) at which the meter recalculates its rate.
        this.seconds = Object(params).seconds ?? 1; // represents the time unit (in seconds, by default) over which the event frequency is calculated for the Meter metric.
        this.timeframe = Object(params).timeframe ?? 60; // controls how long (in seconds) the meter analyzes events to compute the reported frequency.
        this.debug = Object(params).debug ?? false;

        this.rate = new MovingAvg({ timePeriod: this.timeframe * 1000, tickInterval: this.tickInterval });

        if (!this.debug) {
            setInterval(
                (self: Meter) => {
                    self.rate.tick();
                },
                this.tickInterval,
                this,
            ).unref();
        }
    }

    static instance(params?: Readonly<Partial<Meter>>) {
        return new Meter(params);
    }

    reset() {
        this.rate.reset();
    }

    merge(other: Readonly<Partial<Meter>>) {
        this.add(other);
        return this;
    }

    add(n: number | Readonly<Partial<Meter>> = 1) {
        if (typeof n === 'number') {
            this.rate.add(n);
        } else if (n && typeof n === 'object' && 'rate' in n && n.rate instanceof MovingAvg) {
            this.rate.merge(n.rate);
        }
        return this.val;
    }

    // returns rate of events per second, over the timeframe specified in the constructor, rounded to 2 decimal places.
    get val() {
        return Math.round(this.rate.rate(this.seconds * 1000) * 100) / 100;
    }

    get isUsed() {
        return this.rate.isUsed;
    }

    get count() {
        return this.rate.count;
    }
}

class SortedElem {
    priority = 0;
    value = 0;
    timestamp = 0;
}

class SortedArray extends Array<SortedElem> implements IApm {
    constructor(elems: SortedArray | SortedElem | SortedElem[] = [], scoreFn?: (elem: SortedElem) => number) {
        super();
        this.reset();
        if (typeof elems === 'object' && '_score' in elems) {
            scoreFn ??= elems._score;
        }
        if (typeof scoreFn === 'function') this._score = scoreFn;
        this.add(Array.isArray(elems) ? elems : [elems]);
    }

    reset() {
        this.length = 0;
    }

    merge(other: Readonly<Partial<SortedArray>>): this {
        if (other && Array.isArray(other)) {
            this.add(other);
        }
        return this;
    }

    add(elem: SortedElem | SortedElem[]) {
        const elems = Array.isArray(elem) ? elem : [elem];
        elems.forEach((el) => {
            this.push(el);
            this._bubble(this.length - 1);
        });
        return this.val;
    }

    get val() {
        return this.first()?.value ?? 0;
    }
    get isUsed() {
        return this.length > 0;
    }

    private _bubble(bubbleIndex: number) {
        const bubbleElement = this[bubbleIndex] as SortedElem;
        const bubbleScore = this._score(bubbleElement);
        while (bubbleIndex > 0) {
            const parentIndex = this._parentIdx(bubbleIndex);
            const parentElement = this[parentIndex] as SortedElem;
            const parentScore = this._score(parentElement);
            if (bubbleScore <= parentScore) break;
            this[parentIndex] = bubbleElement;
            this[bubbleIndex] = parentElement;
            bubbleIndex = parentIndex;
        }
    }

    first() {
        return this[0];
    }

    override pop() {
        // This method removes and returns the root element of the heap, replaces it with the last element, and
        // then re-heapifies the array from the root down.
        const root = this[0];
        const last: SortedElem | undefined = super.pop();
        if (this.length > 0) {
            this[0] = last as SortedElem;
            this._sink(0);
        }
        return root;
    }

    private _sink(sinkIndex: number) {
        const sinkElement = this[sinkIndex] as SortedElem;
        const sinkScore = this._score(sinkElement);
        const { length } = this;
        while (true) {
            let swapIndex: number | undefined;
            let swapScore: number | undefined;
            let swapElement: SortedElem | undefined;
            const childIndexes = this._childIdx(sinkIndex);
            for (let i = 0; i < childIndexes.length; i++) {
                const childIndex = childIndexes[i] as number;
                if (childIndex >= length) break;
                const childElement = this[childIndex] as SortedElem;
                const childScore = this._score(childElement);
                if (childScore > sinkScore && (swapScore === undefined || swapScore < childScore)) {
                    swapIndex = childIndex;
                    swapScore = childScore;
                    swapElement = childElement;
                }
            }
            if (swapIndex === undefined) break;
            this[swapIndex] = sinkElement;
            this[sinkIndex] = swapElement as SortedElem;
            sinkIndex = swapIndex;
        }
    }

    private _parentIdx(index: number) {
        return Math.floor((index - 1) / 2);
    }
    private _childIdx(index: number) {
        return [2 * index + 1, 2 * index + 2];
    }
    private _score(elem: SortedElem) {
        return elem.value;
    }
}

class Sample implements IApm {
    private _elems: SortedArray;
    private _rescaleInterval: number;
    private _alpha: number;
    private _size: number;
    private _landmark = 0;
    private _nextRescale = 0;

    constructor(params: Readonly<Partial<Sample>> = {}) {
        this._elems = new SortedArray(Object(params)._elems);
        this._rescaleInterval = Object(params)._rescaleInterval ?? 1 * 1000 * 60 * 60;
        this._alpha = Object(params)._alpha ?? 0.015;
        this._size = Object(params)._size ?? 1028;
    }

    reset() {
        this._elems.reset();
        this._landmark = 0;
        this._nextRescale = 0;
    }

    merge(other: Readonly<Partial<Sample>>) {
        copyIn(this, other, {
            updater: (me, k, o) => {
                if (me instanceof Sample && o instanceof Sample) {
                    if (k === '_elems') {
                        me._elems.add(o._elems);
                    } else {
                        Object(me)[k] = Object(o)[k];
                    }
                }
            },
        });
        return this;
    }

    add(value = 0, timestamp?: number) {
        timestamp ??= Date.now();
        if (!this._landmark) {
            this._landmark = timestamp;
            this._nextRescale = this._landmark + this._rescaleInterval;
        }
        const newSize = this._elems.length + 1;

        const elem: SortedElem = {
            priority: this._priority(timestamp - this._landmark),
            value,
            timestamp,
        };

        if (newSize <= this._size) {
            this._elems.add([elem]);
        } else if (elem.priority > (this._elems.first() as SortedElem).priority) {
            this._elems.pop();
            this._elems.add([elem]);
        }

        if (timestamp >= this._nextRescale) this._rescale(timestamp);
        return this.val;
    }

    get val(): number {
        const arr = this.toArray();
        if (!arr.length) return 0;
        // Return median as a representative value
        const sorted = arr.slice().sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 !== 0 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
    }

    get isUsed() {
        return this._elems.length > 0;
    }

    toArray(): number[] {
        return this.isUsed ? this._elems.map((elem) => elem.value) : [];
    }

    private _weight(age: number) {
        return Math.exp(this._alpha * (age / 1000));
    }

    private _priority(age: number) {
        return this._weight(age) / Math.random();
    }

    private _rescale(now = Date.now()) {
        const oldLandmark = this._landmark;
        this._landmark = now;
        this._nextRescale = now + this._rescaleInterval;
        const factor = this._priority(-(this._landmark - oldLandmark));
        this._elems.forEach((elem) => {
            elem.priority *= factor;
        });
    }
}

class Histogram implements IApm {
    private _min: number;
    private _max: number;
    private _count: number;
    private _sum: number;
    private _varianceM: number;
    private _varianceS: number;
    private _ema: number;
    private _sample: Sample;

    private constructor(params: Readonly<Partial<Histogram>> = {}) {
        this._min = Object(params).min ?? undefined;
        this._max = Object(params).max ?? undefined;
        this._count = Object(params).count ?? 0;
        this._sum = Object(params).sum ?? 0;
        this._varianceM = Object(params).varianceM ?? 0;
        this._varianceS = Object(params).varianceS ?? 0;
        this._ema = Object(params).ema ?? 0;
        this._sample = new Sample(Object(params)._sample);
    }

    static instance(params?: Readonly<Partial<Histogram>>) {
        return new Histogram(params);
    }

    reset() {
        this._sample.reset();
        this._min = this._max = this._count = this._sum = this._varianceM = this._varianceS = this._ema = 0;
    }

    merge(other: Readonly<Partial<Histogram>>) {
        copyIn(this, other, {
            updater: (me, key, other) => {
                if (key === '_sample' && Object(other)._sample instanceof Sample) {
                    Object(me)._sample.merge(Object(other)._sample);
                } else {
                    Object(me)[key] = Object(other)[key];
                }
            },
        });
        return this;
    }

    add(value: number) {
        this._count++;
        this._sum += value;
        this._sample.add(value);
        this._updateMin(value);
        this._updateMax(value);
        this._updateVariance(value);
        this._updateEma(value);
        return this.val;
    }

    percentiles(percentiles: number[]) {
        const values = this._sample.toArray().sort((a, b) => (a === b ? 0 : a - b));
        const results: Dict<number> = {};
        percentiles.forEach((percentile) => {
            if (!values.length) {
                return;
            }
            const pos = percentile * (values.length + 1);
            if (pos < 1) {
                results[percentile] = values[0];
            } else if (pos >= values.length) {
                results[percentile] = values[values.length - 1];
            } else {
                const lower = values[Math.floor(pos) - 1] as number;
                const upper = values[Math.ceil(pos) - 1] as number;
                results[percentile] = Math.round(1000 * (lower + (pos - Math.floor(pos)) * (upper - lower))) / 1000;
            }
        });
        return results;
    }

    get val() {
        return this._calculateMean();
    }

    get min() {
        return this._min;
    }
    get max() {
        return this._max;
    }

    get count() {
        return this._count;
    }
    get sample() {
        return this._sample;
    }
    get sum() {
        return this._sum;
    }

    fullResults() {
        const percentiles = this.percentiles([0.5, 0.75, 0.95, 0.99, 0.999]);
        return {
            count: this._count,
            ema: this._ema,
            max: this._max,
            mean: this._calculateMean(),
            median: percentiles[0.5],
            min: this._min,
            p75: percentiles[0.75],
            p95: percentiles[0.95],
            p99: percentiles[0.99],
            p999: percentiles[0.999],
            sum: this._sum,
            variance: this._calculateVariance(),
        };
    }

    get isUsed() {
        return this._count > 0;
    }

    private _updateMin(value: number) {
        if (this._min === undefined || value < this._min) {
            this._min = value;
        }
    }

    private _updateMax(value: number) {
        if (this._max === undefined || value > this._max) {
            this._max = value;
        }
    }

    private _updateVariance(value: number) {
        if (this._count === 1) {
            this._varianceM = value;
        } else {
            const oldM = this._varianceM;
            this._varianceM += (value - oldM) / this._count;
            this._varianceS += (value - oldM) * (value - this._varianceM);
        }
        return this._varianceM;
    }

    private _updateEma(value: number) {
        if (this._count <= 1) {
            this._ema = this._calculateMean();
        } else {
            const alpha = 2 / (1 + this._count);
            this._ema = value * alpha + this._ema * (1 - alpha);
        }
        return this._ema;
    }

    // mean of an empty histogram is undefined. but we don't want to get into dealing with undefined values in
    // calculations a, so we return 0 for empty histograms.
    private _calculateMean() {
        return !this._count ? 0 : this._sum / this._count;
    }
    private _calculateVariance() {
        return this._count <= 1 ? 0 : this._varianceS / (this._count - 1);
    }
}

/***
 * end of @pm2\io\build\main\utils\metrics library
 ***/

const counters: Dict<Counter> = {};
const meters: Dict<Meter> = {};
const histograms: Dict<Histogram> = {};

/**
 * APM (Application Performance Monitoring) module.
 * Provides access to counters, meters, histograms, and utility methods.
 */
function percentiles() {
    const percentiles: Dict<Dict<number>> = {};
    for (const k in histograms) {
        percentiles[k] = histograms[k]?.percentiles([0.5, 0.75, 0.95, 0.99, 0.999]);
    }
    return percentiles as RoDict<RoDict<number>>;
}

/**
 * Get all current metricw values as plain objects.
 * @returns An object with counters, meters, histograms and hostogram's percenties values.
 */
export const apm = {
    get counters() {
        return counters as RoDict<Counter>;
    },
    get meters() {
        return meters as RoDict<Meter>;
    },
    get histograms() {
        return histograms as RoDict<Histogram>;
    },
    get percentiles() {
        return percentiles() as RoDict<RoDict<number>>;
    },

    resetAll(deleteCounters = false) {
        [counters, meters, histograms].forEach((cnt) => {
            for (const key in cnt) {
                deleteCounters ? delete cnt[key] : cnt[key]?.reset();
            }
        });
    },

    counter(name: string, params?: Readonly<Partial<Counter>> | number) {
        let cnt = counters[name];
        if (!cnt) {
            cnt = counters[name] = Counter.instance(params);
        } else {
            cnt.add(typeof params === 'number' ? params : 0);
        }
        return cnt;
    },

    meter(name: string, params?: Readonly<Partial<Meter>>) {
        return meters[name] ?? (meters[name] = Meter.instance(params));
    },

    histogram(name: string, params?: Readonly<Partial<Histogram>>) {
        return histograms[name] ?? (histograms[name] = Histogram.instance(params));
    },

    /**
     * shorthand: increment a named counter and return its value.
     * @param name - The counter name.
     * @param n - The increment amount (default 1).
     * @returns The current counter value.
     */
    cInc(name: string, n = 1) {
        return apm.counter(name).add(n);
    },

    /**
     * shorthand: increment a named meter and return its rate.
     * @param name - The meter name.
     * @param n - The increment amount (default 1).
     * @returns The current meter value.
     */
    mInc(name: string, n = 1) {
        return apm.meter(name).add(n);
    },

    /**
     * shorthand: increment a named histogram and return its mean value.
     * @param name - The histogram name.
     * @param value - The value to add to the histogram.
     * @returns The current histogram mean value.
     */
    hInc(name: string, value: number) {
        return apm.histogram(name).add(value);
    },
};
