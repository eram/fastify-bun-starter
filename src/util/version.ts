/** Proper Semantic Versioning comparison class */
// https://scribesecurity.atlassian.net/browse/SH-2963

export type Part = number | string;
const GT = (one: Part, two: Part) => (typeof one === typeof two ? one > two : String(one) > String(two));
const EQ = (one: Part, two: Part) => (typeof one === typeof two ? one === two : String(one) === String(two));

export class Version {
    private _parts: Part[] = [0, 0, 0, 0, 0, 0];
    private _pre = '';
    private _value: string;

    constructor(value: string | Version) {
        if (value instanceof Version) {
            this._value = value._value;
            this._pre = value._pre;
            this._parts = value._parts;
        } else {
            this._value = String(value || '')
                .trim()
                .substring(0, 100);
            const m = this._value.split('.', this._parts.length);

            m.forEach((part, idx) => {
                // if we have a "-" or "+" it's a prerelease
                const split = part.indexOf('-') !== -1 ? part.indexOf('-') : part.indexOf('+');
                if (split >= 0 && !this._pre) {
                    this._pre = part.substring(split + 1);
                    part = part.substring(0, split);
                }

                // map strings to numbers
                const n = Number(part);
                this._parts[idx] = !Number.isNaN(n) ? n : part;
            });
        }
    }

    get major() {
        return this._parts[0];
    }
    get minor() {
        return this._parts[1];
    }
    get patch() {
        return this._parts[2];
    }
    get build() {
        return this._parts[3];
    }
    get preRelease() {
        return this._pre;
    }
    get value() {
        return this._value;
    }

    public eq(other: string | Version) {
        const o = other instanceof Version ? other : new Version(other);
        return this._parts.every((e, i) => EQ(e, o._parts[i])) && EQ(this._pre, o._pre);
    }

    public gt(other: string | Version) {
        const o = other instanceof Version ? other : new Version(other);

        return !!(
            GT(this.major, o.major) ||
            (EQ(this.major, o.major) &&
                (GT(this.minor, o.minor) ||
                    (EQ(this.minor, o.minor) &&
                        (GT(this.minor, o.minor) ||
                            (EQ(this.minor, o.minor) &&
                                (GT(this.patch, o.patch) ||
                                    (EQ(this.patch, o.patch) &&
                                        (GT(this.build, o.build) ||
                                            (EQ(this.build, o.build) &&
                                                (GT(this._parts[4], o._parts[4]) ||
                                                    (EQ(this._parts[4], o._parts[4]) &&
                                                        (GT(this._parts[5], o._parts[5]) ||
                                                            (EQ(this._parts[5], o._parts[5]) &&
                                                                ((this.preRelease &&
                                                                    o.preRelease &&
                                                                    GT(this.preRelease, o.preRelease)) ||
                                                                    (!this.preRelease && o.preRelease)))))))))))))))
        );
    }

    public lt(other: string | Version) {
        const o = other instanceof Version ? other : new Version(other);
        return !this.eq(o) && !this.gt(o);
    }
}
