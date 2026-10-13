#!/usr/bin/env node
/**
 * Composes the launch film's soundtrack: `public/launch/music.wav`.
 *
 * The film is cut to the beat, the way the short product teasers it is
 * modelled on are — the picture moves with the music. So the music is not a
 * stock track fitted afterwards. It is written here, from the same tempo,
 * section map and chord chart the composition reads (`src/launch/score.ts`),
 * which means every cut in the film lands on a kick drum by construction.
 *
 * Pure synthesis, no samples and no dependencies: oscillators, filtered noise,
 * a ping-pong delay and a Freeverb. The noise is seeded, so the same score
 * writes the same file byte for byte.
 *
 *   node scripts/compose-launch-music.mjs      (or: pnpm launch:music)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BARS, BPM, CHORDS, SECTIONS } from "../src/launch/score.ts";

const SR = 48000;
const BEAT_S = 60 / BPM;
const BAR_S = BEAT_S * 4;
const N = Math.ceil(BARS * BAR_S * SR);
const TAU = Math.PI * 2;
/** Final peak, linear. Measured with ffmpeg's ebur128 to land near -12 LUFS. */
const MASTER_PEAK = 0.89;

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "launch", "music.wav");

// ─── primitives ─────────────────────────────────────────────────────────────

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const cents = (c) => 2 ** (c / 1200);

/** mulberry32 — a seeded noise source, so renders are reproducible. */
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
    };
}
let seedCounter = 1;
const noise = () => rng(seedCounter++ * 7919);

/** RBJ cookbook biquad. `set` is cheap enough to call every few samples for
 *  a sweep. */
class Biquad {
    constructor(type, f, q = 0.707) {
        this.type = type;
        this.x1 = this.x2 = this.y1 = this.y2 = 0;
        this.set(f, q);
    }
    set(f, q = this.q) {
        this.q = q;
        const w = (TAU * Math.min(Math.max(f, 10), SR * 0.45)) / SR;
        const cos = Math.cos(w);
        const alpha = Math.sin(w) / (2 * q);
        let b0, b1, b2;
        if (this.type === "lp") {
            b0 = (1 - cos) / 2;
            b1 = 1 - cos;
            b2 = b0;
        } else if (this.type === "hp") {
            b0 = (1 + cos) / 2;
            b1 = -(1 + cos);
            b2 = b0;
        } else {
            b0 = alpha;
            b1 = 0;
            b2 = -alpha;
        }
        const a0 = 1 + alpha;
        this.b0 = b0 / a0;
        this.b1 = b1 / a0;
        this.b2 = b2 / a0;
        this.a1 = (-2 * cos) / a0;
        this.a2 = (1 - alpha) / a0;
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

/** Band-limited sawtooth (polyBLEP), so the pad and the pluck do not alias. */
class Saw {
    constructor(phase = 0) {
        this.phase = phase;
    }
    next(f) {
        const dt = f / SR;
        this.phase += dt;
        if (this.phase >= 1) this.phase -= 1;
        let t = this.phase;
        let y = 2 * t - 1;
        if (t < dt) {
            t /= dt;
            y -= t + t - t * t - 1;
        } else if (t > 1 - dt) {
            t = (t - 1) / dt;
            y -= t * t + t + t + 1;
        }
        return y;
    }
}

// ─── stems ──────────────────────────────────────────────────────────────────

const stem = () => ({ L: new Float32Array(N), R: new Float32Array(N) });
const S = {
    kick: stem(),
    snare: stem(),
    hats: stem(),
    fx: stem(),
    bass: stem(),
    pad: stem(),
    arp: stem(),
};
/** What each stem sends to the shared reverb and the arp's delay. */
const REVERB_SEND = { kick: 0, snare: 0.32, hats: 0.08, fx: 0.42, bass: 0, pad: 0.38, arp: 0.24 };
const DELAY_SEND = { arp: 0.32, snare: 0.06, fx: 0.08 };

/** Equal-power pan; p in [-1, 1]. */
function write(s, i, v, pan = 0) {
    if (i < 0 || i >= N) return;
    const a = ((pan + 1) * Math.PI) / 4;
    s.L[i] += v * Math.cos(a);
    s.R[i] += v * Math.sin(a);
}

const kicks = [];

// ─── instruments ────────────────────────────────────────────────────────────

function kick(time, vel = 1) {
    kicks.push(time);
    const i0 = Math.round(time * SR);
    const len = Math.round(0.5 * SR);
    const n = noise();
    const click = new Biquad("hp", 3000);
    let ph = 0;
    for (let k = 0; k < len; k++) {
        const t = k / SR;
        const f = 46 + 118 * Math.exp(-t / 0.032);
        ph += (TAU * f) / SR;
        const amp = Math.min(1, t / 0.002) * Math.exp(-t / 0.26);
        const body = Math.tanh(2.2 * Math.sin(ph) * amp) * 0.92;
        const c = click.run(n()) * Math.exp(-t / 0.0025) * 0.5;
        write(S.kick, i0 + k, vel * (body + c));
    }
}

function clap(time, vel = 1) {
    const i0 = Math.round(time * SR);
    const len = Math.round(0.4 * SR);
    const nL = noise();
    const nR = noise();
    const bpL = new Biquad("bp", 1350, 0.8);
    const bpR = new Biquad("bp", 1450, 0.8);
    const hpL = new Biquad("hp", 500);
    const hpR = new Biquad("hp", 500);
    for (let k = 0; k < len; k++) {
        const t = k / SR;
        let env = 0;
        for (const b of [0, 0.011, 0.022]) if (t >= b) env += Math.exp(-(t - b) / 0.0055);
        if (t >= 0.028) env += 0.75 * Math.exp(-(t - 0.028) / 0.11);
        const l = hpL.run(bpL.run(nL())) * env * vel * 1.6;
        const r = hpR.run(bpR.run(nR())) * env * vel * 1.6;
        if (i0 + k < N) {
            S.snare.L[i0 + k] += l;
            S.snare.R[i0 + k] += r;
        }
    }
}

function snare(time, vel = 1) {
    const i0 = Math.round(time * SR);
    const len = Math.round(0.22 * SR);
    const n = noise();
    const bp = new Biquad("bp", 2600, 0.6);
    let ph = 0;
    for (let k = 0; k < len; k++) {
        const t = k / SR;
        ph += (TAU * (180 + 50 * Math.exp(-t / 0.02))) / SR;
        const body = Math.sin(ph) * Math.exp(-t / 0.05) * 0.55;
        const rattle = bp.run(n()) * Math.exp(-t / 0.075) * 1.4;
        write(S.snare, i0 + k, vel * (body + rattle), 0.05);
    }
}

function hat(time, vel = 1, open = false) {
    const i0 = Math.round(time * SR);
    const decay = open ? 0.2 : 0.032;
    const len = Math.round((open ? 0.5 : 0.12) * SR);
    const n = noise();
    const hp = new Biquad("hp", open ? 6500 : 8200, 0.9);
    const hp2 = new Biquad("hp", 6000);
    for (let k = 0; k < len; k++) {
        const t = k / SR;
        const v = hp2.run(hp.run(n())) * Math.exp(-t / decay) * vel;
        write(S.hats, i0 + k, v, open ? -0.22 : 0.18);
    }
}

/** A hit that marks a cut: a sub drop under a long, bright wash. */
function impact(time, vel = 1, wash = true) {
    const i0 = Math.round(time * SR);
    const len = Math.round(2.6 * SR);
    const nL = noise();
    const nR = noise();
    const hpL = new Biquad("hp", 3200, 0.6);
    const hpR = new Biquad("hp", 3400, 0.6);
    let ph = 0;
    for (let k = 0; k < len; k++) {
        const t = k / SR;
        ph += (TAU * (36 + 30 * Math.exp(-t / 0.12))) / SR;
        const sub = Math.sin(ph) * Math.exp(-t / 0.45) * 0.6;
        let l = sub;
        let r = sub;
        if (wash) {
            const env = Math.min(1, t / 0.004) * Math.exp(-t / 0.75) * 0.5;
            l += hpL.run(nL()) * env;
            r += hpR.run(nR()) * env;
        }
        if (i0 + k < N) {
            S.fx.L[i0 + k] += l * vel;
            S.fx.R[i0 + k] += r * vel;
        }
    }
}

/** Filtered noise opening over `dur` seconds and stopping dead at the drop. */
function riser(time, dur, vel = 1) {
    const i0 = Math.round(time * SR);
    const len = Math.round(dur * SR);
    const nL = noise();
    const nR = noise();
    const bpL = new Biquad("bp", 400, 1.6);
    const bpR = new Biquad("bp", 400, 1.6);
    for (let k = 0; k < len; k++) {
        const x = k / len;
        if (k % 16 === 0) {
            const f = 350 * (7200 / 350) ** x;
            bpL.set(f);
            bpR.set(f * 1.04);
        }
        const env = x ** 2.2 * vel * 1.3;
        if (i0 + k < N) {
            S.fx.L[i0 + k] += bpL.run(nL()) * env;
            S.fx.R[i0 + k] += bpR.run(nR()) * env;
        }
    }
}

function bass(time, midi, dur, vel = 1) {
    const i0 = Math.round(time * SR);
    const len = Math.round((dur + 0.03) * SR);
    const f = hz(midi);
    const saw = new Saw();
    const lp = new Biquad("lp", 400, 0.9);
    let sub = 0;
    for (let k = 0; k < len; k++) {
        const t = k / SR;
        if (k % 8 === 0) lp.set(170 + 950 * Math.exp(-t / 0.085), 0.9);
        sub += (TAU * f) / 2 / SR;
        const gate = Math.min(1, t / 0.003) * (t > dur ? Math.max(0, 1 - (t - dur) / 0.03) : 1);
        const v = (lp.run(saw.next(f)) * 0.6 + Math.sin(sub) * 0.42) * gate * vel;
        write(S.bass, i0 + k, v);
    }
}

function pad(time, notes, dur, vel = 1, cutoff = 2000) {
    const i0 = Math.round(time * SR);
    const release = 0.55;
    const len = Math.round((dur + release) * SR);
    const r = noise();
    const voices = [];
    for (const m of notes) {
        for (const [det, pan] of [[-11, -0.65], [0, 0], [11, 0.65]]) {
            voices.push({ f: hz(m) * cents(det), pan, osc: new Saw((r() + 1) / 2) });
        }
    }
    const lpL = new Biquad("lp", cutoff, 0.6);
    const lpR = new Biquad("lp", cutoff, 0.6);
    const gain = (vel * 0.9) / voices.length;
    for (let k = 0; k < len; k++) {
        const t = k / SR;
        if (k % 32 === 0) {
            // A slow breath on the filter, so a held chord is not a still one.
            const c = cutoff * (1 + 0.18 * Math.sin(TAU * 0.25 * (time + t)));
            lpL.set(c);
            lpR.set(c);
        }
        const env = Math.min(1, t / 0.28) * (t > dur ? Math.max(0, 1 - (t - dur) / release) : 1);
        let l = 0;
        let rr = 0;
        for (const v of voices) {
            const s = v.osc.next(v.f);
            const a = ((v.pan + 1) * Math.PI) / 4;
            l += s * Math.cos(a);
            rr += s * Math.sin(a);
        }
        if (i0 + k < N) {
            S.pad.L[i0 + k] += lpL.run(l) * env * gain;
            S.pad.R[i0 + k] += lpR.run(rr) * env * gain;
        }
    }
}

function pluck(time, midi, vel = 1, bright = 1, pan = 0) {
    const i0 = Math.round(time * SR);
    const len = Math.round(0.42 * SR);
    const f = hz(midi);
    const a = new Saw(0.1);
    const b = new Saw(0.6);
    const lp = new Biquad("lp", 2000, 1.4);
    for (let k = 0; k < len; k++) {
        const t = k / SR;
        if (k % 8 === 0) lp.set(260 + 3600 * bright * Math.exp(-t / 0.055), 1.4);
        const env = Math.min(1, t / 0.002) * Math.exp(-t / 0.15);
        const v = lp.run((a.next(f * cents(-7)) + b.next(f * cents(7))) * 0.5) * env * vel;
        write(S.arp, i0 + k, v, pan);
    }
}

// ─── the arrangement ────────────────────────────────────────────────────────

const ORDER = Object.entries(SECTIONS).map(([name, s]) => ({ name, ...s }));
const sectionOf = (bar) => ORDER.find((s) => bar >= s.bar && bar < s.bar + s.bars);
const VERBS = ORDER.filter((s) => s.kind === "verb");

/** The arp walks the chord an octave up: a fixed figure, so it reads as a
 *  motif rather than a run of notes. */
const FIGURE = [0, 2, 1, 3, 2, 4, 3, 1, 0, 2, 1, 3, 4, 2, 3, 1];

for (let bar = 0; bar < BARS; bar++) {
    const t0 = bar * BAR_S;
    const chord = CHORDS[bar];
    const section = sectionOf(bar);
    const sec = section.kind;
    // Verbs open up as the film goes: the filter climbs section by section.
    const verbIndex = VERBS.findIndex((v) => v.name === section.name);
    const beat = (b) => t0 + b * BEAT_S;
    const tones = [...chord.pad.map((m) => m + 12), chord.pad[0] + 24];
    const lastBar = bar === BARS - 1;

    // Pad: under everything, opening up as the film goes.
    const cutoff = sec === "verb" ? 2100 + 100 * verbIndex : { hook: 1500, premise: 1900, claim: 3200, end: 2600 }[sec];
    const padVel = { hook: 0.75, premise: 0.95, claim: 1.15, end: 1 }[sec] ?? 0.85;
    pad(t0, chord.pad, lastBar ? BAR_S - 0.6 : BAR_S, padVel, cutoff);

    // Arp: sixteenths, brightening through the hook, gone on the final bar.
    if (!lastBar) {
        for (let s = 0; s < 16; s++) {
            const bright = sec === "hook" ? 0.35 + 0.65 * ((bar * 16 + s) / 32) : sec === "claim" ? 0.85 : 0.7;
            const vel = (s % 4 === 0 ? 0.95 : s % 2 === 0 ? 0.7 : 0.55) * (sec === "premise" ? 0.85 : 1);
            pluck(t0 + (s * BEAT_S) / 4, tones[FIGURE[s] % tones.length], vel, bright, s % 2 ? 0.3 : -0.3);
        }
    }

    // Bass.
    if (sec === "claim") {
        // Breakdown: no bass.
    } else if (sec === "premise") {
        bass(beat(0), chord.root, BEAT_S * 2.5, 0.85);
        bass(beat(2.5), chord.root, BEAT_S * 1.2, 0.7);
    } else if (lastBar) {
        bass(beat(0), chord.root - 12, BAR_S - 0.6, 0.9);
    } else {
        // Eighths, the off-beat octave up — pushes against the kick.
        for (let e = 0; e < 8; e++) bass(beat(e / 2), chord.root + (e % 2 ? 12 : 0), BEAT_S / 2 - 0.02, e % 2 ? 0.62 : 0.85);
    }

    // Drums.
    const groove = sec === "hook" || sec === "verb" || (sec === "end" && !lastBar);
    if (groove) {
        for (let b = 0; b < 4; b++) kick(beat(b));
        clap(beat(1), 0.85);
        clap(beat(3), 0.85);
        for (let s = 0; s < 16; s++) {
            if (s % 4 === 2) hat(t0 + (s * BEAT_S) / 4, 0.55, true);
            else if (sec !== "hook" || s % 2 === 0) hat(t0 + (s * BEAT_S) / 4, s % 2 ? 0.32 : 0.5);
        }
    } else if (sec === "premise") {
        const lead = bar === section.bar + section.bars - 1;
        for (let b = 0; b < (lead ? 3 : 4); b++) kick(beat(b), 0.8);
        for (let e = 0; e < 8; e++) if (e % 2) hat(beat(e / 2), 0.28);
    } else if (sec === "claim") {
        // One low hit under each word; the film sets a word on beats 0 and 2.
        impact(beat(0), 0.55, false);
        impact(beat(2), 0.55, false);
    } else if (lastBar) {
        kick(beat(0), 1);
    }

    // A fill into each new verb, so the cut is announced a beat early.
    const next = sectionOf(bar + 1);
    if (sec === "verb" && next && next.kind === "verb" && next.bar === bar + 1) {
        for (let s = 0; s < 4; s++) snare(beat(3 + s / 4), 0.35 + 0.15 * s);
    }
}

// Impacts on the section changes; risers into the two drops.
impact(0, 0.9);
VERBS.forEach((v, i) => impact(v.bar * BAR_S, i === 0 ? 0.85 : 0.55));
impact(SECTIONS.claim.bar * BAR_S, 0.7);
impact(SECTIONS.end.bar * BAR_S, 1);
impact((BARS - 1) * BAR_S, 0.8);
riser((VERBS[0].bar - 1) * BAR_S, BAR_S, 0.8);
riser(SECTIONS.claim.bar * BAR_S + BAR_S, BAR_S, 1);

// The roll that carries the claim into the logo: eighths, sixteenths, then
// thirty-seconds, rising.
{
    const t0 = (SECTIONS.end.bar - 1) * BAR_S;
    const hits = [];
    for (let k = 0; k < 4; k++) hits.push(t0 + (k * BEAT_S) / 2);
    for (let k = 0; k < 4; k++) hits.push(t0 + 2 * BEAT_S + (k * BEAT_S) / 4);
    for (let k = 0; k < 8; k++) hits.push(t0 + 3 * BEAT_S + (k * BEAT_S) / 8);
    hits.forEach((t, k) => snare(t, 0.25 + 0.6 * (k / hits.length)));
}

// ─── sidechain, sends, master ───────────────────────────────────────────────

/** The pump: everything melodic ducks under each kick. */
const duck = new Float32Array(N).fill(1);
{
    kicks.sort((a, b) => a - b);
    let next = 0;
    let last = -10;
    for (let i = 0; i < N; i++) {
        const t = i / SR;
        while (next < kicks.length && kicks[next] <= t) last = kicks[next++];
        const dt = t - last;
        const attack = Math.min(1, dt / 0.004);
        duck[i] = 1 - 0.6 * attack * Math.exp(-dt / 0.14);
    }
}

const DUCKED = { bass: 1.1, pad: 1, arp: 0.6 };
const LEVEL = { kick: 0.85, snare: 0.5, hats: 0.24, fx: 0.45, bass: 0.36, pad: 0.46, arp: 0.27 };

const mixL = new Float32Array(N);
const mixR = new Float32Array(N);
const revInL = new Float32Array(N);
const revInR = new Float32Array(N);
const dlyIn = new Float32Array(N);

for (const [name, s] of Object.entries(S)) {
    const lvl = LEVEL[name];
    const depth = DUCKED[name] ?? 0;
    const rs = REVERB_SEND[name] ?? 0;
    const ds = DELAY_SEND[name] ?? 0;
    for (let i = 0; i < N; i++) {
        const g = lvl * (1 - depth * (1 - duck[i]));
        const l = s.L[i] * g;
        const r = s.R[i] * g;
        mixL[i] += l;
        mixR[i] += r;
        revInL[i] += l * rs;
        revInR[i] += r * rs;
        dlyIn[i] += (l + r) * 0.5 * ds;
    }
}

// Ping-pong delay, dotted eighth, darkening on every repeat.
{
    const d = Math.round(BEAT_S * 0.75 * SR);
    const bufL = new Float32Array(N);
    const bufR = new Float32Array(N);
    const lpL = new Biquad("lp", 3800);
    const lpR = new Biquad("lp", 3800);
    for (let i = 0; i < N; i++) {
        const fromR = i >= d ? bufR[i - d] : 0;
        const fromL = i >= d ? bufL[i - d] : 0;
        bufL[i] = lpL.run(dlyIn[i] + fromR * 0.42);
        bufR[i] = lpR.run(fromL * 0.42);
        mixL[i] += bufL[i] * 0.7;
        mixR[i] += bufR[i] * 0.7;
        revInL[i] += bufL[i] * 0.15;
        revInR[i] += bufR[i] * 0.15;
    }
}

// Freeverb (Jezar's tunings, scaled to 48k), with a short pre-delay.
{
    const scale = SR / 44100;
    const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
    const ALLPASS = [556, 441, 341, 225];
    const SPREAD = 23;
    const feedback = 0.86;
    const damp = 0.3;
    const pre = Math.round(0.022 * SR);
    const channel = (input, spread) => {
        const combs = COMBS.map((c) => ({ buf: new Float32Array(Math.round((c + spread) * scale)), i: 0, store: 0 }));
        const aps = ALLPASS.map((a) => ({ buf: new Float32Array(Math.round((a + spread) * scale)), i: 0 }));
        const out = new Float32Array(N);
        for (let n = 0; n < N; n++) {
            const x = (n >= pre ? input[n - pre] : 0) * 0.015;
            let y = 0;
            for (const c of combs) {
                const o = c.buf[c.i];
                c.store = o * (1 - damp) + c.store * damp;
                c.buf[c.i] = x + c.store * feedback;
                c.i = (c.i + 1) % c.buf.length;
                y += o;
            }
            for (const a of aps) {
                const o = a.buf[a.i];
                a.buf[a.i] = y + o * 0.5;
                a.i = (a.i + 1) % a.buf.length;
                y = o - y;
            }
            out[n] = y;
        }
        return out;
    };
    const mono = new Float32Array(N);
    for (let i = 0; i < N; i++) mono[i] = (revInL[i] + revInR[i]) * 0.5;
    const wetL = channel(mono, 0);
    const wetR = channel(mono, SPREAD);
    for (let i = 0; i < N; i++) {
        mixL[i] += wetL[i] * 2.4;
        mixR[i] += wetR[i] * 2.4;
    }
}

// Master: rumble filter, then a soft clip that only touches transients — the
// mix is scaled so its loudest sample drives tanh to 1.25, not into a wall —
// a fade on the last half second, and a final level of about -12 LUFS.
{
    const hpL = new Biquad("hp", 32);
    const hpR = new Biquad("hp", 32);
    let peak = 0;
    for (let i = 0; i < N; i++) {
        mixL[i] = hpL.run(mixL[i]);
        mixR[i] = hpR.run(mixR[i]);
        peak = Math.max(peak, Math.abs(mixL[i]), Math.abs(mixR[i]));
    }
    const drive = 1.25 / peak;
    const fade = Math.round(0.5 * SR);
    let out = 0;
    for (let i = 0; i < N; i++) {
        const tail = i > N - fade ? (N - i) / fade : 1;
        mixL[i] = Math.tanh(mixL[i] * drive) * tail;
        mixR[i] = Math.tanh(mixR[i] * drive) * tail;
        out = Math.max(out, Math.abs(mixL[i]), Math.abs(mixR[i]));
    }
    const g = MASTER_PEAK / out;
    for (let i = 0; i < N; i++) {
        mixL[i] *= g;
        mixR[i] *= g;
    }
}

// ─── write a 16-bit stereo WAV ──────────────────────────────────────────────

const bytes = N * 4;
const wav = Buffer.alloc(44 + bytes);
wav.write("RIFF", 0);
wav.writeUInt32LE(36 + bytes, 4);
wav.write("WAVE", 8);
wav.write("fmt ", 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(SR, 24);
wav.writeUInt32LE(SR * 4, 28);
wav.writeUInt16LE(4, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(bytes, 40);
for (let i = 0; i < N; i++) {
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mixL[i])) * 32767), 44 + i * 4);
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mixR[i])) * 32767), 46 + i * 4);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, wav);
console.log(`wrote ${OUT} — ${(N / SR).toFixed(2)}s, ${BPM} BPM, ${BARS} bars, ${kicks.length} kicks`);
