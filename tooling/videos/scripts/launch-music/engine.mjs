/**
 * The launch soundtrack's signal chain: primitives, a mixer and a mastering
 * chain. No samples and no dependencies — everything a track is made of is
 * synthesised, and every source of randomness is seeded, so a track renders
 * the same bytes every time.
 *
 * Mixing follows the ordinary rules of a produced track, because the first
 * soundtrack skipped all of them and sounded like it: each stem is EQ'd
 * (nothing but the bass and kick below ~120 Hz), compressed where it needs
 * it, and ducked under the kick; the low end is mono; the bus is glued, then
 * a lookahead limiter holds the ceiling, and loudness is measured with the
 * real BS.1770 meter rather than guessed from a peak.
 */

export const SR = 48000;
export const TAU = Math.PI * 2;

export const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
export const cents = (c) => 2 ** (c / 1200);
export const db = (d) => 10 ** (d / 20);
export const toDb = (x) => 20 * Math.log10(Math.max(x, 1e-12));
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** mulberry32: a seeded uniform source in [0, 1). */
export function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

let seeds = 1;
/** A fresh bipolar noise source, seeded in call order. */
export function noise() {
    const r = rng(seeds++ * 7919 + 17);
    return () => r() * 2 - 1;
}
export function resetSeeds() {
    seeds = 1;
}

// ─── filters ────────────────────────────────────────────────────────────────

/** RBJ cookbook biquad: lp, hp, bp (0 dB peak), peak, lowshelf, highshelf. */
export class Biquad {
    constructor(type, f, q = 0.707, gain = 0) {
        this.type = type;
        this.x1 = this.x2 = this.y1 = this.y2 = 0;
        this.set(f, q, gain);
    }
    set(f, q = this.q, gain = this.gain) {
        this.q = q;
        this.gain = gain;
        const w = (TAU * clamp(f, 10, SR * 0.47)) / SR;
        const cos = Math.cos(w);
        const sin = Math.sin(w);
        const alpha = sin / (2 * q);
        const A = 10 ** (gain / 40);
        let b0, b1, b2, a0, a1, a2;
        switch (this.type) {
            case "lp":
                b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0;
                a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
                break;
            case "hp":
                b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0;
                a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
                break;
            case "bp":
                b0 = alpha; b1 = 0; b2 = -alpha;
                a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
                break;
            case "peak":
                b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A;
                a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
                break;
            case "lowshelf": {
                const s = 2 * Math.sqrt(A) * alpha;
                b0 = A * (A + 1 - (A - 1) * cos + s);
                b1 = 2 * A * (A - 1 - (A + 1) * cos);
                b2 = A * (A + 1 - (A - 1) * cos - s);
                a0 = A + 1 + (A - 1) * cos + s;
                a1 = -2 * (A - 1 + (A + 1) * cos);
                a2 = A + 1 + (A - 1) * cos - s;
                break;
            }
            case "highshelf": {
                const s = 2 * Math.sqrt(A) * alpha;
                b0 = A * (A + 1 + (A - 1) * cos + s);
                b1 = -2 * A * (A - 1 + (A + 1) * cos);
                b2 = A * (A + 1 + (A - 1) * cos - s);
                a0 = A + 1 - (A - 1) * cos + s;
                a1 = 2 * (A - 1 - (A + 1) * cos);
                a2 = A + 1 - (A - 1) * cos - s;
                break;
            }
            default:
                throw new Error(`unknown filter ${this.type}`);
        }
        this.b0 = b0 / a0;
        this.b1 = b1 / a0;
        this.b2 = b2 / a0;
        this.a1 = a1 / a0;
        this.a2 = a2 / a0;
    }
    run(x) {
        const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
        this.x2 = this.x1;
        this.x1 = x;
        this.y2 = this.y1;
        this.y1 = y;
        return y;
    }
}

// ─── oscillators ────────────────────────────────────────────────────────────

function blep(t, dt) {
    if (t < dt) {
        t /= dt;
        return t + t - t * t - 1;
    }
    if (t > 1 - dt) {
        t = (t - 1) / dt;
        return t * t + t + t + 1;
    }
    return 0;
}

/** Band-limited sawtooth. */
export class Saw {
    constructor(phase = 0) {
        this.p = phase;
    }
    next(f) {
        const dt = f / SR;
        this.p += dt;
        if (this.p >= 1) this.p -= 1;
        return 2 * this.p - 1 - blep(this.p, dt);
    }
}

/** Band-limited square (two offset saws). */
export class Square {
    constructor(phase = 0) {
        this.p = phase;
    }
    next(f) {
        const dt = f / SR;
        this.p += dt;
        if (this.p >= 1) this.p -= 1;
        const q = (this.p + 0.5) % 1;
        return (2 * this.p - 1 - blep(this.p, dt)) - (2 * q - 1 - blep(q, dt));
    }
}

/** A sine by phase accumulation, for anything whose pitch moves. */
export class Sine {
    constructor(phase = 0) {
        this.p = phase;
    }
    next(f) {
        this.p += f / SR;
        if (this.p >= 1) this.p -= 1;
        return Math.sin(TAU * this.p);
    }
}

// ─── stems and the session ──────────────────────────────────────────────────

/**
 * One instrument's audio and how it is mixed. Instruments write into it;
 * `Session.master()` processes and sums it.
 *
 *   level     linear gain
 *   eq        [{ type, f, q, gain }] applied in order
 *   drive     soft saturation amount (0 = clean)
 *   comp      { threshold, ratio, attack, release, makeup }
 *   duck      0..1 sidechain depth under the kick
 *   width     side-channel gain (1 = as written)
 *   reverb / room / delay   send levels
 *   chorus    { rate, depth, mix }
 */
export class Stem {
    constructor(n, opts) {
        this.L = new Float32Array(n);
        this.R = new Float32Array(n);
        this.opts = { level: 1, eq: [], drive: 0, duck: 0, width: 1, reverb: 0, room: 0, delay: 0, ...opts };
    }
    /** Equal-power pan; pan in [-1, 1]. */
    write(i, v, pan = 0) {
        if (i < 0 || i >= this.L.length) return;
        const a = ((pan + 1) * Math.PI) / 4;
        this.L[i] += v * Math.cos(a);
        this.R[i] += v * Math.sin(a);
    }
    stereo(i, l, r) {
        if (i < 0 || i >= this.L.length) return;
        this.L[i] += l;
        this.R[i] += r;
    }
}

export class Session {
    constructor(seconds, { bpm, swing = 0.5 } = {}) {
        this.N = Math.ceil(seconds * SR);
        this.seconds = seconds;
        this.bpm = bpm;
        this.beat = 60 / bpm;
        this.swing = swing;
        this.stems = new Map();
        this.kicks = [];
        this.human = rng(4242);
    }
    stem(name, opts = {}) {
        if (!this.stems.has(name)) this.stems.set(name, new Stem(this.N, opts));
        return this.stems.get(name);
    }
    /** Seconds of a 16th inside a bar, swung: odd sixteenths sit late. */
    at(bar, sixteenth) {
        const s16 = this.beat / 4;
        const whole = Math.floor(sixteenth);
        const swungOffset = whole % 2 === 1 ? (this.swing - 0.5) * 2 * s16 : 0;
        return bar * 4 * this.beat + sixteenth * s16 + swungOffset;
    }
    /** A few milliseconds of human looseness, seeded. */
    loose(ms = 4) {
        return ((this.human() * 2 - 1) * ms) / 1000;
    }
    vary(amount = 0.08) {
        return 1 + (this.human() * 2 - 1) * amount;
    }
    kick(t) {
        this.kicks.push(t);
    }

    /** Process every stem, the sends and the master; returns {L, R}. */
    master({ reverb = { rt60: 2.4, damp: 0.4, predelay: 0.025, size: 1 }, room = { rt60: 0.7, damp: 0.5, predelay: 0.008, size: 0.45 }, delay = { time: 0.75, feedback: 0.35 }, lufs = -12, air = 1.5 } = {}) {
        const N = this.N;
        const duck = duckEnvelope(this.kicks, N, 0.16);
        const mixL = new Float32Array(N);
        const mixR = new Float32Array(N);
        const sends = { reverb: [new Float32Array(N), new Float32Array(N)], room: [new Float32Array(N), new Float32Array(N)], delay: [new Float32Array(N), new Float32Array(N)] };

        /** Each stem's level as it enters the mix (RMS of the active part, dB),
         *  so a balance can be read rather than guessed. */
        this.report = [];
        for (const [name, s] of this.stems) {
            const o = s.opts;
            for (const e of o.eq) eq(s.L, s.R, e);
            if (o.chorus) chorus(s.L, s.R, o.chorus);
            if (o.drive) saturate(s.L, s.R, o.drive);
            if (o.comp) compress(s.L, s.R, o.comp);
            let e = 0;
            let active = 0;
            for (let i = 0; i < N; i++) {
                const x = (s.L[i] * s.L[i] + s.R[i] * s.R[i]) * o.level * o.level;
                if (x > 1e-8) {
                    e += x;
                    active++;
                }
            }
            this.report.push([name, toDb(Math.sqrt(e / Math.max(1, active)))]);
            for (let i = 0; i < N; i++) {
                const g = o.level * (1 - o.duck * duck[i]);
                let l = s.L[i] * g;
                let r = s.R[i] * g;
                if (o.width !== 1) {
                    const m = (l + r) / 2;
                    const sd = ((l - r) / 2) * o.width;
                    l = m + sd;
                    r = m - sd;
                }
                mixL[i] += l;
                mixR[i] += r;
                if (o.reverb) { sends.reverb[0][i] += l * o.reverb; sends.reverb[1][i] += r * o.reverb; }
                if (o.room) { sends.room[0][i] += l * o.room; sends.room[1][i] += r * o.room; }
                if (o.delay) { sends.delay[0][i] += l * o.delay; sends.delay[1][i] += r * o.delay; }
            }
        }

        // Delay first, so its repeats can bloom in the reverb.
        const d = pingPong(sends.delay[0], sends.delay[1], { time: delay.time * this.beat, feedback: delay.feedback });
        for (let i = 0; i < N; i++) {
            mixL[i] += d.L[i];
            mixR[i] += d.R[i];
            sends.reverb[0][i] += d.L[i] * 0.25;
            sends.reverb[1][i] += d.R[i] * 0.25;
        }
        for (const [key, cfg] of [["reverb", reverb], ["room", room]]) {
            const [inL, inR] = sends[key];
            // Reverb returns are cleaned below 250 Hz: low-end reverb is mud.
            const w = fdnReverb(inL, inR, cfg);
            eq(w.L, w.R, { type: "hp", f: 250, q: 0.6 });
            eq(w.L, w.R, { type: "highshelf", f: 7000, q: 0.7, gain: -3 });
            for (let i = 0; i < N; i++) {
                mixL[i] += w.L[i];
                mixR[i] += w.R[i];
            }
        }

        // Master: rumble filter, mono below 120 Hz, glue, loudness, limit.
        eq(mixL, mixR, { type: "hp", f: 28, q: 0.7 });
        eq(mixL, mixR, { type: "highshelf", f: 9000, q: 0.7, gain: air });
        monoBass(mixL, mixR, 120);
        normalise(mixL, mixR, -16);
        // Glue: two or three dB on the loud parts, not a squash.
        compress(mixL, mixR, { threshold: -12, ratio: 2, attack: 0.012, release: 0.16, knee: 6 });
        normalise(mixL, mixR, lufs);
        limit(mixL, mixR, { ceiling: -1 });
        // The limiter takes a little level; one more pass lands the target.
        normalise(mixL, mixR, lufs);
        limit(mixL, mixR, { ceiling: -1 });
        fadeOut(mixL, mixR, 0.6);
        return { L: mixL, R: mixR };
    }
}

// ─── processors ─────────────────────────────────────────────────────────────

export function eq(L, R, { type, f, q = 0.707, gain = 0 }) {
    const a = new Biquad(type, f, q, gain);
    const b = new Biquad(type, f, q, gain);
    for (let i = 0; i < L.length; i++) {
        L[i] = a.run(L[i]);
        R[i] = b.run(R[i]);
    }
}

export function saturate(L, R, drive) {
    const k = 1 + drive * 4;
    const norm = Math.tanh(k);
    for (let i = 0; i < L.length; i++) {
        L[i] = Math.tanh(L[i] * k) / norm;
        R[i] = Math.tanh(R[i] * k) / norm;
    }
}

/** Stereo-linked feedforward compressor with a soft knee, in dB. */
export function compress(L, R, { threshold = -18, ratio = 3, attack = 0.005, release = 0.12, knee = 6, makeup = 0 }) {
    const aA = Math.exp(-1 / (attack * SR));
    const aR = Math.exp(-1 / (release * SR));
    let env = 0;
    for (let i = 0; i < L.length; i++) {
        const x = toDb(Math.max(Math.abs(L[i]), Math.abs(R[i])));
        const over = x - threshold;
        let gr = 0;
        if (over > knee / 2) gr = (1 / ratio - 1) * over;
        else if (over > -knee / 2) gr = ((1 / ratio - 1) * (over + knee / 2) ** 2) / (2 * knee);
        env = gr < env ? aA * env + (1 - aA) * gr : aR * env + (1 - aR) * gr;
        const g = db(env + makeup);
        L[i] *= g;
        R[i] *= g;
    }
}

/** Lookahead limiter: never above the ceiling, never a click. */
export function limit(L, R, { ceiling = -1, lookahead = 0.005, release = 0.09 } = {}) {
    const N = L.length;
    const c = db(ceiling);
    const la = Math.round(lookahead * SR);
    const req = new Float32Array(N);
    for (let i = 0; i < N; i++) {
        const p = Math.max(Math.abs(L[i]), Math.abs(R[i]));
        req[i] = p > c ? c / p : 1;
    }
    // Forward sliding minimum over [i, i + la].
    const gmin = new Float32Array(N);
    const dq = [];
    let head = 0;
    for (let i = N - 1; i >= 0; i--) {
        while (dq.length > head && req[dq[dq.length - 1]] >= req[i]) dq.pop();
        dq.push(i);
        while (dq[head] > i + la) head++;
        gmin[i] = req[dq[head]];
    }
    // A box average over the lookahead turns the step into a ramp that is
    // still at or below the requirement when the peak arrives.
    const aR = Math.exp(-1 / (release * SR));
    let sum = 0;
    let g = 1;
    for (let i = 0; i < N; i++) {
        sum += gmin[i];
        if (i >= la) sum -= gmin[i - la];
        const avg = sum / Math.min(i + 1, la);
        g = avg < g ? avg : g + (avg - g) * (1 - aR);
        L[i] *= g;
        R[i] *= g;
    }
}

/** Integrated loudness, ITU-R BS.1770-4 (K-weighted, gated), at 48 kHz. */
export function loudness(L, R) {
    const k = (x) => {
        const s1 = { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [-1.69065929318241, 0.73248077421585] };
        const s2 = { b: [1, -2, 1], a: [-1.99004745483398, 0.99007225036621] };
        const out = new Float32Array(x.length);
        let x1 = 0, x2 = 0, y1 = 0, y2 = 0, u1 = 0, u2 = 0, z1 = 0, z2 = 0;
        for (let i = 0; i < x.length; i++) {
            const y = s1.b[0] * x[i] + s1.b[1] * x1 + s1.b[2] * x2 - s1.a[0] * y1 - s1.a[1] * y2;
            x2 = x1; x1 = x[i]; y2 = y1; y1 = y;
            const z = s2.b[0] * y + s2.b[1] * u1 + s2.b[2] * u2 - s2.a[0] * z1 - s2.a[1] * z2;
            u2 = u1; u1 = y; z2 = z1; z1 = z;
            out[i] = z;
        }
        return out;
    };
    const kl = k(L);
    const kr = k(R);
    const block = Math.round(0.4 * SR);
    const step = Math.round(0.1 * SR);
    const blocks = [];
    for (let s = 0; s + block <= kl.length; s += step) {
        let a = 0;
        let b = 0;
        for (let i = s; i < s + block; i++) {
            a += kl[i] * kl[i];
            b += kr[i] * kr[i];
        }
        blocks.push((a + b) / block);
    }
    const lk = (z) => -0.691 + 10 * Math.log10(z);
    const abs = blocks.filter((z) => lk(z) > -70);
    if (!abs.length) return -70;
    const rel = lk(abs.reduce((p, z) => p + z, 0) / abs.length) - 10;
    const gated = abs.filter((z) => lk(z) > rel);
    return lk(gated.reduce((p, z) => p + z, 0) / gated.length);
}

export function normalise(L, R, target) {
    const g = db(target - loudness(L, R));
    for (let i = 0; i < L.length; i++) {
        L[i] *= g;
        R[i] *= g;
    }
}

/** Everything below `f` goes to the middle: a bass that wanders in stereo
 *  is a bass that disappears on a phone. */
export function monoBass(L, R, f) {
    const hp = new Biquad("hp", f, 0.7);
    for (let i = 0; i < L.length; i++) {
        const m = (L[i] + R[i]) / 2;
        const s = hp.run((L[i] - R[i]) / 2);
        L[i] = m + s;
        R[i] = m - s;
    }
}

export function fadeOut(L, R, seconds) {
    const n = Math.round(seconds * SR);
    for (let k = 0; k < n; k++) {
        const i = L.length - n + k;
        const g = 1 - k / n;
        L[i] *= g;
        R[i] *= g;
    }
}

/** 0..1 under each kick: a 3 ms attack and an exponential release. */
export function duckEnvelope(times, N, release) {
    const out = new Float32Array(N);
    const sorted = [...times].sort((a, b) => a - b);
    let k = 0;
    let last = -10;
    for (let i = 0; i < N; i++) {
        const t = i / SR;
        while (k < sorted.length && sorted[k] <= t) last = sorted[k++];
        const dt = t - last;
        out[i] = Math.min(1, dt / 0.003) * Math.exp(-dt / release);
    }
    return out;
}

/** Two modulated delay lines, one per side, in opposite phase. */
export function chorus(L, R, { rate = 0.35, depth = 0.003, base = 0.014, mix = 0.45 }) {
    const size = Math.ceil((base + depth) * SR) + 4;
    const bl = new Float32Array(size);
    const br = new Float32Array(size);
    let w = 0;
    for (let i = 0; i < L.length; i++) {
        bl[w] = L[i];
        br[w] = R[i];
        const t = i / SR;
        const tap = (buf, lfo) => {
            const d = (base + depth * lfo) * SR;
            let r = w - d;
            while (r < 0) r += size;
            const i0 = Math.floor(r);
            const fr = r - i0;
            return buf[i0 % size] * (1 - fr) + buf[(i0 + 1) % size] * fr;
        };
        const lfoL = 0.5 + 0.5 * Math.sin(TAU * rate * t);
        const lfoR = 0.5 + 0.5 * Math.sin(TAU * rate * t + Math.PI);
        const wl = tap(bl, lfoL);
        const wr = tap(br, lfoR);
        L[i] = L[i] * (1 - mix * 0.5) + wl * mix;
        R[i] = R[i] * (1 - mix * 0.5) + wr * mix;
        w = (w + 1) % size;
    }
}

/** Tempo-synced ping-pong, filtered so each repeat is darker and thinner. */
export function pingPong(inL, inR, { time, feedback = 0.35 }) {
    const N = inL.length;
    const d = Math.round(time * SR);
    const L = new Float32Array(N);
    const R = new Float32Array(N);
    const lp = [new Biquad("lp", 4200), new Biquad("lp", 4200)];
    const hp = [new Biquad("hp", 280), new Biquad("hp", 280)];
    for (let i = 0; i < N; i++) {
        const fromR = i >= d ? R[i - d] : 0;
        const fromL = i >= d ? L[i - d] : 0;
        L[i] = hp[0].run(lp[0].run((inL[i] + inR[i]) * 0.5 + fromR * feedback));
        R[i] = hp[1].run(lp[1].run(fromL * feedback));
    }
    return { L, R };
}

/**
 * An 8-line feedback delay network with a Hadamard mix, per-line damping and
 * input diffusion: a smooth, dense tail, not Freeverb's comb ring.
 */
export function fdnReverb(inL, inR, { rt60 = 2.2, damp = 0.4, predelay = 0.02, size = 1 }) {
    const N = inL.length;
    const LEN = [1031, 1327, 1523, 1741, 1913, 2137, 2381, 2617].map((n) => Math.max(64, Math.round(n * size)));
    const gain = LEN.map((n) => 10 ** ((-3 * n) / (rt60 * SR)));
    const lines = LEN.map((n) => new Float32Array(n));
    const idx = new Int32Array(8);
    const lp = new Float64Array(8);
    const pre = Math.round(predelay * SR);
    const AP = [142, 107, 379, 277].map((n) => ({ buf: new Float32Array(Math.round(n * Math.max(size, 0.5))), i: 0 }));
    const outL = new Float32Array(N);
    const outR = new Float32Array(N);
    const v = new Float64Array(8);
    for (let n = 0; n < N; n++) {
        let x = n >= pre ? (inL[n - pre] + inR[n - pre]) * 0.5 : 0;
        for (const a of AP) {
            const o = a.buf[a.i];
            const y = -0.7 * x + o;
            a.buf[a.i] = x + 0.7 * y;
            a.i = (a.i + 1) % a.buf.length;
            x = y;
        }
        for (let k = 0; k < 8; k++) {
            const o = lines[k][idx[k]];
            lp[k] = o * (1 - damp) + lp[k] * damp;
            v[k] = lp[k] * gain[k];
        }
        // Fast Walsh-Hadamard, normalised.
        for (let h = 1; h < 8; h <<= 1) {
            for (let i = 0; i < 8; i += h << 1) {
                for (let j = i; j < i + h; j++) {
                    const a = v[j];
                    const b = v[j + h];
                    v[j] = a + b;
                    v[j + h] = a - b;
                }
            }
        }
        const s = 1 / Math.sqrt(8);
        let l = 0;
        let r = 0;
        for (let k = 0; k < 8; k++) {
            const o = lines[k][idx[k]];
            if (k % 2 === 0) l += o;
            else r += o;
            lines[k][idx[k]] = v[k] * s + x * (k % 2 ? 0.5 : -0.5);
            idx[k] = (idx[k] + 1) % LEN[k];
        }
        outL[n] = l * 0.5;
        outR[n] = r * 0.5;
    }
    return { L: outL, R: outR };
}

// ─── analysis + output ──────────────────────────────────────────────────────

/** Energy per octave band, in dB relative to the loudest band. */
export function octaveBands(L, R) {
    const centres = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    const out = centres.map((f) => {
        const a = new Biquad("bp", f, 1.41);
        const b = new Biquad("bp", f, 1.41);
        let e = 0;
        for (let i = 0; i < L.length; i++) {
            const x = a.run(L[i]);
            const y = b.run(R[i]);
            e += x * x + y * y;
        }
        return e;
    });
    const top = Math.max(...out);
    return centres.map((f, i) => [f, 10 * Math.log10(out[i] / top)]);
}

/** L/R correlation above 200 Hz. The low end is mono on purpose and holds
 *  most of the energy, so measured full-band every mix reads ~1.0. */
export function correlation(L, R) {
    const a = new Biquad("hp", 200, 0.7);
    const b = new Biquad("hp", 200, 0.7);
    let lr = 0;
    let ll = 0;
    let rr = 0;
    for (let i = 0; i < L.length; i++) {
        const l = a.run(L[i]);
        const r = b.run(R[i]);
        lr += l * r;
        ll += l * l;
        rr += r * r;
    }
    return lr / Math.sqrt(ll * rr);
}

export function wav(L, R) {
    const N = L.length;
    const bytes = N * 4;
    const buf = Buffer.alloc(44 + bytes);
    buf.write("RIFF", 0);
    buf.writeUInt32LE(36 + bytes, 4);
    buf.write("WAVE", 8);
    buf.write("fmt ", 12);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(2, 22);
    buf.writeUInt32LE(SR, 24);
    buf.writeUInt32LE(SR * 4, 28);
    buf.writeUInt16LE(4, 32);
    buf.writeUInt16LE(16, 34);
    buf.write("data", 36);
    buf.writeUInt32LE(bytes, 40);
    // TPDF dither on the way to 16 bits.
    const d = rng(99);
    for (let i = 0; i < N; i++) {
        const q = (x) => Math.round(clamp(x * 32767 + (d() - d()), -32768, 32767));
        buf.writeInt16LE(q(L[i]), 44 + i * 4);
        buf.writeInt16LE(q(R[i]), 46 + i * 4);
    }
    return buf;
}
