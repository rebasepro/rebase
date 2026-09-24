import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { RebaseDesk, type DeskProps } from "../desk/DeskFilm";
import { DESK_NARRATION } from "../desk/script";
import { buildDeskTimeline, LIVE_HORIZON, type Timing } from "../desk/timeline";
import { Follower } from "./follow";
import { canRecognize, Recognizer, TakeRecorder, VoiceDetector } from "./listen";
import { simulateRead } from "./simulate";

/**
 * THE RECORDING PAGE — the film plays while the presenter reads, and
 * follows them: the prompter lights each word as it is said, the camera
 * leaves for the next beat when the next line starts, and every window on
 * the desk waits for its word. Nothing runs on a timer. Meanwhile the
 * camera and microphone are recorded, and when the read is over the take
 * and everything the page heard go to the server, which measures the take
 * and writes the props the final render reads (scripts/take.mjs).
 *
 * Served by scripts/live.mjs (`pnpm live`). Chrome only: the words come
 * from Chrome's speech recognition.
 *
 *   ?simulate[=wpm]   no camera, no microphone: a simulated presenter reads
 *                     the script at that pace, to try the page out.
 *   ?lang=en-GB       the recogniser's language (default en-US).
 */

const FPS = 30;
const params = new URLSearchParams(location.search);
const SIMULATE = params.has("simulate") ? Number(params.get("simulate")) || 155 : null;
const LANG = params.get("lang") ?? "en-US";

type Phase = "setup" | "ready" | "recording" | "saving" | "saved" | "error";

interface Saved {
    id: string;
    summary: string;
    render: string;
}

const EMPTY: Timing = { live: true, lines: DESK_NARRATION.map(() => null) };

/** One take in progress. */
interface Session {
    id: string;
    follower: Follower;
    /** performance.now() of the recording's first frame: frame 0. */
    t0: number;
    recorder: TakeRecorder | null;
    recognizer: Recognizer | null;
    voice: VoiceDetector | null;
    stopSim: (() => void) | null;
    raf: number;
    stopping: boolean;
    /** The follower version last handed to the film, and its timing. */
    version: number;
    lastTiming: Timing;
}

const remember = (key: string, value?: string) => {
    try {
        if (value === undefined) return localStorage.getItem(key) ?? undefined;
        localStorage.setItem(key, value);
    } catch {
        /* private window: no memory, no harm */
    }
    return undefined;
};

function takeId(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `take-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function post(path: string, body: BodyInit): Promise<Response> {
    const res = await fetch(path, { method: "POST", body });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    return res;
}

export const App: React.FC = () => {
    const [phase, setPhase] = useState<Phase>(SIMULATE ? "ready" : "setup");
    const [error, setError] = useState<string | null>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
    const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
    const [camera, setCamera] = useState<string | undefined>(() => remember("live.camera"));
    const [mic, setMic] = useState<string | undefined>(() => remember("live.mic"));
    const [timing, setTiming] = useState<Timing>(EMPTY);
    const [position, setPosition] = useState({ line: 0, word: 0 });
    const [status, setStatus] = useState({ recognition: "idle", transcript: "", level: -100, threshold: -58, speaking: false });
    const [elapsed, setElapsed] = useState(0);
    const [saved, setSaved] = useState<Saved | null>(null);

    const player = useRef<PlayerRef>(null);
    const session = useRef<Session | null>(null);
    const starting = useRef(false);

    /* ── the camera and microphone ───────────────────────────────────── */

    useEffect(() => {
        if (SIMULATE) return;
        let cancelled = false;
        let opened: MediaStream | null = null;
        navigator.mediaDevices
            .getUserMedia({
                video: { deviceId: camera ? { exact: camera } : undefined, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
                /* The voice as it is: no gain riding, no noise gate, no echo
                   cancellation — the take is the film's soundtrack. */
                audio: { deviceId: mic ? { exact: mic } : undefined, autoGainControl: false, noiseSuppression: false, echoCancellation: false },
            })
            .then(async (s) => {
                if (cancelled) return s.getTracks().forEach((t) => t.stop());
                opened = s;
                setStream(s);
                const devices = await navigator.mediaDevices.enumerateDevices();
                setCameras(devices.filter((d) => d.kind === "videoinput"));
                setMics(devices.filter((d) => d.kind === "audioinput"));
                setPhase((p) => (p === "setup" || p === "error" ? "ready" : p));
            })
            .catch((err: unknown) => {
                setError(`Camera or microphone unavailable: ${String(err)}. Allow both for this page in the address bar, then reload.`);
                setPhase("error");
            });
        return () => {
            cancelled = true;
            opened?.getTracks().forEach((t) => t.stop());
        };
    }, [camera, mic]);

    /* A meter before the take starts, so the level can be checked. */
    useEffect(() => {
        if (!stream || phase !== "ready") return;
        const meter = new VoiceDetector(stream, () => undefined);
        meter.start();
        const id = window.setInterval(() => setStatus((s) => ({ ...s, level: meter.level, threshold: meter.threshold, speaking: meter.speaking })), 100);
        return () => {
            window.clearInterval(id);
            meter.stop();
        };
    }, [stream, phase]);

    /* ── a take ──────────────────────────────────────────────────────── */

    const loop = useCallback(() => {
        const s = session.current;
        if (!s) return;
        const frame = ((performance.now() - s.t0) * FPS) / 1000;
        const f = s.follower;
        f.tick(frame);
        if (f.version !== s.version) {
            s.version = f.version;
            s.lastTiming = f.timing();
            setTiming(s.lastTiming);
            setPosition(f.position());
        }
        setElapsed(frame / FPS);
        if (s.voice) {
            const v = s.voice;
            setStatus((st) => ({ ...st, level: v.level, threshold: v.threshold, speaking: v.speaking }));
        }
        /* Keep the film on the take's clock. The Player runs its own, and a
           slow frame can leave it behind; a nudge now and then is better
           than a film that drifts from the voice for a whole take. */
        const p = player.current;
        if (p && Math.round(frame) % 15 === 0 && Math.abs(p.getCurrentFrame() - frame) > 4) p.seekTo(Math.round(frame));
        /* The film ends by itself: its own length is known once the last
           line is, and the take stops a second after it. */
        const duration = buildDeskTimeline(s.lastTiming).duration;
        if (duration !== null && frame > duration + FPS && !s.stopping) {
            void stop();
            return;
        }
        s.raf = requestAnimationFrame(loop);
    }, []);

    const start = useCallback(async () => {
        /* Space on a focused Start button is both a keydown and, on keyup,
           a click: without the latch, the second arrives while the recorder
           is still starting and a second take starts beside the first. */
        if (session.current || starting.current || (phase !== "ready" && phase !== "saved")) return;
        starting.current = true;
        setSaved(null);
        setError(null);
        const id = takeId();
        const follower = new Follower(FPS);
        const s: Session = {
            id,
            follower,
            t0: 0,
            recorder: null,
            recognizer: null,
            voice: null,
            stopSim: null,
            raf: 0,
            stopping: false,
            version: -1,
            lastTiming: EMPTY,
        };
        const now = () => ((performance.now() - s.t0) * FPS) / 1000;
        try {
            if (stream && !SIMULATE) {
                const recorder: TakeRecorder = new TakeRecorder(stream, async (chunk: Blob): Promise<void> => {
                    await post(`/api/takes/${id}/chunk?ext=${recorder.extension}`, chunk);
                });
                s.recorder = recorder;
                await recorder.start();
                s.t0 = recorder.startedAt;
                s.voice = new VoiceDetector(stream, (speaking, atMs) =>
                    follower.onVoice(speaking, ((atMs - s.t0) * FPS) / 1000, now()),
                );
                s.voice.start();
                s.recognizer = new Recognizer(LANG, {
                    onSession: () => follower.onSession(now()),
                    onTranscript: (text, final) => {
                        follower.onTranscript(text, final, now());
                        setStatus((st) => ({ ...st, transcript: text.split(" ").slice(-12).join(" ") }));
                    },
                    onState: (state, detail) => setStatus((st) => ({ ...st, recognition: detail ?? state })),
                });
                s.recognizer.start();
            } else {
                s.t0 = performance.now();
                s.stopSim = runSimulation(follower, s.t0, SIMULATE ?? 155, (text) =>
                    setStatus((st) => ({ ...st, recognition: "simulated", transcript: text.split(" ").slice(-12).join(" ") })),
                );
            }
        } catch (err) {
            starting.current = false;
            setError(String(err));
            setPhase("error");
            return;
        }
        starting.current = false;
        session.current = s;
        setTiming(EMPTY);
        setPosition({ line: 0, word: 0 });
        player.current?.seekTo(0);
        player.current?.play();
        setPhase("recording");
        s.raf = requestAnimationFrame(loop);
    }, [phase, stream, loop]);

    const stop = useCallback(async (discard = false) => {
        const s = session.current;
        if (!s || s.stopping) return;
        s.stopping = true;
        cancelAnimationFrame(s.raf);
        s.recognizer?.stop();
        s.voice?.stop();
        s.stopSim?.();
        player.current?.pause();
        setPhase("saving");
        try {
            await s.recorder?.stop();
            const f = s.follower;
            const log = {
                id: s.id,
                fps: FPS,
                lang: LANG,
                simulated: SIMULATE !== null,
                recordedAt: new Date().toISOString(),
                durationFrames: Math.round(((performance.now() - s.t0) * FPS) / 1000),
                container: s.recorder?.extension ?? null,
                latency: f.latency,
                perWord: f.perWord,
                lines: DESK_NARRATION.map((l, k) => ({
                    id: l.id,
                    words: l.words,
                    said: f.said[k],
                    heard: f.heard[k],
                    recognized: f.recognized[k],
                    end: f.ends[k],
                })),
                timing: f.timing(),
                events: f.events,
            };
            if (discard) {
                if (s.recorder) await post(`/api/takes/${s.id}/discard`, "");
                session.current = null;
                setPhase("ready");
                return;
            }
            if (SIMULATE !== null) {
                session.current = null;
                setSaved({ id: s.id, summary: summarize(log.timing), render: "(a simulated read is not saved)" });
                setPhase("saved");
                return;
            }
            await post(`/api/takes/${s.id}/log`, JSON.stringify(log, null, 1));
            const res = await post(`/api/takes/${s.id}/process`, "");
            const out = (await res.json()) as { summary: string; render: string };
            session.current = null;
            setSaved({ id: s.id, summary: out.summary, render: out.render });
            setPhase("saved");
        } catch (err) {
            session.current = null;
            setError(`Saving the take failed: ${String(err)}. What was recorded is in takes/${s.id}/.`);
            setPhase("error");
        }
    }, []);

    /* ── keys ────────────────────────────────────────────────────────── */

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLSelectElement) return;
            const s = session.current;
            if (e.code === "Space" && !s) {
                e.preventDefault();
                void start();
            } else if (e.code === "Escape" && s) {
                e.preventDefault();
                void stop();
            } else if ((e.code === "ArrowRight" || e.code === "PageDown") && s) {
                /* A presenter's clicker sends PageDown. */
                e.preventDefault();
                s.follower.advanceLine(((performance.now() - s.t0) * FPS) / 1000);
            } else if (e.code === "KeyR" && s && !s.stopping) {
                e.preventDefault();
                void stop(true);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [start, stop]);

    /* ── the page ────────────────────────────────────────────────────── */

    const inputProps = useMemo<DeskProps>(() => ({ timing, live: { stream } }), [timing, stream]);

    /* ?simulate is a demonstration: it starts reading by itself. (Armed in
       the timeout, not before it: StrictMode runs this effect twice in
       development, and a latch set outside would cancel the only start.) */
    const autoStarted = useRef(false);
    useEffect(() => {
        if (SIMULATE === null || phase !== "ready" || autoStarted.current) return;
        const id = window.setTimeout(() => {
            autoStarted.current = true;
            void start();
        }, 800);
        return () => window.clearTimeout(id);
    }, [phase, start]);

    /* Before a take, the film sits a few frames in — past the presenter's
       ten-frame fade — so the camera's framing can be judged. */
    useEffect(() => {
        if (phase === "ready" || phase === "setup") player.current?.seekTo(12);
    }, [phase]);
    const recording = phase === "recording";

    return (
        <div style={page}>
            <Prompter position={position} timing={timing} phase={phase} />

            <div style={{ minHeight: 0, display: "flex", justifyContent: "center", padding: "0 24px" }}>
                <div style={{ height: "100%", aspectRatio: "16 / 9", maxWidth: "100%", borderRadius: 13, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <Player
                        ref={player}
                        component={RebaseDesk}
                        inputProps={inputProps}
                        durationInFrames={LIVE_HORIZON}
                        fps={FPS}
                        compositionWidth={1920}
                        compositionHeight={1080}
                        style={{ width: "100%", aspectRatio: "16 / 9", display: "block" }}
                        controls={false}
                        clickToPlay={false}
                        doubleClickToFullscreen={false}
                        spaceKeyToPlayOrPause={false}
                        /* Silent: anything the film played would reach the
                           microphone, the recogniser and the take. */
                        initiallyMuted
                        acknowledgeRemotionLicense
                    />
                </div>
            </div>

            <div style={bar}>
                <span style={{ color: recording ? "#FF5A5F" : "rgba(255,255,255,0.45)", fontWeight: 600 }}>
                    {recording ? `● REC ${clock(elapsed)}` : phase === "saving" ? "saving…" : SIMULATE ? `simulated read, ${SIMULATE} wpm` : "ready"}
                </span>
                <span>
                    line {Math.min(position.line + 1, DESK_NARRATION.length)}/{DESK_NARRATION.length}
                </span>
                <Meter level={status.level} threshold={status.threshold} speaking={status.speaking} />
                <span style={{ color: "rgba(255,255,255,0.45)" }}>{canRecognize() || SIMULATE ? status.recognition : "no speech recognition — use Chrome"}</span>
                <span style={{ flex: 1, fontFamily: "JetBrains Mono, monospace", fontSize: 13, color: "rgba(255,255,255,0.4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "right" }}>
                    {status.transcript}
                </span>
            </div>

            <div style={{ ...bar, paddingTop: 0, color: "rgba(255,255,255,0.4)" }}>
                {phase === "ready" || phase === "saved" ? (
                    <>
                        <button style={button} onClick={() => void start()}>
                            Start — Space
                        </button>
                        {!SIMULATE && (
                            <>
                                <Select label="Camera" value={camera} options={cameras} onChange={(v) => { setCamera(v); remember("live.camera", v); }} />
                                <Select label="Microphone" value={mic} options={mics} onChange={(v) => { setMic(v); remember("live.mic", v); }} />
                            </>
                        )}
                        <span style={{ color: "#36CCD6" }}>
                            {SIMULATE
                                ? "A simulated presenter reads the script by itself. Space reads it again."
                                : "Press Space, then start reading whenever you are ready — the film waits for you."}
                        </span>
                        {!SIMULATE && <span>Recognition hears the system microphone: make it this one.</span>}
                    </>
                ) : recording ? (
                    <span>Read at your own pace. → or a clicker: next line · Esc: stop and save · R: throw this take away and start over</span>
                ) : null}
            </div>

            {error && <div style={{ ...panel, borderColor: "rgba(255,90,95,0.5)", color: "#FFB4B6" }}>{error}</div>}
            {saved && (
                <div style={{ ...panel, maxHeight: "60vh", overflow: "auto" }}>
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>Saved {saved.id}</div>
                    <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "JetBrains Mono, monospace", fontSize: 13, color: "rgba(255,255,255,0.7)" }}>{saved.summary}</pre>
                    <div style={{ marginTop: 12, fontSize: 13, color: "rgba(255,255,255,0.5)" }}>Render it:</div>
                    <pre style={{ margin: "4px 0 0", fontFamily: "JetBrains Mono, monospace", fontSize: 13, userSelect: "all" }}>{saved.render}</pre>
                </div>
            )}
        </div>
    );
};

/* ── the prompter ────────────────────────────────────────────────────── */

/**
 * A teleprompter: the whole script as one column that scrolls so the word
 * being said sits a third of the way down a fixed band. Said words are full
 * white, the next one is underlined, what is still to come is readable at
 * two thirds, and what has been said recedes. It sits at the top of the
 * page, under the camera, so a read looks at the lens — and a fixed band
 * means the film under it never moves, whatever the length of the line.
 */
const Prompter: React.FC<{ position: { line: number; word: number }; timing: Timing; phase: Phase }> = ({ position, timing, phase }) => {
    const box = useRef<HTMLDivElement>(null);
    const words = useRef(new Map<string, HTMLSpanElement>());
    const [offset, setOffset] = useState(0);
    const idle = phase !== "recording";
    const current = Math.min(position.line, DESK_NARRATION.length - 1);
    const spoken = Math.max(timing.lines[current]?.words.length ?? 0, position.word);
    const focus = Math.min(spoken, DESK_NARRATION[current].words.length - 1);

    useLayoutEffect(() => {
        const span = words.current.get(`${current}:${idle ? 0 : focus}`);
        const height = box.current?.clientHeight ?? 0;
        if (span) setOffset(Math.max(0, span.offsetTop - height * 0.3));
    }, [current, focus, idle]);

    return (
        <div
            ref={box}
            style={{
                position: "relative",
                overflow: "hidden",
                WebkitMaskImage: "linear-gradient(transparent 0%, #000 14%, #000 78%, transparent 100%)",
                maskImage: "linear-gradient(transparent 0%, #000 14%, #000 78%, transparent 100%)",
            }}
        >
            <div
                style={{
                    position: "relative",
                    maxWidth: 1400,
                    margin: "0 auto",
                    /* The reading position is a third of the way down the
                       band; this puts the first line there before anything
                       has scrolled. 30% of a 30vh band. */
                    padding: "9vh 48px 0",
                    transform: `translateY(${-offset}px)`,
                    transition: "transform 380ms cubic-bezier(0.16, 1, 0.3, 1)",
                    fontFamily: "Instrument Sans, Inter, sans-serif",
                    fontSize: "clamp(26px, 3.6vh, 42px)",
                    lineHeight: 1.32,
                    fontWeight: 500,
                    letterSpacing: "-0.01em",
                    textAlign: "center",
                }}
            >
                {DESK_NARRATION.map((line, k) => (
                    <p key={line.id} style={{ margin: "0 0 0.7em" }}>
                        {line.words.map((w, i) => {
                            const past = !idle && (k < current || (k === current && i < spoken));
                            const next = !idle && k === current && i === spoken;
                            const color = past ? (k < current ? "rgba(255,255,255,0.22)" : "#FFFFFF") : "rgba(255,255,255,0.62)";
                            return (
                                <span
                                    key={i}
                                    ref={(el) => {
                                        if (el) words.current.set(`${k}:${i}`, el);
                                    }}
                                    style={{
                                        color,
                                        /* Longhands only: React warns on every
                                           render that toggles the shorthand
                                           beside them. */
                                        textDecorationLine: next ? "underline" : "none",
                                        textDecorationColor: "#36CCD6",
                                        textDecorationThickness: 3,
                                        textUnderlineOffset: "0.2em",
                                    }}
                                >
                                    {w}{" "}
                                </span>
                            );
                        })}
                    </p>
                ))}
            </div>
        </div>
    );
};

const Meter: React.FC<{ level: number; threshold: number; speaking: boolean }> = ({ level, threshold, speaking }) => {
    const x = (db: number) => `${Math.max(0, Math.min(100, ((db + 80) / 80) * 100))}%`;
    return (
        <span style={{ position: "relative", width: 140, height: 8, borderRadius: 4, background: "rgba(255,255,255,0.08)", overflow: "hidden" }} title="microphone level; the line is the voice threshold">
            <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: x(level), background: speaking ? "#34D399" : "rgba(255,255,255,0.35)" }} />
            <span style={{ position: "absolute", left: x(threshold), top: 0, bottom: 0, width: 2, background: "#36CCD6" }} />
        </span>
    );
};

const Select: React.FC<{ label: string; value: string | undefined; options: MediaDeviceInfo[]; onChange: (v: string) => void }> = ({ label, value, options, onChange }) => (
    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {label}
        <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} style={select}>
            {!value && <option value="">default</option>}
            {options.map((o) => (
                <option key={o.deviceId} value={o.deviceId}>
                    {o.label || o.deviceId.slice(0, 8)}
                </option>
            ))}
        </select>
    </label>
);

/* ── helpers ─────────────────────────────────────────────────────────── */

/** Feeds the follower a simulated read, on the real clock. */
function runSimulation(follower: Follower, t0: number, wpm: number, onText: (text: string) => void): () => void {
    const read = simulateRead({ wpm, startMs: 1500 });
    let i = 0;
    let stopped = false;
    const frame = (ms: number) => (ms * FPS) / 1000;
    const step = () => {
        if (stopped) return;
        const ms = performance.now() - t0;
        while (i < read.events.length && read.events[i].atMs <= ms) {
            const e = read.events[i++];
            if (e.kind === "session") follower.onSession(frame(ms));
            else if (e.kind === "voice") follower.onVoice(e.speaking, frame(e.voiceAtMs), frame(ms));
            else {
                follower.onTranscript(e.text, e.final, frame(ms));
                onText(e.text);
            }
        }
        requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    return () => {
        stopped = true;
    };
}

function summarize(t: Timing): string {
    const tl = buildDeskTimeline(t);
    return DESK_NARRATION.map((l, k) => {
        const s = t.lines[k];
        if (!s) return `${l.id.padEnd(9)} —`;
        const start = s.words[0] / FPS;
        const end = (s.end ?? s.words[s.words.length - 1]) / FPS;
        return `${l.id.padEnd(9)} ${clock(start)} → ${clock(end)}  ${Math.round((l.words.length / Math.max(0.1, end - start)) * 60)} wpm`;
    })
        .concat(`film: ${tl.duration === null ? "—" : clock(tl.duration / FPS)}`)
        .join("\n");
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}.${Math.floor((seconds % 1) * 10)}`;

/* One screen, never scrolled: the prompter's fixed band on top, the film
   in whatever height is left, the status and the keys under it. */
const PROMPTER_HEIGHT = "30vh";
const page: React.CSSProperties = {
    height: "100vh",
    overflow: "hidden",
    background: "#0A0A0A",
    color: "#FFFFFF",
    fontFamily: "Inter, sans-serif",
    display: "grid",
    gridTemplateRows: `${PROMPTER_HEIGHT} minmax(0, 1fr) auto auto`,
    gap: 12,
    paddingBottom: 16,
    boxSizing: "border-box",
};
const bar: React.CSSProperties = { display: "flex", alignItems: "center", gap: 20, padding: "4px 48px 0", fontSize: 14 };
/* Over the film, at the bottom: a take's report or an error. */
const panel: React.CSSProperties = {
    position: "fixed",
    left: 48,
    right: 48,
    bottom: 72,
    padding: "16px 20px",
    borderRadius: 9,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "#131313",
    zIndex: 2,
};
const button: React.CSSProperties = { background: "#FFFFFF", color: "#0A0A0A", border: 0, borderRadius: 6, padding: "8px 16px", fontWeight: 600, fontSize: 14, cursor: "pointer" };
const select: React.CSSProperties = { background: "#181818", color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 6, padding: "5px 8px", maxWidth: 260 };
