/**
 * The instruments the three launch tracks are played on. Each writes one note
 * or hit into a Stem; the session mixes them.
 *
 * The drums are modelled on the machines they are named after rather than
 * built from white noise — the first soundtrack's hats were filtered hiss,
 * which is most of why it sounded like a demo. A TR-808 cymbal is six square
 * oscillators at inharmonic frequencies through a band-pass, so that is what
 * `hat` and `crash` are.
 */
import { Biquad, Saw, Sine, Square, SR, TAU, clamp, cents, db, hz, noise } from "./engine.mjs";

const at = (t) => Math.round(t * SR);
const frac = (x) => x - Math.floor(x);

// ─── drums ──────────────────────────────────────────────────────────────────

/** A sine body with a pitch drop, a hold, and a click on top. Registers the
 *  hit for sidechain ducking unless `duck: false`. */
export function kick(session, stem, t, { vel = 1, pitch = 47, punch = 130, sweep = 0.03, hold = 0.012, decay = 0.28, click = 0.45, drive = 1.6, duck = true } = {}) {
    if (duck) session.kick(t);
    const i0 = at(t);
    const len = at(hold + decay * 4);
    const n = noise();
    const hp = new Biquad("hp", 2600, 0.7);
    let ph = 0;
    const norm = Math.tanh(drive);
    for (let k = 0; k < len; k++) {
        const tt = k / SR;
        ph += (pitch + punch * Math.exp(-tt / sweep)) / SR;
        const amp = Math.min(1, tt / 0.0012) * (tt < hold ? 1 : Math.exp(-(tt - hold) / decay));
        const body = Math.tanh(drive * Math.sin(TAU * frac(ph)) * amp) / norm;
        const clk = (hp.run(n()) * Math.exp(-tt / 0.0016) + Math.sin(TAU * 1700 * tt) * Math.exp(-tt / 0.0035) * 0.5) * click;
        stem.write(i0 + k, vel * (body * 0.95 + clk));
    }
}

const METAL = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0];

/** TR-808 hi-hat: six squares at inharmonic ratios, band-passed high. */
export function hat(stem, t, { vel = 1, open = false, decay, pan = 0.18, tone = 1 } = {}) {
    const d = decay ?? (open ? 0.22 : 0.034);
    const i0 = at(t);
    const len = at(d * 6 + 0.004);
    const osc = METAL.map((f, j) => ({ o: new Square((j * 0.137) % 1), f: f * tone * 1.02 }));
    const bp = new Biquad("bp", 9800, 1.05);
    const hp = new Biquad("hp", 7000, 0.8);
    const n = noise();
    for (let k = 0; k < len; k++) {
        const tt = k / SR;
        let x = 0;
        for (const { o, f } of osc) x += o.next(f);
        x = x / 6 + n() * 0.12;
        const env = Math.min(1, tt / 0.0004) * Math.exp(-tt / d);
        stem.write(i0 + k, hp.run(bp.run(x)) * env * vel * 2.2, pan);
    }
}

/** An 808-style crash: the same metal, lower and longer, with noise air. */
export function crash(stem, t, { vel = 1, decay = 1.6 } = {}) {
    const i0 = at(t);
    const len = at(decay * 4);
    const osc = [...METAL, ...METAL.map((f) => f * 1.47)].map((f, j) => ({ o: new Square((j * 0.31) % 1), f }));
    const hp = [new Biquad("hp", 4200, 0.7), new Biquad("hp", 4400, 0.7)];
    const nl = noise();
    const nr = noise();
    for (let k = 0; k < len; k++) {
        const tt = k / SR;
        let x = 0;
        for (const { o, f } of osc) x += o.next(f);
        x /= osc.length;
        const env = Math.min(1, tt / 0.001) * Math.exp(-tt / decay) * vel;
        stem.stereo(i0 + k, hp[0].run(x * 0.6 + nl() * 0.4) * env, hp[1].run(x * 0.6 + nr() * 0.4) * env);
    }
}

/** Four fast bursts and a tail through a band-pass: a 909-ish clap. */
export function clap(stem, t, { vel = 1, tone = 1150, tail = 0.16 } = {}) {
    const i0 = at(t);
    const len = at(0.03 + tail * 5);
    const nl = noise();
    const nr = noise();
    const f = [new Biquad("bp", tone, 1.4), new Biquad("bp", tone * 1.06, 1.4)];
    const h = [new Biquad("hp", 450), new Biquad("hp", 450)];
    for (let k = 0; k < len; k++) {
        const tt = k / SR;
        let env = 0;
        for (const b of [0, 0.0085, 0.017, 0.025]) if (tt >= b) env += Math.exp(-(tt - b) / 0.004);
        if (tt >= 0.028) env += 0.8 * Math.exp(-(tt - 0.028) / tail);
        env *= vel * 1.6;
        stem.stereo(i0 + k, h[0].run(f[0].run(nl())) * env, h[1].run(f[1].run(nr())) * env);
    }
}

/** A tuned body under a band of noise: the snare. */
export function snare(stem, t, { vel = 1, tone = 185, decay = 0.17, body = 0.6, pan = 0 } = {}) {
    const i0 = at(t);
    const len = at(decay * 5);
    const n = noise();
    const hp = new Biquad("hp", 1700, 0.7);
    const lp = new Biquad("lp", 9500, 0.7);
    let p1 = 0;
    let p2 = 0;
    for (let k = 0; k < len; k++) {
        const tt = k / SR;
        const bend = 1 + 0.22 * Math.exp(-tt / 0.012);
        p1 += (tone * bend) / SR;
        p2 += (tone * 1.78 * bend) / SR;
        const b = (Math.sin(TAU * frac(p1)) * 0.7 + Math.sin(TAU * frac(p2)) * 0.35) * Math.exp(-tt / 0.06) * body;
        const r = lp.run(hp.run(n())) * Math.exp(-tt / decay);
        stem.write(i0 + k, vel * (b + r * 0.9) * Math.min(1, tt / 0.0006), pan);
    }
}

export function rim(stem, t, { vel = 1, pan = -0.25 } = {}) {
    const i0 = at(t);
    const len = at(0.08);
    const n = noise();
    const bp = new Biquad("bp", 3200, 1.2);
    for (let k = 0; k < len; k++) {
        const tt = k / SR;
        const v = Math.sin(TAU * 1720 * tt) * Math.exp(-tt / 0.011) * 0.6 + Math.sin(TAU * 830 * tt) * Math.exp(-tt / 0.018) * 0.5 + bp.run(n()) * Math.exp(-tt / 0.003);
        stem.write(i0 + k, v * vel, pan);
    }
}

export function shaker(stem, t, { vel = 1, pan = 0.35 } = {}) {
    const i0 = at(t);
    const len = at(0.12);
    const n = noise();
    const bp = new Biquad("bp", 6800, 0.9);
    const hp = new Biquad("hp", 3800, 0.7);
    for (let k = 0; k < len; k++) {
        const tt = k / SR;
        const env = Math.min(1, tt / 0.007) ** 2 * Math.exp(-Math.max(0, tt - 0.007) / 0.035);
        stem.write(i0 + k, hp.run(bp.run(n())) * env * vel * 1.4, pan);
    }
}

export function tom(stem, t, { vel = 1, pitch = 95, decay = 0.32, pan = 0 } = {}) {
    const i0 = at(t);
    const len = at(decay * 5);
    const n = noise();
    const bp = new Biquad("bp", 900, 0.8);
    let ph = 0;
    for (let k = 0; k < len; k++) {
        const tt = k / SR;
        ph += (pitch * (1 + 0.55 * Math.exp(-tt / 0.045))) / SR;
        const v = Math.tanh(1.4 * Math.sin(TAU * frac(ph))) * Math.exp(-tt / decay) + bp.run(n()) * Math.exp(-tt / 0.008) * 0.4;
        stem.write(i0 + k, v * vel, pan);
    }
}

// ─── transitions ────────────────────────────────────────────────────────────

/** A sub that drops in pitch: the weight under a cut. */
export function boom(stem, t, { vel = 1, pitch = 44, decay = 0.55 } = {}) {
    const i0 = at(t);
    const len = at(decay * 5);
    let ph = 0;
    for (let k = 0; k < len; k++) {
        const tt = k / SR;
        ph += (pitch * (1 + 1.6 * Math.exp(-tt / 0.045))) / SR;
        stem.write(i0 + k, Math.tanh(1.5 * Math.sin(TAU * frac(ph))) * Math.exp(-tt / decay) * Math.min(1, tt / 0.002) * vel);
    }
}

/** Noise and a tone rising together over `dur`, stopping dead on the beat. */
export function riser(stem, t, dur, { vel = 1, from = 300, to = 8000 } = {}) {
    const i0 = at(t);
    const len = at(dur);
    const nl = noise();
    const nr = noise();
    const bl = new Biquad("bp", from, 1.6);
    const br = new Biquad("bp", from, 1.6);
    const tone = new Saw();
    const tlp = new Biquad("lp", 2000, 0.8);
    let tremPh = 0;
    for (let k = 0; k < len; k++) {
        const x = k / len;
        if (k % 32 === 0) {
            const f = from * (to / from) ** x;
            bl.set(f);
            br.set(f * 1.05);
            tlp.set(800 + 5000 * x);
        }
        tremPh += (6 + 22 * x * x) / SR;
        const trem = 1 - 0.35 * x * (0.5 + 0.5 * Math.sin(TAU * frac(tremPh)));
        const env = x ** 2.2 * vel * trem;
        const ton = tlp.run(tone.next(hz(45 + 36 * x))) * 0.18;
        stem.stereo(i0 + k, (bl.run(nl()) * 1.2 + ton) * env, (br.run(nr()) * 1.2 + ton) * env);
    }
}

/** A cymbal played backwards into a downbeat at `t + dur`. */
export function swell(stem, t, dur, { vel = 1 } = {}) {
    const i0 = at(t);
    const len = at(dur);
    const osc = METAL.map((f, j) => ({ o: new Square((j * 0.21) % 1), f: f * 1.3 }));
    const hl = new Biquad("hp", 3000, 0.7);
    const hr = new Biquad("hp", 3200, 0.7);
    const nl = noise();
    const nr = noise();
    for (let k = 0; k < len; k++) {
        const x = k / len;
        let m = 0;
        for (const { o, f } of osc) m += o.next(f);
        m /= 6;
        const env = x ** 3 * vel;
        stem.stereo(i0 + k, hl.run(m * 0.5 + nl() * 0.5) * env, hr.run(m * 0.5 + nr() * 0.5) * env);
    }
}

/** Filtered noise falling away after a hit. */
export function downlifter(stem, t, dur, { vel = 1 } = {}) {
    const i0 = at(t);
    const len = at(dur);
    const nl = noise();
    const nr = noise();
    const bl = new Biquad("bp", 6000, 1.4);
    const br = new Biquad("bp", 6000, 1.4);
    for (let k = 0; k < len; k++) {
        const x = k / len;
        if (k % 32 === 0) {
            const f = 7000 * (250 / 7000) ** x;
            bl.set(f);
            br.set(f * 0.95);
        }
        const env = (1 - x) ** 2 * vel;
        stem.stereo(i0 + k, bl.run(nl()) * env, br.run(nr()) * env);
    }
}

// ─── keys ───────────────────────────────────────────────────────────────────

/**
 * FM electric piano: a 1:1 modulator for the body and a 14:1 one for the
 * tine's bark, with the stereo tremolo a Rhodes suitcase is known for.
 */
export function ep(stem, t, midi, dur, { vel = 0.8, bright = 1, tremolo = 0.4, rate = 4.2 } = {}) {
    const f = hz(midi);
    const i0 = at(t);
    const tau = clamp(1.7 * (60 / midi) ** 1.4, 0.4, 3.5);
    const len = at(Math.min(dur + 0.5, tau * 6));
    let pc = 0;
    let pm = 0;
    let pt = 0;
    const g = vel ** 1.3 * 0.28;
    for (let k = 0; k < len; k++) {
        const tt = k / SR;
        const i1 = (0.5 + 1.9 * vel * bright) * Math.exp(-tt / 0.45) + 0.3;
        const i2 = 1.1 * vel * bright * Math.exp(-tt / 0.018);
        pc = frac(pc + f / SR);
        pm = frac(pm + f / SR);
        pt = frac(pt + (14 * f) / SR);
        const y = Math.sin(TAU * pc + i1 * Math.sin(TAU * pm) + i2 * Math.sin(TAU * pt));
        const amp = Math.min(1, tt / 0.0015) * Math.exp(-tt / tau) * (tt > dur ? Math.exp(-(tt - dur) / 0.11) : 1);
        stem.write(i0 + k, y * amp * g, tremolo * Math.sin(TAU * rate * (t + tt)));
    }
}

/** FM glass: an inharmonic modulator whose index falls away fast. */
export function bell(stem, t, midi, dur, { vel = 0.8, ratio = 3.5, index = 1.8, decay = 1.1, pan = 0 } = {}) {
    const f = hz(midi);
    const i0 = at(t);
    const len = at(Math.min(dur + decay * 3, decay * 5));
    let pc = 0;
    let pm = 0;
    let po = 0;
    for (let k = 0; k < len; k++) {
        const tt = k / SR;
        const I = index * vel * Math.exp(-tt / 0.22) + 0.25;
        pc = frac(pc + f / SR);
        pm = frac(pm + (ratio * f) / SR);
        po = frac(po + (2 * f) / SR);
        const y = Math.sin(TAU * pc + I * Math.sin(TAU * pm)) + Math.sin(TAU * po) * 0.18 * Math.exp(-tt / (decay * 0.4));
        const amp = Math.min(1, tt / 0.001) * Math.exp(-tt / decay) * (tt > dur ? Math.exp(-(tt - dur) / 0.35) : 1);
        stem.write(i0 + k, y * amp * vel * 0.3, pan);
    }
}

/**
 * Additive piano: inharmonic partials (a real string's are stretched), each a
 * pair of slightly detuned strings that beat against each other, decaying
 * in two stages, with a hammer's thump at the front.
 */
export function piano(stem, t, midi, dur, { vel = 0.7, pedal = true, bright = 1 } = {}) {
    const f0 = hz(midi);
    const i0 = at(t);
    const B = 0.00032 * 2 ** ((midi - 60) / 24);
    const P = Math.min(16, Math.floor(11000 / f0));
    const tau0 = clamp(4.2 * (60 / midi) ** 1.6, 0.7, 9);
    const b = clamp(0.42 + 0.38 * vel * bright, 0.2, 0.9);
    const span = pedal ? tau0 * 1.4 : Math.min(tau0 * 1.4, dur + 0.5);
    const len = at(span);
    const out = new Float32Array(len);
    let norm = 0;
    for (let n = 1; n <= P; n++) norm += b ** (n - 1) / n ** 0.6;
    for (let n = 1; n <= P; n++) {
        const fn = n * f0 * Math.sqrt(1 + B * n * n);
        if (fn > 16000) break;
        const a = b ** (n - 1) / n ** 0.6 / norm;
        const fast = Math.exp(-1 / (((tau0 * 0.22) / (1 + 0.3 * (n - 1))) * SR));
        const slow = Math.exp(-1 / ((tau0 / (1 + 0.22 * (n - 1))) * SR));
        for (const det of [-0.00045, 0.00045]) {
            const w = (TAU * fn * (1 + det)) / SR;
            const c = 2 * Math.cos(w);
            let y1 = Math.sin(-w);
            let y2 = Math.sin(-2 * w);
            let ef = 0.65;
            let es = 0.35;
            for (let k = 0; k < len; k++) {
                const y = c * y1 - y2;
                y2 = y1;
                y1 = y;
                out[k] += y * a * (ef + es) * 0.5;
                ef *= fast;
                es *= slow;
            }
        }
    }
    const nz = noise();
    const bp = new Biquad("bp", clamp(f0 * 3, 900, 4500), 0.9);
    const pan = clamp((midi - 64) / 40, -0.55, 0.55);
    const g = vel ** 1.25 * 0.42;
    for (let k = 0; k < len; k++) {
        const tt = k / SR;
        const rel = !pedal && tt > dur ? Math.exp(-(tt - dur) / 0.18) : 1;
        const hammer = bp.run(nz()) * Math.exp(-tt / 0.003) * 0.25 * vel;
        stem.write(i0 + k, (out[k] * Math.min(1, tt / 0.0008) + hammer) * rel * g, pan);
    }
}

// ─── synths ─────────────────────────────────────────────────────────────────

/** Detuned saws per note, spread across the field, slowly filtered. */
export function pad(stem, t, notes, dur, { vel = 0.6, voices = 5, detune = 16, cutoff = 1800, attack = 0.5, release = 0.9, q = 0.6 } = {}) {
    const i0 = at(t);
    const len = at(dur + release);
    const r = noise();
    const vs = [];
    for (const m of notes) {
        for (let v = 0; v < voices; v++) {
            const s = voices === 1 ? 0 : (v / (voices - 1)) * 2 - 1;
            vs.push({ o: new Saw((r() + 1) / 2), f: hz(m) * cents(s * detune), a: ((s * 0.8 + 1) * Math.PI) / 4 });
        }
    }
    const lpl = new Biquad("lp", cutoff, q);
    const lpr = new Biquad("lp", cutoff, q);
    const g = (vel * 0.8) / Math.sqrt(vs.length);
    for (let k = 0; k < len; k++) {
        const tt = k / SR;
        if (k % 64 === 0) {
            const c = cutoff * (1 + 0.15 * Math.sin(TAU * 0.2 * (t + tt)));
            lpl.set(c);
            lpr.set(c);
        }
        const env = Math.min(1, tt / attack) * (tt > dur ? Math.max(0, 1 - (tt - dur) / release) : 1);
        let l = 0;
        let rr = 0;
        for (const v of vs) {
            const x = v.o.next(v.f);
            l += x * Math.cos(v.a);
            rr += x * Math.sin(v.a);
        }
        stem.stereo(i0 + k, lpl.run(l) * env * g, lpr.run(rr) * env * g);
    }
}

/** A Juno-style chord: two saws and a sub square per note through a
 *  resonant low-pass with its own envelope. Stabs and holds. */
export function chord(stem, t, notes, dur, { vel = 0.7, cutoff = 700, env = 2600, decay = 0.22, release = 0.12, q = 0.9 } = {}) {
    const i0 = at(t);
    const len = at(dur + release * 4);
    const r = noise();
    const vs = [];
    for (const m of notes) {
        vs.push({ o: new Saw((r() + 1) / 2), f: hz(m) * cents(-7), side: -0.6 });
        vs.push({ o: new Saw((r() + 1) / 2), f: hz(m) * cents(7), side: 0.6 });
        vs.push({ o: new Square((r() + 1) / 2), f: hz(m) / 2, side: 0, sub: true });
    }
    const lpl = new Biquad("lp", cutoff, q);
    const lpr = new Biquad("lp", cutoff, q);
    const g = (vel * 0.7) / Math.sqrt(vs.length);
    for (let k = 0; k < len; k++) {
        const tt = k / SR;
        if (k % 16 === 0) {
            const c = cutoff + env * vel * Math.exp(-tt / decay);
            lpl.set(c);
            lpr.set(c);
        }
        const amp = Math.min(1, tt / 0.003) * (tt > dur ? Math.exp(-(tt - dur) / release) : 1);
        let l = 0;
        let rr = 0;
        for (const v of vs) {
            const x = v.o.next(v.f) * (v.sub ? 0.35 : 1);
            const a = ((v.side + 1) * Math.PI) / 4;
            l += x * Math.cos(a);
            rr += x * Math.sin(a);
        }
        stem.stereo(i0 + k, lpl.run(l) * amp * g, lpr.run(rr) * amp * g);
    }
}

/** A clean sub with a touch of second and third harmonic, so it is heard on
 *  small speakers; glides from the previous note when asked. */
export function sub(stem, t, midi, dur, { vel = 0.9, from = null, glide = 0.07, harm = 0.22, drive = 0.8 } = {}) {
    const i0 = at(t);
    const len = at(dur + 0.04);
    const f1 = hz(midi);
    const f0 = from === null ? f1 : hz(from);
    let ph = 0;
    const norm = Math.tanh(1 + drive);
    for (let k = 0; k < len; k++) {
        const tt = k / SR;
        const f = from === null ? f1 : f0 * (f1 / f0) ** Math.min(1, tt / glide);
        ph = frac(ph + f / SR);
        const x = Math.sin(TAU * ph) + harm * Math.sin(2 * TAU * ph) + harm * 0.45 * Math.sin(3 * TAU * ph);
        const amp = Math.min(1, tt / 0.004) * (tt > dur ? Math.max(0, 1 - (tt - dur) / 0.04) : 1);
        stem.write(i0 + k, (Math.tanh((1 + drive) * x * 0.7) / norm) * amp * vel);
    }
}

/** A filtered saw bass with an envelope: for pulses that must be heard. */
export function pluckBass(stem, t, midi, dur, { vel = 0.8, cutoff = 220, env = 900, decay = 0.09 } = {}) {
    const i0 = at(t);
    const len = at(dur + 0.05);
    const f = hz(midi);
    const s = new Saw();
    const subOsc = new Sine();
    const lp = new Biquad("lp", cutoff, 0.85);
    for (let k = 0; k < len; k++) {
        const tt = k / SR;
        if (k % 16 === 0) lp.set(cutoff + env * Math.exp(-tt / decay));
        const amp = Math.min(1, tt / 0.003) * (tt > dur ? Math.max(0, 1 - (tt - dur) / 0.05) : 1);
        stem.write(i0 + k, (lp.run(s.next(f)) * 0.7 + subOsc.next(f) * 0.6) * amp * vel);
    }
}

// ─── voice ──────────────────────────────────────────────────────────────────

/** Soprano formants: [centre Hz, bandwidth Hz, gain dB]. */
const VOWELS = {
    a: [[800, 80, 0], [1150, 90, -6], [2900, 120, -24], [3900, 130, -24]],
    e: [[350, 60, 0], [2000, 100, -16], [2800, 120, -15], [3600, 150, -30]],
    i: [[270, 60, 0], [2140, 90, -12], [2950, 100, -22], [3900, 120, -24]],
    o: [[450, 70, 0], [800, 80, -11], [2830, 100, -22], [3800, 130, -22]],
    u: [[325, 50, 0], [700, 60, -16], [2700, 170, -30], [3800, 180, -34]],
};

/**
 * A sung syllable: a glottal saw (with breath, a scoop into the pitch and
 * vibrato that arrives late, as a singer's does) through a vowel's formants.
 * Chopped short and played as a melody, it is the vocal-chop sound a garage
 * track is built on.
 */
export function voice(stem, t, midi, dur, vowel = "a", { vel = 0.8, pan = 0, scoop = 70, vibrato = 22 } = {}) {
    const i0 = at(t);
    const len = at(dur + 0.06);
    const f = hz(midi);
    const src = new Saw();
    const breath = noise();
    const bh = new Biquad("hp", 1800, 0.7);
    const bands = VOWELS[vowel].map(([fc, bw, gdb]) => ({ bp: new Biquad("bp", fc, fc / bw), g: db(gdb) }));
    let vibPh = 0;
    for (let k = 0; k < len; k++) {
        const tt = k / SR;
        vibPh = frac(vibPh + 5.6 / SR);
        const vib = vibrato * Math.min(1, Math.max(0, (tt - 0.12) / 0.15)) * Math.sin(TAU * vibPh);
        const bend = -scoop * Math.exp(-tt / 0.035);
        const x = src.next(f * cents(vib + bend)) + bh.run(breath()) * 0.08;
        let y = 0;
        for (const b of bands) y += b.bp.run(x) * b.g;
        const amp = Math.min(1, tt / 0.008) * (tt > dur ? Math.max(0, 1 - (tt - dur) / 0.05) : 1);
        stem.write(i0 + k, y * amp * vel * 2.6, pan);
    }
}
