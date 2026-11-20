import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { cutFor, filmById, FILMS, type Cut, type FilmProps } from "./films";
import { authoredTiming, LIVE_HORIZON, type Script, type SpokenLine, type Timing } from "../spoken/narration";
import { assemble, serves, type Chapter, type Edit, type TakeInfo } from "../spoken/production";
import { Follower } from "./follow";
import { canRecognize, Recognizer, TakeRecorder, VoiceDetector } from "./listen";
import { PhoneLink, type PhoneState, type SyncResult, type TakeVideo } from "./phoneLink";
import { simulateRead } from "./simulate";
import { diffWords, heardPerLine, sameWords, suggestLine, TranscriptLog, type DiffPart, type HeardWord } from "./transcript";

/**
 * THE RECORDING PAGE — a film recorded in pieces, watched back as it will be
 * cut, and rendered from here.
 *
 *   RECORD    pick a chapter (or a line to start from), press Space, read.
 *             The film plays from that point and follows your voice: the
 *             prompter lights each word as it is said, scenes wait for
 *             their words. Record a chapter as many times as you like;
 *             every take is kept.
 *   PLAY BACK after a take, the chapter plays back in place — the scenes
 *             before it, your take, the scenes it leads into — with sound.
 *             P plays the chapter again, Shift+P the whole cut.
 *   CHOOSE    each chapter lists its takes. The newest serves by default;
 *             "Use" keeps an older one. A take's lines stop serving if the
 *             script's words change under it — record them again.
 *   CUTS      the long film (16:9) and the short (9:16) are assembled from
 *             the same takes (src/spoken/production.ts). Switch between
 *             them to watch either; render either from the sidebar.
 *
 * Served by scripts/live.mjs (`pnpm live`). Chrome only: the words come
 * from Chrome's speech recognition.
 *
 *   ?film=<id>        which film (the menu sets it).
 *   ?simulate[=wpm]   a dry run: no camera, no microphone — a simulated
 *                     presenter reads, and its takes are saved as test
 *                     patterns with a tone for a voice, so the whole
 *                     workflow can be tried. Simulated takes are only used
 *                     in simulate mode.
 *   ?lang=en-GB       the recogniser's language (default en-US).
 *
 * THE PHONE AS A CAMERA: pick "Phone (wireless)" as the camera and scan the
 * QR code with the phone (same Wi-Fi). Its camera arrives over WebRTC
 * (src/live/phone.ts, src/live/phoneLink.ts, scripts/phone.mjs); the voice
 * is still this Mac's microphone, and each take records how late the
 * picture arrived so take.mjs can line it up with the sound. Run the "Sync
 * check" once per phone camera (the phone filming this screen while it
 * flashes): it measures the camera's own delay, which no statistic shows.
 */

const FPS = 30;
/** Seconds counted down between Start and the recorder starting. */
const COUNTDOWN = 3;
const params = new URLSearchParams(location.search);
const SIMULATE = params.has("simulate") ? Number(params.get("simulate")) || 155 : null;
const LANG = params.get("lang") ?? "en-US";
const FILM = filmById(params.get("film"));
const SCRIPT = FILM.script;
/** Frames between the end of what came before and the start of a take, in
 *  the film a take is previewed in. */
const PREVIEW_GAP = 10;
/** A chapter plays back from this long before its first word. */
const REVIEW_LEAD = 30;

type Phase = "setup" | "ready" | "recording" | "saving" | "error";

/** The camera choice that means the phone (it is not a device id). */
const PHONE = "phone";
const PHONE_OPTION = { deviceId: PHONE, label: "Phone (wireless)" };

interface MicTest {
    state: "listening" | "playing" | "done";
    heard: string;
    recognition: string;
}

/** What is being recorded: a run of the script's lines, by index. */
interface Range {
    from: number;
    to: number;
}

/** One take in progress. */
interface Session {
    id: string;
    /** A rehearsal: followed and listened to like a take, but nothing is
     *  recorded — what was said is compared with the script afterwards. */
    rehearse: boolean;
    /** Every word the recogniser heard, with when. */
    heard: TranscriptLog;
    follower: Follower;
    range: Range;
    cut: Cut;
    /** The film frame the take's frame 0 plays at. */
    offset: number;
    t0: number;
    recorder: TakeRecorder | null;
    /** Recording from the phone: ends the take's delay measurement. */
    phoneTake: (() => TakeVideo) | null;
    recognizer: Recognizer | null;
    voice: VoiceDetector | null;
    stopSim: (() => void) | null;
    raf: number;
    stopping: boolean;
    version: number;
    lastTiming: Timing;
}

/** A talk-through in progress: unscripted, the chapters as prompts. */
interface Talk {
    id: string;
    t0: number;
    recorder: TakeRecorder | null;
    recognizer: Recognizer | null;
    heard: TranscriptLog;
    /** When each chapter was moved on to, in take frames. */
    marks: { chapter: number; at: number }[];
    stopSim: (() => void) | null;
    raf: number;
    stopping: boolean;
}

type Mode = "record" | "rehearse" | "talk";

/** One line of a rehearsal: the script, and what was said. */
interface RehearsedLine {
    id: string;
    script: string;
    heard: string;
}

/** What the player is showing when it is not recording. */
interface Review {
    cut: string;
    /** Play from here to `until` (film frames), then stop. */
    from: number;
    until: number | null;
    /** Picks tried without keeping them: a take auditioned in place. */
    trial: Record<string, string> | null;
    playing: boolean;
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

const indexOf = (id: string) => SCRIPT.findIndex((l) => l.id === id);
const chapterRange = (c: Chapter): Range => ({ from: indexOf(c.lines[0]), to: indexOf(c.lines[c.lines.length - 1]) });
const chapterOf = (line: number) => FILM.chapters.findIndex((c) => c.lines.includes(SCRIPT[line].id));

/** Shift every frame of a live timing by `by`. */
function shift(line: SpokenLine | null, by: number): SpokenLine | null {
    if (!line) return null;
    return {
        words: line.words.map((f) => f + by),
        end: line.end === undefined ? undefined : line.end + by,
        heard: line.heard?.map((f) => f + by),
        endHeard: line.endHeard === undefined ? undefined : line.endHeard + by,
    };
}

export const App: React.FC = () => {
    const [phase, setPhase] = useState<Phase>(SIMULATE ? "ready" : "setup");
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [mode, setModeState] = useState<Mode>(() => (remember("live.mode") as Mode | undefined) ?? "record");
    const setMode = (m: Mode) => {
        setModeState(m);
        remember("live.mode", m);
    };
    const [rehearsal, setRehearsal] = useState<{ id: string; rows: RehearsedLine[] } | null>(null);
    const [transcript, setTranscript] = useState<{ title: string; markdown: string; path?: string } | null>(null);
    const talk = useRef<Talk | null>(null);
    const [talkChapter, setTalkChapter] = useState<number | null>(null);
    /** A take's report for a film rendered from one take: kept until closed. */
    const [info, setInfo] = useState<string | null>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
    const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
    const [camera, setCamera] = useState<string | undefined>(() => remember("live.camera") || undefined);
    const [mic, setMic] = useState<string | undefined>(() => remember("live.mic") || undefined);
    /** Bumped by "Try again": opens the camera and microphone afresh. */
    const [retry, setRetry] = useState(0);
    /* The phone camera: always listening, so a phone can join any time. */
    const phoneLink = useMemo(() => (SIMULATE ? null : new PhoneLink()), []);
    const [phone, setPhone] = useState<PhoneState | null>(null);
    useEffect(() => {
        if (!phoneLink) return;
        phoneLink.start();
        const off = phoneLink.subscribe(setPhone);
        return () => {
            off();
            phoneLink.stop();
        };
    }, [phoneLink]);
    const phoneTrack = camera === PHONE ? (phone?.track ?? null) : null;
    const [syncing, setSyncing] = useState(false);
    const syncingRef = useRef(false);
    syncingRef.current = syncing;
    const [liveTiming, setLiveTiming] = useState<Timing | null>(null);
    const [position, setPosition] = useState({ line: 0, word: 0 });
    const [status, setStatus] = useState({ recognition: "idle", transcript: "", level: -100, threshold: -58, speaking: false });
    const [elapsed, setElapsed] = useState(0);
    const [micTest, setMicTest] = useState<MicTest | null>(null);
    const testing = useRef<{ recorder: MediaRecorder; timer: number; stopPlayback: (() => void) | null } | null>(null);

    /* the production */
    const [allTakes, setAllTakes] = useState<TakeInfo[]>([]);
    const [edit, setEdit] = useState<Edit>({ picks: {} });
    const [chapter, setChapter] = useState(0);
    const [startLine, setStartLine] = useState<number | null>(null);
    const [through, setThrough] = useState(() => remember("live.through") === "1");
    const [playback, setPlayback] = useState(() => remember("live.playback") !== "0");
    const [review, setReview] = useState<Review>({ cut: FILM.cuts[0].id, from: 0, until: null, trial: null, playing: false });
    const [reviewFrame, setReviewFrame] = useState(0);
    const [render, setRender] = useState<Record<string, { state: string; progress?: number; files?: string[]; command?: string }>>({});

    const player = useRef<PlayerRef>(null);
    const session = useRef<Session | null>(null);
    const starting = useRef(false);
    const [countdown, setCountdown] = useState<number | null>(null);
    const callOff = useRef(false);

    /* Simulated takes only count in simulate mode: a dry run never ends up
       in a real film. */
    const takes = useMemo(() => allTakes.filter((t) => !!t.simulated === (SIMULATE !== null)), [allTakes]);
    const number = useMemo(() => new Map(takes.map((t, i) => [t.id, i + 1])), [takes]);

    const refresh = useCallback(async () => {
        const [list, picks] = await Promise.all([
            fetch(`/api/takes?film=${FILM.id}`).then((r) => r.json() as Promise<TakeInfo[]>),
            fetch(`/api/edits/${FILM.id}`).then((r) => r.json() as Promise<Edit>),
        ]);
        setAllTakes(list);
        setEdit(picks);
        return list;
    }, []);

    /* On load: the takes so far, and the first chapter still to record. */
    useEffect(() => {
        void refresh().then((list) => {
            const usable = list.filter((t) => !!t.simulated === (SIMULATE !== null));
            const todo = FILM.chapters.findIndex((c) => c.lines.some((id) => !usable.some((t) => serves(t, SCRIPT[indexOf(id)]))));
            if (todo > 0) setChapter(todo);
        });
    }, [refresh]);

    const saveEdit = useCallback(async (next: Edit) => {
        setEdit(next);
        await post(`/api/edits/${FILM.id}`, JSON.stringify(next));
    }, []);

    /* ── what is about to be recorded ────────────────────────────────── */

    const range = useMemo<Range>(() => {
        const c = chapterRange(FILM.chapters[chapter]);
        const from = startLine !== null && startLine >= c.from && startLine <= c.to ? startLine : c.from;
        let to = c.to;
        if (through) {
            const cut = cutFor(FILM, SCRIPT.slice(from, to + 1).map((l) => l.id));
            while (to + 1 < SCRIPT.length && cut.script.some((l) => l.id === SCRIPT[to + 1].id)) to++;
        }
        return { from, to };
    }, [chapter, startLine, through]);
    const rangeScript = useMemo<Script>(() => SCRIPT.slice(range.from, range.to + 1), [range]);
    const recordCut = useMemo(() => cutFor(FILM, rangeScript.map((l) => l.id)), [rangeScript]);

    /** Where in `cut` a take of `range` starts: after the authored read of
     *  everything before it, so the scenes before have played out. */
    const offsetIn = useCallback((cut: Cut, first: string) => {
        const k = cut.script.findIndex((l) => l.id === first);
        if (k <= 0) return 0;
        const prev = authoredTiming(cut.script).lines[k - 1];
        return (prev?.end ?? 0) + PREVIEW_GAP;
    }, []);

    /* ── the camera and microphone ───────────────────────────────────── */

    useEffect(() => {
        if (SIMULATE) return;
        let cancelled = false;
        let opened: MediaStream | null = null;
        navigator.mediaDevices
            .getUserMedia({
                /* The phone's picture comes over the network: only the
                   microphone is opened here. */
                video:
                    camera === PHONE
                        ? false
                        : {
                              deviceId: camera ? { exact: camera } : undefined,
                              width: { ideal: 1920 },
                              height: { ideal: 1080 },
                              frameRate: { ideal: 30 },
                          },
                /* The voice as it is: no gain riding, no noise gate, no echo
                   cancellation — the take is the film's soundtrack. */
                audio: { deviceId: mic ? { exact: mic } : undefined, autoGainControl: false, noiseSuppression: false, echoCancellation: false },
            })
            .then(async (s) => {
                if (cancelled) return s.getTracks().forEach((t) => t.stop());
                opened = s;
                /* The phone's track belongs to the link: never stopped here. */
                const waiting = camera === PHONE && !phoneTrack;
                setStream(camera !== PHONE ? s : phoneTrack ? new MediaStream([phoneTrack, ...s.getAudioTracks()]) : null);
                const devices = await navigator.mediaDevices.enumerateDevices();
                setCameras(devices.filter((d) => d.kind === "videoinput"));
                setMics(devices.filter((d) => d.kind === "audioinput"));
                setPhase((p) => (waiting ? (p === "ready" || p === "error" ? "setup" : p) : p === "setup" || p === "error" ? "ready" : p));
            })
            .catch(async (err: unknown) => {
                if (cancelled) return;
                const name = err instanceof DOMException ? err.name : "";
                /* A camera or microphone remembered from an earlier session
                   that is not here now (unplugged, or the browser reset its
                   device ids): forget it and open the default instead. */
                if ((name === "OverconstrainedError" || name === "NotFoundError") && ((camera && camera !== PHONE) || mic)) {
                    if (camera !== PHONE) {
                        remember("live.camera", "");
                        setCamera(undefined);
                    }
                    remember("live.mic", "");
                    setMic(undefined);
                    setNotice("The camera or microphone from last time isn't connected, so the default ones are open. Pick others below if you like.");
                    return;
                }
                const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
                setCameras(devices.filter((d) => d.kind === "videoinput"));
                setMics(devices.filter((d) => d.kind === "audioinput"));
                setError(
                    name === "NotAllowedError"
                        ? "The browser blocked the camera or microphone for this page. Click the camera icon in the address bar, allow both, then press Try again."
                        : name === "NotReadableError"
                          ? "Another app is using the camera or microphone (a video call, Photo Booth…). Close it, then press Try again."
                          : name === "NotFoundError"
                            ? "No camera or microphone found. Plug one in, then press Try again."
                            : `The camera or microphone would not open (${name || String(err)}). Pick others below, or press Try again.`,
                );
                setPhase("error");
            });
        return () => {
            cancelled = true;
            opened?.getTracks().forEach((t) => t.stop());
        };
    }, [camera, mic, retry, phoneTrack]);

    /* ── a camera that freezes ───────────────────────────────────────── */

    const [stalled, setStalled] = useState(false);

    /* A camera can stop delivering frames while its stream still reads as
       live — the picture freezes, and so would a take. A hidden video counts
       the frames that really arrive; two seconds without one is a freeze,
       shown in the status bar (and said once during a take). Nothing is
       changed about the camera: it keeps its full resolution. */
    useEffect(() => {
        const track = stream?.getVideoTracks()[0];
        if (!track || camera === PHONE) return;
        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.srcObject = new MediaStream([track]);
        void video.play().catch(() => undefined);
        let last = performance.now();
        let handle = 0;
        let warned = false;
        const onFrame = () => {
            last = performance.now();
            setStalled(false);
            handle = video.requestVideoFrameCallback(onFrame);
        };
        handle = video.requestVideoFrameCallback(onFrame);
        const id = window.setInterval(() => {
            if (track.readyState !== "live" || document.hidden || performance.now() - last < 2000) return;
            setStalled(true);
            if ((session.current || talk.current) && !warned) {
                warned = true;
                setNotice("The camera froze during this take — its picture will freeze too. Stop, and record it again once the picture moves.");
            }
        }, 500);
        return () => {
            window.clearInterval(id);
            video.cancelVideoFrameCallback(handle);
            video.srcObject = null;
        };
    }, [stream, camera]);

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

    /* ── the cut being watched ───────────────────────────────────────── */

    const viewCut = FILM.cuts.find((c) => c.id === review.cut) ?? FILM.cuts[0];
    const assembled = useMemo(() => {
        if (!viewCut.assembles) return null;
        const trial: Edit = review.trial ? { picks: { ...edit.picks, ...review.trial } } : edit;
        return assemble(viewCut.script, takes, trial);
    }, [viewCut, takes, edit, review.trial]);
    /** Every cut's state, for the sidebar. */
    const cutStates = useMemo(
        () => FILM.cuts.map((c) => ({ cut: c, a: c.assembles ? assemble(c.script, takes, edit) : null })),
        [takes, edit],
    );

    /* ── a take ──────────────────────────────────────────────────────── */

    const stopRef = useRef<(discard?: boolean) => Promise<void>>(async () => undefined);

    const loop = useCallback(() => {
        const s = session.current;
        if (!s) return;
        const frame = ((performance.now() - s.t0) * FPS) / 1000;
        const f = s.follower;
        f.tick(frame);
        if (f.version !== s.version) {
            s.version = f.version;
            s.lastTiming = f.timing();
            setLiveTiming(previewTiming(s));
            setPosition(f.position());
        }
        setElapsed(frame / FPS);
        if (s.voice) {
            const v = s.voice;
            setStatus((st) => ({ ...st, level: v.level, threshold: v.threshold, speaking: v.speaking }));
        }
        /* Keep the film on the take's clock: a slow frame can leave the
           Player behind, and a nudge now and then beats a film that drifts
           from the voice for a whole take. */
        const p = player.current;
        const at = s.offset + frame;
        if (p && Math.round(frame) % 15 === 0 && Math.abs(p.getCurrentFrame() - at) > 4) p.seekTo(Math.round(at));
        /* The take ends by itself once its last line has ended. */
        const last = s.lastTiming.lines[s.follower.script.length - 1];
        if (last?.end !== undefined && frame > last.end + 50 + FPS && !s.stopping) {
            void stopRef.current();
            return;
        }
        s.raf = requestAnimationFrame(loop);
    }, []);

    const start = useCallback(async () => {
        /* Space on a focused button is both a keydown and, on keyup, a
           click: without the latch a second take starts beside the first. */
        if (session.current || starting.current || testing.current || phase !== "ready") return;
        starting.current = true;
        setError(null);
        setNotice(null);
        player.current?.pause();
        player.current?.mute();
        setReview((r) => ({ ...r, playing: false, trial: null }));
        callOff.current = false;
        for (let n = COUNTDOWN; n > 0; n--) {
            setCountdown(n);
            await new Promise((r) => window.setTimeout(r, 1000));
            if (callOff.current) break;
        }
        setCountdown(null);
        if (callOff.current) {
            starting.current = false;
            return;
        }
        const id = takeId();
        const follower = new Follower(FPS, 15, rangeScript);
        const cut = recordCut;
        const rehearse = mode === "rehearse";
        const heard = new TranscriptLog();
        const s: Session = {
            id,
            rehearse,
            heard,
            follower,
            range,
            cut,
            offset: offsetIn(cut, rangeScript[0].id),
            t0: 0,
            recorder: null,
            phoneTake: null,
            recognizer: null,
            voice: null,
            stopSim: null,
            raf: 0,
            stopping: false,
            version: -1,
            lastTiming: follower.timing(),
        };
        const now = () => ((performance.now() - s.t0) * FPS) / 1000;
        try {
            /* What the page hears goes to the follower and to the transcript. */
            const ear: Ear = {
                onSession: (at) => {
                    follower.onSession(at);
                    heard.onSession();
                },
                onTranscript: (text, final, at) => {
                    follower.onTranscript(text, final, at);
                    heard.update(text, at);
                },
                onVoice: (speaking, at, at2) => follower.onVoice(speaking, at, at2),
            };
            if (stream && !SIMULATE) {
                if (!rehearse) {
                    const recorder: TakeRecorder = new TakeRecorder(stream, async (chunk: Blob): Promise<void> => {
                        await post(`/api/takes/${id}/chunk?ext=${recorder.extension}`, chunk);
                    });
                    s.recorder = recorder;
                    if (phoneLink && stream.getVideoTracks()[0] === phoneLink.current.track) s.phoneTake = phoneLink.mark();
                    await recorder.start();
                    s.t0 = recorder.startedAt;
                } else s.t0 = performance.now();
                s.voice = new VoiceDetector(stream, (speaking, atMs) => ear.onVoice(speaking, ((atMs - s.t0) * FPS) / 1000, now()));
                s.voice.start();
                s.recognizer = new Recognizer(LANG, {
                    onSession: () => ear.onSession(now()),
                    onTranscript: (text, final) => {
                        ear.onTranscript(text, final, now());
                        setStatus((st) => ({ ...st, transcript: text.split(" ").slice(-12).join(" ") }));
                    },
                    onState: (state, detail) => setStatus((st) => ({ ...st, recognition: detail ?? state })),
                });
                s.recognizer.start();
            } else {
                s.t0 = performance.now();
                s.stopSim = runSimulation(ear, s.t0, SIMULATE ?? 155, rangeScript, (text) =>
                    setStatus((st) => ({ ...st, recognition: "simulated", transcript: text.split(" ").slice(-12).join(" ") })),
                    /* A rehearsal's dry run mishears a few words, so there is
                       something to compare. */
                    rehearse ? 0.12 : undefined,
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
        setLiveTiming(previewTiming(s));
        setPosition({ line: 0, word: 0 });
        setPhase("recording");
        /* The Player remounts for the take (its cut and props change); seek
           once it has. */
        requestAnimationFrame(() => {
            player.current?.seekTo(s.offset);
            player.current?.play();
        });
        s.raf = requestAnimationFrame(loop);
    }, [phase, stream, loop, range, rangeScript, recordCut, offsetIn, mode, phoneLink]);

    const stop = useCallback(
        async (discard = false) => {
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
                /* How late the phone's picture arrived: take.mjs moves it
                   back by this, so the picture meets the sound. */
                const video = s.phoneTake?.() ?? null;
                s.phoneTake = null;
                const f = s.follower;
                const log = {
                    id: s.id,
                    fps: FPS,
                    lang: LANG,
                    simulated: SIMULATE !== null,
                    film: FILM.id,
                    cut: s.cut.id,
                    range: f.script.map((l) => l.id),
                    /* Assembled with other takes (the series kit), or
                       rendered on its own (the desk and EIC films). */
                    assembles: s.cut.assembles,
                    compositions: s.cut.compositions,
                    recordedAt: new Date().toISOString(),
                    durationFrames: Math.round(((performance.now() - s.t0) * FPS) / 1000),
                    container: s.recorder?.extension ?? null,
                    video,
                    latency: f.latency,
                    perWord: f.perWord,
                    lines: f.script.map((l, k) => ({
                        id: l.id,
                        words: l.words,
                        said: f.said[k],
                        heard: f.heard[k],
                        recognized: f.recognized[k],
                        end: f.ends[k],
                    })),
                    timing: f.timing(),
                    events: f.events,
                    /* Every word heard, as said: ad-libs included. */
                    transcript: s.heard.words(),
                };
                if (s.rehearse && !discard) {
                    const said = heardPerLine(f.script, f.timing(), s.heard.words());
                    const rows = f.script.map((l, k) => ({ id: l.id, script: l.words.join(" "), heard: said[k] }));
                    session.current = null;
                    setLiveTiming(null);
                    setPhase("ready");
                    setRehearsal({ id: s.id.replace("take-", "rehearsal-"), rows });
                    void post(`/api/rehearsals/${FILM.id}`, JSON.stringify({ id: s.id.replace("take-", "rehearsal-"), film: FILM.id, recordedAt: log.recordedAt, simulated: log.simulated, lines: rows, transcript: log.transcript }, null, 1)).catch(() => undefined);
                    return;
                }
                if (s.rehearse) {
                    session.current = null;
                    setLiveTiming(null);
                    setPhase("ready");
                    return;
                }
                if (discard) {
                    if (s.recorder) await post(`/api/takes/${s.id}/discard`, "");
                    session.current = null;
                    setLiveTiming(null);
                    setPhase("ready");
                    setNotice("Take thrown away.");
                    return;
                }
                if (!f.timing().lines.some(Boolean)) {
                    if (s.recorder) await post(`/api/takes/${s.id}/discard`, "");
                    session.current = null;
                    setLiveTiming(null);
                    setPhase("ready");
                    setNotice("Nothing was read, so nothing was kept.");
                    return;
                }
                await post(`/api/takes/${s.id}/log`, JSON.stringify(log, null, 1));
                const processed = (await (await post(`/api/takes/${s.id}/process`, "")).json()) as { summary: string; render: string };
                if (!s.cut.assembles) setInfo(`${processed.summary}\n\nRender it:\n  ${processed.render}`);
                session.current = null;
                setLiveTiming(null);
                const list = (await refresh()).filter((t) => !!t.simulated === (SIMULATE !== null));
                setPhase("ready");
                const n = list.findIndex((t) => t.id === s.id) + 1;
                const a = FILM.chapters[chapterOf(s.range.from)]?.title ?? "the film";
                const b = FILM.chapters[chapterOf(s.range.to)]?.title;
                const kept = list.find((t) => t.id === s.id);
                const lost = s.follower.script.length - (kept?.lines.length ?? 0);
                setNotice(
                    n > 0
                        ? `Kept take #${n} · ${b && b !== a ? `${a} → ${b}` : a}${lost > 0 ? ` · ${lost} line(s) not finished, so not used` : ""}. Space: again · N: next chapter`
                        : "The take was saved but could not be measured — see the server's log.",
                );
                /* Playback: the chapter in place, with the take just made. */
                if (playback && s.cut.assembles) setPendingReview({ cut: s.cut.id, line: SCRIPT[s.range.from].id, to: SCRIPT[s.range.to].id });
            } catch (err) {
                session.current = null;
                setLiveTiming(null);
                setError(`Saving the take failed: ${String(err)}. What was recorded is in takes/${s.id}/.`);
                /* Still ready to record: one take going wrong is no reason to
                   reload the page. */
                setPhase("ready");
            }
        },
        [refresh, playback],
    );
    stopRef.current = stop;

    /* ── talking it through ──────────────────────────────────────────── */

    /* Unscripted: the camera and microphone record, the recogniser writes
       down what you say, and the prompter shows only the chapter titles. →
       (or a clicker) moves to the next chapter, so the transcript comes out
       sorted under them. Nothing here becomes a take: it is raw material
       for the script, in your own words. */
    const startTalk = useCallback(async () => {
        if (session.current || talk.current || starting.current || testing.current || phase !== "ready") return;
        starting.current = true;
        setError(null);
        setNotice(null);
        setTranscript(null);
        player.current?.pause();
        player.current?.mute();
        setReview((r) => ({ ...r, playing: false, trial: null }));
        callOff.current = false;
        for (let n = COUNTDOWN; n > 0; n--) {
            setCountdown(n);
            await new Promise((r) => window.setTimeout(r, 1000));
            if (callOff.current) break;
        }
        setCountdown(null);
        if (callOff.current) {
            starting.current = false;
            return;
        }
        const id = `loose-${takeId().slice("take-".length)}`;
        const heard = new TranscriptLog();
        const t: Talk = { id, t0: 0, recorder: null, recognizer: null, heard, marks: [{ chapter, at: 0 }], stopSim: null, raf: 0, stopping: false };
        const now = () => ((performance.now() - t.t0) * FPS) / 1000;
        const show = (text: string) => setStatus((st) => ({ ...st, transcript: text.split(" ").slice(-12).join(" ") }));
        try {
            if (stream && !SIMULATE) {
                const recorder: TakeRecorder = new TakeRecorder(stream, async (chunk: Blob): Promise<void> => {
                    await post(`/api/loose/${id}/chunk?ext=${recorder.extension}`, chunk);
                });
                t.recorder = recorder;
                await recorder.start();
                t.t0 = recorder.startedAt;
                t.recognizer = new Recognizer(LANG, {
                    onSession: () => heard.onSession(),
                    onTranscript: (text) => {
                        heard.update(text, now());
                        show(text);
                    },
                    onState: (state, detail) => setStatus((st) => ({ ...st, recognition: detail ?? state })),
                });
                t.recognizer.start();
            } else {
                /* A dry run reads the script from this chapter on, and moves
                   the chapters on as the read reaches them. */
                t.t0 = performance.now();
                const lines = SCRIPT.slice(chapterRange(FILM.chapters[chapter]).from);
                const follow = new Follower(FPS, 15, lines);
                const ear: Ear = {
                    onSession: (at) => {
                        follow.onSession(at);
                        heard.onSession();
                    },
                    onTranscript: (text, final, at) => {
                        follow.onTranscript(text, final, at);
                        heard.update(text, at);
                        const pos = follow.position();
                        const c = chapterOf(indexOf(lines[Math.min(pos.line, lines.length - 1)].id));
                        if (c > t.marks[t.marks.length - 1].chapter) {
                            t.marks.push({ chapter: c, at });
                            setTalkChapter(c);
                        }
                    },
                    onVoice: (speaking, at, at2) => follow.onVoice(speaking, at, at2),
                };
                t.stopSim = runSimulation(ear, t.t0, SIMULATE ?? 155, lines, (text) => {
                    setStatus((st) => ({ ...st, recognition: "simulated" }));
                    show(text);
                });
            }
        } catch (err) {
            starting.current = false;
            setError(String(err));
            return;
        }
        starting.current = false;
        talk.current = t;
        setTalkChapter(chapter);
        setPhase("recording");
        const tick = () => {
            if (talk.current !== t) return;
            setElapsed(now() / FPS);
            t.raf = requestAnimationFrame(tick);
        };
        t.raf = requestAnimationFrame(tick);
    }, [phase, stream, chapter]);

    const nextTalkChapter = useCallback(() => {
        const t = talk.current;
        if (!t) return;
        const last = t.marks[t.marks.length - 1].chapter;
        if (last >= FILM.chapters.length - 1) return;
        t.marks.push({ chapter: last + 1, at: ((performance.now() - t.t0) * FPS) / 1000 });
        setTalkChapter(last + 1);
    }, []);

    const stopTalk = useCallback(async () => {
        const t = talk.current;
        if (!t || t.stopping) return;
        t.stopping = true;
        cancelAnimationFrame(t.raf);
        t.recognizer?.stop();
        t.stopSim?.();
        setPhase("saving");
        try {
            await t.recorder?.stop();
            const words = t.heard.words();
            const markdown = talkMarkdown(words, t.marks);
            const res = await post(
                `/api/loose/${t.id}/save`,
                JSON.stringify({
                    id: t.id,
                    film: FILM.id,
                    recordedAt: new Date().toISOString(),
                    simulated: SIMULATE !== null,
                    durationFrames: Math.round(((performance.now() - t.t0) * FPS) / 1000),
                    container: t.recorder?.extension ?? null,
                    marks: t.marks.map((m) => ({ ...m, title: FILM.chapters[m.chapter].title })),
                    words,
                    markdown,
                }),
            );
            const out = (await res.json()) as { path: string };
            setTranscript({ title: words.length ? "Talk-through saved" : "Talk-through saved — but nothing was heard", markdown, path: out.path });
        } catch (err) {
            setError(`Saving the talk-through failed: ${String(err)}. What was recorded is in takes/loose/${t.id}/.`);
        }
        talk.current = null;
        setTalkChapter(null);
        setPhase("ready");
    }, []);

    const showLastTalk = useCallback(async () => {
        const list = (await fetch(`/api/loose?film=${FILM.id}`).then((r) => r.json())) as { id: string; markdown: string }[];
        const usable = list.filter((l) => !!(l as { simulated?: boolean }).simulated === (SIMULATE !== null));
        if (!usable.length) setNotice("No talk-through for this film yet.");
        else setTranscript({ title: `Talk-through ${usable[0].id.replace("loose-", "")}`, markdown: usable[0].markdown, path: `takes/loose/${usable[0].id}/transcript.md` });
    }, []);

    /* ── playing back ────────────────────────────────────────────────── */

    /** A review asked for before the assembly it needs exists (right after a
     *  take is saved): started once the takes have been reloaded. */
    const [pendingReview, setPendingReview] = useState<{ cut: string; line: string; to: string; trial?: Record<string, string> } | null>(null);

    const playLines = useCallback(
        (cutId: string, firstId: string, lastId: string | null, trial: Record<string, string> | null = null) => {
            const cut = FILM.cuts.find((c) => c.id === cutId);
            if (!cut || !cut.assembles) return;
            const a = assemble(cut.script, takes, trial ? { picks: { ...edit.picks, ...trial } } : edit);
            const k = cut.script.findIndex((l) => l.id === firstId);
            const j = lastId === null ? -1 : cut.script.findIndex((l) => l.id === lastId);
            const from = k < 0 ? 0 : Math.max(0, (a.timing.lines[k]?.words[0] ?? 0) - REVIEW_LEAD);
            const until = j < 0 ? null : (a.timing.lines[j]?.end ?? a.frames) + 20;
            setReview({ cut: cutId, from, until, trial, playing: true });
        },
        [takes, edit],
    );

    useEffect(() => {
        if (!pendingReview) return;
        setPendingReview(null);
        playLines(pendingReview.cut, pendingReview.line, pendingReview.to, pendingReview.trial ?? null);
    }, [pendingReview, playLines]);

    /* Start the player when a review asks to play (after any remount). */
    useEffect(() => {
        if (phase !== "ready" || !review.playing) return;
        const id = requestAnimationFrame(() => {
            const p = player.current;
            if (!p) return;
            p.seekTo(review.from);
            p.unmute();
            p.play();
        });
        return () => cancelAnimationFrame(id);
    }, [review.playing, review.from, review.cut, phase]);

    /* Follow the player: the prompter shows the line being played, and a
       chapter's review stops at its end. */
    useEffect(() => {
        const p = player.current;
        if (!p || phase === "recording") return;
        const onFrame = (e: { detail: { frame: number } }) => {
            setReviewFrame(e.detail.frame);
            if (review.playing && review.until !== null && e.detail.frame >= review.until) {
                p.pause();
                setReview((r) => ({ ...r, playing: false }));
            }
        };
        const onPause = () => setReview((r) => (r.playing ? { ...r, playing: false } : r));
        p.addEventListener("frameupdate", onFrame);
        p.addEventListener("pause", onPause);
        return () => {
            p.removeEventListener("frameupdate", onFrame);
            p.removeEventListener("pause", onPause);
        };
    }, [review.playing, review.until, phase, review.cut]);

    const stopReview = useCallback(() => {
        player.current?.pause();
        setReview((r) => ({ ...r, playing: false, trial: null }));
    }, []);

    /** Play the selected chapter in the cut being watched (or the first cut
     *  that has it). */
    const playChapter = useCallback(
        (c: number, trial: Record<string, string> | null = null) => {
            const ch = FILM.chapters[c];
            const ids = ch.lines;
            const cut = viewCut.script.some((l) => ids.includes(l.id)) ? viewCut : cutFor(FILM, ids);
            const inCut = ids.filter((id) => cut.script.some((l) => l.id === id));
            if (!inCut.length) return;
            playLines(cut.id, inCut[0], inCut[inCut.length - 1], trial);
        },
        [viewCut, playLines],
    );

    const playCut = useCallback(() => {
        setReview((r) => ({ ...r, from: 0, until: null, trial: null, playing: true }));
    }, []);

    /* ── choosing takes ──────────────────────────────────────────────── */

    const useTake = useCallback(
        async (take: TakeInfo, c: number) => {
            const picks = { ...edit.picks };
            for (const id of FILM.chapters[c].lines) if (serves(take, SCRIPT[indexOf(id)])) picks[id] = take.id;
            await saveEdit({ picks });
            setReview((r) => ({ ...r, trial: null }));
        },
        [edit, saveEdit],
    );

    const discardTake = useCallback(
        async (take: TakeInfo) => {
            if (!window.confirm(`Throw away take #${number.get(take.id)}? It moves to takes/.discarded/.`)) return;
            await post(`/api/takes/${take.id}/discard`, "");
            const picks = Object.fromEntries(Object.entries(edit.picks).filter(([, t]) => t !== take.id));
            await saveEdit({ picks });
            await refresh();
        },
        [edit, number, refresh, saveEdit],
    );

    /* ── rendering ───────────────────────────────────────────────────── */

    const startRender = useCallback(
        async (cut: Cut) => {
            const a = assemble(cut.script, takes, edit);
            if (a.missing.length && !window.confirm(`${a.missing.length} line(s) of the ${cut.label} are not recorded yet: ${a.missing.join(", ")}. Render anyway, with the placeholder for them?`)) return;
            const res = await post(`/api/render/${FILM.id}/${cut.id}`, JSON.stringify({ compositions: cut.compositions, props: { timing: a.timing, clips: a.clips, take: null } }));
            const out = (await res.json()) as { command: string };
            setRender((r) => ({ ...r, [cut.id]: { state: "rendering", progress: 0, command: out.command } }));
        },
        [takes, edit],
    );

    useEffect(() => {
        const active = Object.entries(render).filter(([, j]) => j.state === "rendering");
        if (!active.length) return;
        const id = window.setInterval(async () => {
            for (const [cut] of active) {
                const job = (await fetch(`/api/render/${FILM.id}/${cut}`).then((r) => r.json())) as { state: string; progress?: number; files?: string[] };
                setRender((r) => ({ ...r, [cut]: { ...r[cut], ...job } }));
            }
        }, 1000);
        return () => window.clearInterval(id);
    }, [render]);

    /* ── a microphone test ───────────────────────────────────────────── */

    /* A few seconds from the chosen microphone, what the recogniser made of
       them (it hears the SYSTEM input, which may not be the same mic), and
       the recording played back. M starts it; M again stops early. */
    const testMic = useCallback(() => {
        const t = testing.current;
        if (t) {
            if (t.recorder.state === "recording") t.recorder.stop();
            else t.stopPlayback?.();
            return;
        }
        if (!stream || session.current || starting.current || phase !== "ready") return;
        const recorder = new MediaRecorder(new MediaStream(stream.getAudioTracks()));
        const chunks: Blob[] = [];
        const recognizer = new Recognizer(LANG, {
            onSession: () => undefined,
            onTranscript: (text) => setMicTest((m) => m && { ...m, heard: text }),
            onState: (state, detail) => {
                if (state !== "stopped") setMicTest((m) => m && { ...m, recognition: detail ?? state });
            },
        });
        recorder.ondataavailable = (e) => chunks.push(e.data);
        recorder.onstop = () => {
            const current = testing.current;
            if (!current) return;
            window.clearTimeout(current.timer);
            recognizer.stop();
            const url = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType }));
            const audio = new Audio(url);
            const done = () => {
                audio.pause();
                URL.revokeObjectURL(url);
                testing.current = null;
                /* Played back: the box has said what it needed to — gone,
                   unless recognition heard nothing, which is worth reading. */
                setMicTest((m) => (m && !m.heard ? { ...m, state: "done" } : null));
            };
            audio.onended = done;
            current.stopPlayback = done;
            setMicTest((m) => m && { ...m, state: "playing" });
            void audio.play();
        };
        testing.current = { recorder, timer: window.setTimeout(() => recorder.stop(), 15000), stopPlayback: null };
        setMicTest({ state: "listening", heard: "", recognition: "starting" });
        recorder.start();
        recognizer.start();
    }, [stream, phase]);

    /* ── keys ────────────────────────────────────────────────────────── */

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLSelectElement || (e.target instanceof HTMLInputElement && e.target.type !== "checkbox")) return;
            /* The sync check has the screen: no take starts under it. */
            if (syncingRef.current) return;
            const s = session.current;
            if (talk.current) {
                if (e.code === "Escape" || e.code === "Space") {
                    e.preventDefault();
                    void stopTalk();
                } else if (e.code === "ArrowRight" || e.code === "PageDown") {
                    e.preventDefault();
                    nextTalkChapter();
                }
                return;
            }
            if (e.code === "Space" && !s) {
                /* Space always starts — never ticks the box or presses the
                   button that was clicked last. */
                e.preventDefault();
                if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
                void (mode === "talk" ? startTalk() : start());
            } else if (e.code === "Escape" && s) {
                e.preventDefault();
                void stop();
            } else if (e.code === "Escape" && starting.current) {
                callOff.current = true;
            } else if (e.code === "Escape") {
                stopReview();
            } else if ((e.code === "ArrowRight" || e.code === "PageDown") && s) {
                /* A presenter's clicker sends PageDown. */
                e.preventDefault();
                s.follower.advanceLine(((performance.now() - s.t0) * FPS) / 1000);
            } else if (e.code === "KeyR" && s && !s.stopping) {
                e.preventDefault();
                void stop(true);
            } else if (e.code === "KeyM" && !s) {
                e.preventDefault();
                testMic();
            } else if ((e.code === "ArrowDown" || e.code === "KeyJ") && !s) {
                e.preventDefault();
                setChapter((c) => Math.min(FILM.chapters.length - 1, c + 1));
                setStartLine(null);
            } else if ((e.code === "ArrowUp" || e.code === "KeyK") && !s) {
                e.preventDefault();
                setChapter((c) => Math.max(0, c - 1));
                setStartLine(null);
            } else if (e.code === "KeyN" && !s) {
                /* The next chapter with a line nobody has recorded. */
                e.preventDefault();
                const todo = (from: number) =>
                    FILM.chapters.findIndex((c, i) => i > from && c.lines.some((id) => !takes.some((t) => serves(t, SCRIPT[indexOf(id)]))));
                const next = todo(chapter) >= 0 ? todo(chapter) : todo(-1);
                if (next >= 0) {
                    setChapter(next);
                    setStartLine(null);
                } else setNotice("Every line is recorded. Play the cut (⇧P), or render it.");
            } else if (e.code === "KeyP" && !s) {
                e.preventDefault();
                if (review.playing) stopReview();
                else if (e.shiftKey) playCut();
                else playChapter(chapter);
            } else if (e.code === "Tab" && !s && FILM.cuts.length > 1) {
                e.preventDefault();
                const i = FILM.cuts.findIndex((c) => c.id === review.cut);
                setReview((r) => ({ ...r, cut: FILM.cuts[(i + 1) % FILM.cuts.length].id, playing: false, trial: null }));
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [start, stop, testMic, stopReview, playChapter, playCut, chapter, review.playing, review.cut, takes, mode, startTalk, stopTalk, nextTalkChapter]);

    /* ── the page ────────────────────────────────────────────────────── */

    const recording = phase === "recording" || phase === "saving";
    const talking = talkChapter !== null;
    const playerCut = talking ? FILM.cuts[0] : recording && session.current ? session.current.cut : viewCut;
    const inputProps = useMemo<FilmProps>(() => {
        /* Talking it through: the film at its authored read, held on the
           chapter being talked about, the camera in it. */
        if (talking) return { timing: null, live: { stream } };
        if (recording) return { timing: liveTiming, live: { stream } };
        /* Between takes the window shows you, live, to frame the shot;
           only a playback shows the recorded takes. */
        const live = review.playing ? null : { stream };
        if (assembled) return { timing: assembled.timing, clips: assembled.clips, live };
        return { timing: null, live };
    }, [recording, liveTiming, stream, assembled, talking, review.playing]);

    useEffect(() => {
        if (talkChapter === null) return;
        const cut = FILM.cuts[0];
        const first = FILM.chapters[talkChapter].lines.find((id) => cut.script.some((l) => l.id === id));
        const k = first ? cut.script.findIndex((l) => l.id === first) : -1;
        const at = k < 0 ? 12 : Math.max(12, (authoredTiming(cut.script).lines[k]?.words[0] ?? 0) + 20);
        const id = requestAnimationFrame(() => player.current?.seekTo(at));
        return () => cancelAnimationFrame(id);
    }, [talkChapter]);
    const duration = recording ? LIVE_HORIZON : assembled ? Math.max(1, assembled.frames) : LIVE_HORIZON;

    /* Before a take, the film sits where the take will start, so the
       framing can be judged against what it will play over. */
    useEffect(() => {
        if (phase !== "ready" || review.playing) return;
        const id = requestAnimationFrame(() => {
            if (viewCut.id !== recordCut.id) return;
            const first = rangeScript[0].id;
            const k = viewCut.script.findIndex((l) => l.id === first);
            const at = assembled && k >= 0 ? Math.max(0, (assembled.timing.lines[k]?.words[0] ?? 0) - REVIEW_LEAD) : offsetIn(viewCut, first);
            player.current?.seekTo(Math.max(12, at));
        });
        return () => cancelAnimationFrame(id);
    }, [phase, review.playing, rangeScript, viewCut, recordCut, assembled, offsetIn]);

    /* The prompter: the lines being recorded, or, while playing back, the
       line the film is on. */
    const reviewLine = useMemo(() => {
        if (!assembled || !review.playing) return null;
        let k = -1;
        assembled.timing.lines.forEach((l, i) => {
            if (l && l.words[0] - 6 <= reviewFrame) k = i;
        });
        return k < 0 ? null : viewCut.script[k].id;
    }, [assembled, review.playing, reviewFrame, viewCut]);

    const aspect = `${playerCut.width} / ${playerCut.height}`;

    return (
        <div style={page}>
            {mode === "talk" && !review.playing ? (
                <TalkPrompter current={talkChapter ?? chapter} active={talking} />
            ) : (
                <Prompter
                    lines={reviewLine ? [SCRIPT[indexOf(reviewLine)]] : rangeScript}
                    position={position}
                    active={phase === "recording"}
                    label={
                        reviewLine
                            ? "playing back"
                            : `${mode === "rehearse" ? "rehearsal · say it your way · " : ""}${FILM.chapters[chapter].title}${range.from !== chapterRange(FILM.chapters[chapter]).from || through ? " · from line " + (range.from + 1) + (through ? " to " + (range.to + 1) : "") : ""}`
                    }
                />
            )}

            <div style={{ minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) 400px", gap: 16, padding: "0 24px" }}>
                <div style={{ minHeight: 0, display: "flex", justifyContent: "center", alignItems: "center" }}>
                    <div style={{ height: "100%", aspectRatio: aspect, maxWidth: "100%", maxHeight: "100%", borderRadius: 13, overflow: "hidden", border: `1px solid ${recording ? "rgba(255,90,95,0.6)" : "rgba(255,255,255,0.08)"}`, position: "relative" }}>
                        <Player
                            key={`${playerCut.id}-${talking ? "talk" : recording ? "rec" : "view"}`}
                            ref={player}
                            component={playerCut.component}
                            inputProps={inputProps}
                            durationInFrames={duration}
                            fps={FPS}
                            compositionWidth={playerCut.width}
                            compositionHeight={playerCut.height}
                            style={{ width: "100%", height: "100%", display: "block" }}
                            controls={!recording}
                            clickToPlay={false}
                            doubleClickToFullscreen={false}
                            spaceKeyToPlayOrPause={false}
                            /* Silent while recording: anything the film
                               played would reach the microphone. */
                            initiallyMuted
                            acknowledgeRemotionLicense
                        />
                    </div>
                </div>

                <Sidebar
                    chapter={chapter}
                    setChapter={(c) => {
                        setChapter(c);
                        setStartLine(null);
                    }}
                    startLine={startLine}
                    setStartLine={setStartLine}
                    range={range}
                    takes={takes}
                    edit={edit}
                    number={number}
                    cutStates={cutStates}
                    viewCut={viewCut}
                    setViewCut={(id) => setReview((r) => ({ ...r, cut: id, playing: false, trial: null }))}
                    trial={review.trial}
                    disabled={recording}
                    onPlayChapter={(c) => playChapter(c)}
                    onAudition={(take, c) => {
                        const trial: Record<string, string> = {};
                        for (const id of FILM.chapters[c].lines) if (serves(take, SCRIPT[indexOf(id)])) trial[id] = take.id;
                        playChapter(c, trial);
                    }}
                    onUse={useTake}
                    onDiscard={discardTake}
                    render={render}
                    onRender={startRender}
                />
            </div>

            <div style={bar}>
                <span style={{ color: recording ? "#FF5A5F" : "rgba(255,255,255,0.45)", fontWeight: 600, minWidth: 120 }}>
                    {phase === "recording"
                        ? `${talking ? "● TALKING" : session.current?.rehearse ? "● REHEARSING" : "● REC"} ${clock(elapsed)}`
                        : phase === "saving"
                          ? "saving…"
                          : review.playing
                            ? "▶ playing back"
                            : SIMULATE
                              ? `dry run, ${SIMULATE} wpm`
                              : phase === "error"
                                ? "camera not open"
                                : phase === "setup"
                                  ? camera === PHONE
                                      ? "waiting for the phone…"
                                      : "opening the camera…"
                                  : "ready"}
                </span>
                <span>
                    {talking
                        ? `chapter ${(talkChapter ?? 0) + 1}/${FILM.chapters.length}`
                        : phase === "recording"
                          ? `line ${Math.min(position.line + 1, rangeScript.length)}/${rangeScript.length}`
                          : `lines ${range.from + 1}–${range.to + 1} of ${SCRIPT.length}`}
                </span>
                <Meter level={status.level} threshold={status.threshold} speaking={status.speaking} />
                {!SIMULATE && (
                    <span title="The camera the page has open — change it with Camera below" style={{ color: stalled ? "#FF5A5F" : stream?.getVideoTracks()[0] ? "rgba(255,255,255,0.6)" : "#FFC600", maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {stalled
                            ? "camera frozen — no new frames"
                            : stream?.getVideoTracks()[0]
                              ? cameraLabel(stream.getVideoTracks()[0])
                              : camera === PHONE
                                ? "waiting for the phone"
                                : "no camera open"}
                    </span>
                )}
                {phoneLink && phone && phoneTrack && <PhoneBadge link={phoneLink} state={phone} onSync={recording ? null : () => setSyncing(true)} />}
                <span style={{ color: "rgba(255,255,255,0.45)" }}>{canRecognize() || SIMULATE ? status.recognition : "no speech recognition — use Chrome"}</span>
                <span style={{ flex: 1, fontFamily: "JetBrains Mono, monospace", fontSize: 13, color: "rgba(255,255,255,0.4)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "right" }}>
                    {status.transcript}
                </span>
            </div>

            <div style={{ ...bar, paddingTop: 0, color: "rgba(255,255,255,0.45)", flexWrap: "wrap", rowGap: 8 }}>
                {phase === "ready" ? (
                    <>
                        <span style={{ display: "flex", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 7, overflow: "hidden" }}>
                            {(
                                [
                                    ["record", "Record", "Takes for the film"],
                                    ["rehearse", "Rehearse", "Read the script your way; nothing is recorded, and afterwards you see every line you said differently"],
                                    ["talk", "Talk it through", "Unscripted: the chapter titles as prompts, a transcript of what you say"],
                                ] as const
                            ).map(([m, label, hint]) => (
                                <button key={m} title={hint} onClick={() => setMode(m)} style={{ ...segment, ...(mode === m ? segmentOn : null) }}>
                                    {label}
                                </button>
                            ))}
                        </span>
                        <button style={button} onClick={() => void (mode === "talk" ? startTalk() : start())}>
                            {mode === "talk" ? "Start talking — Space" : mode === "rehearse" ? "Rehearse — Space" : "Record — Space"}
                        </button>
                        {mode === "talk" && (
                            <button style={ghost} onClick={() => void showLastTalk()}>
                                Last talk-through
                            </button>
                        )}
                        {mode !== "talk" && (
                            <>
                                <button style={ghost} onClick={() => (review.playing ? stopReview() : playChapter(chapter))}>
                                    {review.playing ? "Stop — P" : "Play chapter — P"}
                                </button>
                                <button style={ghost} onClick={playCut}>
                                    Play cut — ⇧P
                                </button>
                            </>
                        )}
                        {!SIMULATE && (
                            <button style={ghost} onClick={testMic}>
                                {micTest?.state === "listening" ? "Stop test — M" : micTest?.state === "playing" ? "Stop playback — M" : "Test mic — M"}
                            </button>
                        )}
                        {mode !== "talk" && (
                        <label style={check}>
                            <input
                                type="checkbox"
                                checked={through}
                                onChange={(e) => {
                                    setThrough(e.target.checked);
                                    remember("live.through", e.target.checked ? "1" : "0");
                                }}
                            />
                            keep going into the next chapters
                        </label>
                        )}
                        {mode === "record" && (
                        <label style={check}>
                            <input
                                type="checkbox"
                                checked={playback}
                                onChange={(e) => {
                                    setPlayback(e.target.checked);
                                    remember("live.playback", e.target.checked ? "1" : "0");
                                }}
                            />
                            play back after each take
                        </label>
                        )}
                        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            Film
                            <select
                                value={FILM.id}
                                style={select}
                                onChange={(e) => {
                                    const next = new URLSearchParams(location.search);
                                    next.set("film", e.target.value);
                                    location.search = next.toString();
                                }}
                            >
                                {FILMS.map((f) => (
                                    <option key={f.id} value={f.id}>
                                        {f.title}
                                    </option>
                                ))}
                            </select>
                        </label>
                        {!SIMULATE && (
                            <>
                                <Select label="Camera" value={camera} options={[...cameras, PHONE_OPTION]} onChange={(v) => { setCamera(v || undefined); remember("live.camera", v); }} />
                                <Select label="Microphone" value={mic} options={mics} onChange={(v) => { setMic(v || undefined); remember("live.mic", v); }} />
                            </>
                        )}
                        <span>{mode === "talk" ? "↑↓ chapter to start from · → moves on while talking" : "↑↓ chapter · N next to record · click a line to start there · Tab cut · Esc stop"}</span>
                    </>
                ) : phase === "error" && !SIMULATE ? (
                    <>
                        <button
                            style={button}
                            onClick={() => {
                                setError(null);
                                setRetry((n) => n + 1);
                            }}
                        >
                            Try again
                        </button>
                        <Select label="Camera" value={camera} options={[...cameras, PHONE_OPTION]} onChange={(v) => { setError(null); setCamera(v || undefined); remember("live.camera", v); }} />
                        <Select label="Microphone" value={mic} options={mics} onChange={(v) => { setError(null); setMic(v || undefined); remember("live.mic", v); }} />
                        <span>
                            Or try it without a camera: <a href={`?film=${FILM.id}&simulate`} style={{ color: "#36CCD6" }}>dry run</a>
                        </span>
                    </>
                ) : phase === "recording" && talking ? (
                    <span>Talk about the chapter in your own words, as if to a colleague. → or a clicker: next chapter · Space or Esc: stop and save the transcript</span>
                ) : phase === "recording" && session.current?.rehearse ? (
                    <span>Say each line the way you would say it — change words freely. If the prompter stops following, → moves to the next line · Esc: stop and compare</span>
                ) : phase === "recording" ? (
                    <span>Read at your own pace. → or a clicker: next line · Esc: stop and keep · R: throw this take away</span>
                ) : null}
            </div>

            {countdown !== null && (
                <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                    <div style={{ fontSize: 220, fontWeight: 700, lineHeight: 1, color: "#FFFFFF", textShadow: "0 4px 40px rgba(0,0,0,0.8)" }}>{countdown}</div>
                    <div style={{ marginTop: 12, fontSize: 18, color: "rgba(255,255,255,0.7)", textShadow: "0 2px 12px rgba(0,0,0,0.9)" }}>recording starts after 1 · Esc calls it off</div>
                </div>
            )}
            {micTest && !recording && (
                <div style={{ ...panel, cursor: "pointer" }} title="Click to close" onClick={() => (testing.current ? undefined : setMicTest(null))}>
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>
                        {micTest.state === "listening"
                            ? "Mic test: say a line of the script, then press M (it stops by itself after 15 s)"
                            : micTest.state === "playing"
                              ? "Mic test: playing back what was recorded"
                              : "Mic test: done. M runs it again."}
                    </div>
                    <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, color: "rgba(255,255,255,0.7)" }}>
                        Speech recognition heard: {micTest.heard || (micTest.state === "listening" ? `… (${micTest.recognition})` : "nothing. Make this microphone the system input in System Settings → Sound.")}
                    </div>
                </div>
            )}
            {error && (
                <div style={{ ...panel, border: "1px solid rgba(255,90,95,0.5)", color: "#FFB4B6" }} onClick={() => setError(null)}>
                    {error}
                </div>
            )}
            {notice && !error && <Toast text={notice} onDone={() => setNotice(null)} />}
            {syncing && phoneLink && phoneTrack && (
                <SyncCheck
                    link={phoneLink}
                    track={phoneTrack}
                    onDone={(result) => {
                        setSyncing(false);
                        if (!result) return;
                        setNotice(
                            result.ok
                                ? `Synced: the phone's picture arrives ${result.totalMs} ms after the sound (${result.cameraMs} ms of it in the camera). Every take is lined up by it.`
                                : result.reason,
                        );
                    }}
                />
            )}
            {!SIMULATE && camera === PHONE && !phoneTrack && !recording && (
                <PhonePairing
                    state={phone}
                    onCancel={() => {
                        setCamera(undefined);
                        remember("live.camera", "");
                    }}
                />
            )}
            {rehearsal && !recording && <RehearsalPanel rows={rehearsal.rows} onClose={() => setRehearsal(null)} />}
            {transcript && !recording && (
                <div style={{ ...sheet }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                        <span style={{ fontWeight: 600, flex: 1 }}>{transcript.title}</span>
                        {transcript.path && <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "rgba(255,255,255,0.5)", userSelect: "all" }}>{transcript.path}</span>}
                        <button style={mini} onClick={() => void navigator.clipboard?.writeText(transcript.markdown)}>
                            Copy
                        </button>
                        <button style={mini} onClick={() => setTranscript(null)}>
                            Close
                        </button>
                    </div>
                    <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "Inter, sans-serif", fontSize: 15, lineHeight: 1.55, color: "rgba(255,255,255,0.85)" }}>{transcript.markdown}</pre>
                </div>
            )}
            {info && !error && (
                <div style={{ ...panel, maxHeight: "60vh", overflow: "auto" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, marginBottom: 8 }}>
                        Take saved
                        <button style={mini} onClick={() => setInfo(null)}>
                            Close
                        </button>
                    </div>
                    <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "JetBrains Mono, monospace", fontSize: 13, color: "rgba(255,255,255,0.75)", userSelect: "all" }}>{info}</pre>
                </div>
            )}
        </div>
    );

    /** The film's timing while a take is recorded: what comes before the
     *  take at the authored read (played out by the time it starts), the
     *  take's lines as they are being said, nothing after. */
    function previewTiming(s: Session): Timing {
        const authored = authoredTiming(s.cut.script);
        const said = s.lastTiming;
        const first = s.cut.script.findIndex((l) => l.id === s.follower.script[0].id);
        return {
            live: true,
            lines: s.cut.script.map((l, k) => {
                if (k < first) return authored.lines[k];
                const j = s.follower.script.findIndex((x) => x.id === l.id);
                return j < 0 ? null : shift(said.lines[j], s.offset);
            }),
        };
    }
};

/* ── the sidebar ─────────────────────────────────────────────────────── */

const Sidebar: React.FC<{
    chapter: number;
    setChapter: (c: number) => void;
    startLine: number | null;
    setStartLine: (l: number | null) => void;
    range: Range;
    takes: TakeInfo[];
    edit: Edit;
    number: Map<string, number>;
    cutStates: { cut: Cut; a: ReturnType<typeof assemble> | null }[];
    viewCut: Cut;
    setViewCut: (id: string) => void;
    trial: Record<string, string> | null;
    disabled: boolean;
    onPlayChapter: (c: number) => void;
    onAudition: (take: TakeInfo, c: number) => void;
    onUse: (take: TakeInfo, c: number) => void;
    onDiscard: (take: TakeInfo) => void;
    render: Record<string, { state: string; progress?: number; files?: string[]; command?: string }>;
    onRender: (cut: Cut) => void;
}> = (p) => {
    const current = p.cutStates.find((c) => c.cut.id === p.viewCut.id);
    const selected = useRef<HTMLDivElement>(null);
    /* A block body: scrollIntoView returns a promise in current Chrome, and
       an effect that returns one breaks React's clean-up. */
    useEffect(() => {
        void selected.current?.scrollIntoView({ block: "nearest" });
    }, [p.chapter]);
    /** Which take serves a line in the cut being watched (or any cut). */
    const source = (id: string): string | null => {
        for (const { cut, a } of [current, ...p.cutStates].filter(Boolean) as typeof p.cutStates) {
            const k = cut.script.findIndex((l) => l.id === id);
            if (k >= 0 && a) return a.sources[k];
        }
        return null;
    };
    return (
        <div style={{ minHeight: 0, display: "flex", flexDirection: "column", gap: 10, opacity: p.disabled ? 0.5 : 1, pointerEvents: p.disabled ? "none" : "auto" }}>
            {/* the cuts */}
            <div style={{ display: "flex", gap: 6 }}>
                {p.cutStates.map(({ cut, a }) => {
                    const on = cut.id === p.viewCut.id;
                    const done = a ? cut.script.length - a.missing.length : null;
                    return (
                        <button key={cut.id} onClick={() => p.setViewCut(cut.id)} style={{ ...tab, ...(on ? tabOn : null) }}>
                            <div style={{ fontWeight: 600 }}>{cut.label}</div>
                            <div style={{ fontSize: 12, color: on ? "rgba(9,10,12,0.65)" : "rgba(255,255,255,0.45)" }}>
                                {a ? `${done}/${cut.script.length} lines · ${clock(a.frames / FPS)}` : "one take"}
                            </div>
                        </button>
                    );
                })}
            </div>

            {/* the chapters */}
            <div style={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column", gap: 4, paddingRight: 4 }}>
                {FILM.chapters.map((ch, c) => {
                    const lineIdx = ch.lines.map(indexOf);
                    const served = ch.lines.filter((id) => p.takes.some((t) => serves(t, SCRIPT[indexOf(id)]))).length;
                    const covering = p.takes.filter((t) => t.lines.some((l) => ch.lines.includes(l.id))).reverse();
                    const on = c === p.chapter;
                    const inCuts = FILM.cuts.length > 1 ? FILM.cuts.filter((cut) => ch.lines.some((id) => cut.script.some((l) => l.id === id))).map((cut) => cut.id[0].toUpperCase()) : [];
                    const dot = served === ch.lines.length ? "#34D399" : served > 0 ? "#FFC600" : "rgba(255,255,255,0.25)";
                    return (
                        <div key={ch.id} ref={on ? selected : undefined} style={{ ...card, ...(on ? cardOn : null) }}>
                            <div onClick={() => p.setChapter(c)} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                                <span style={{ width: 8, height: 8, borderRadius: 4, background: dot, flex: "none" }} />
                                <span style={{ color: "rgba(255,255,255,0.4)", fontFamily: "JetBrains Mono, monospace", fontSize: 12 }}>{String(c + 1).padStart(2, "0")}</span>
                                <span style={{ fontWeight: 600, flex: 1 }}>{ch.title}</span>
                                {inCuts.map((x) => (
                                    <span key={x} style={badge}>
                                        {x}
                                    </span>
                                ))}
                                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>{covering.length ? `${covering.length} take${covering.length > 1 ? "s" : ""}` : "—"}</span>
                            </div>
                            {on && (
                                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                                    {/* its lines: click one to start the take there */}
                                    {ch.lines.map((id, i) => {
                                        const k = lineIdx[i];
                                        const src = source(id);
                                        const inRange = k >= p.range.from && k <= p.range.to;
                                        const stale = !src && p.takes.some((t) => t.lines.some((l) => l.id === id));
                                        return (
                                            <div
                                                key={id}
                                                onClick={() => p.setStartLine(p.startLine === k ? null : k)}
                                                title="Start the take at this line (click again for the whole chapter)"
                                                style={{ display: "flex", gap: 8, fontSize: 13, cursor: "pointer", color: inRange ? "#FFFFFF" : "rgba(255,255,255,0.35)" }}
                                            >
                                                <span style={{ flex: "none", width: 34, fontFamily: "JetBrains Mono, monospace", fontSize: 11, paddingTop: 2, color: src ? "#34D399" : stale ? "#FFC600" : "rgba(255,255,255,0.3)" }}>
                                                    {src ? `#${p.number.get(src)}` : stale ? "old" : "—"}
                                                </span>
                                                <span style={{ lineHeight: 1.35 }}>{SCRIPT[k].words.join(" ")}</span>
                                            </div>
                                        );
                                    })}
                                    {/* its takes */}
                                    {covering.length > 0 && <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "2px 0" }} />}
                                    {covering.map((t) => {
                                        const mine = t.lines.filter((l) => ch.lines.includes(l.id));
                                        const usable = mine.filter((l) => serves(t, SCRIPT[indexOf(l.id)]));
                                        const inUse = usable.length > 0 && usable.every((l) => source(l.id) === t.id);
                                        const trying = p.trial && usable.some((l) => p.trial?.[l.id] === t.id);
                                        const secs = mine.length ? (mine[mine.length - 1].end - mine[0].at[0]) / FPS : 0;
                                        const words = mine.reduce((n, l) => n + l.words.length, 0);
                                        const when = new Date(t.recordedAt);
                                        return (
                                            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                                                <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, width: 34, color: inUse ? "#34D399" : "rgba(255,255,255,0.6)" }}>#{p.number.get(t.id)}</span>
                                                <span style={{ flex: 1, color: "rgba(255,255,255,0.6)" }}>
                                                    {when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {clock(secs)} · {secs > 0 ? Math.round((words / secs) * 60) : 0} wpm
                                                    {usable.length < mine.length && <span style={{ color: "#FFC600" }}> · {mine.length - usable.length} line(s) out of date</span>}
                                                    {t.simulated && <span style={{ color: "rgba(255,255,255,0.35)" }}> · sim</span>}
                                                </span>
                                                {usable.length > 0 && (
                                                    <button style={mini} onClick={() => p.onAudition(t, c)} title="Play the chapter with this take">
                                                        {trying ? "▶…" : "▶"}
                                                    </button>
                                                )}
                                                {usable.length > 0 &&
                                                    (inUse ? (
                                                        <span style={{ ...mini, color: "#34D399", border: "1px solid rgba(52,211,153,0.4)" }}>in use</span>
                                                    ) : (
                                                        <button style={mini} onClick={() => p.onUse(t, c)}>
                                                            Use
                                                        </button>
                                                    ))}
                                                <button style={mini} onClick={() => p.onDiscard(t)} title="Throw this take away">
                                                    ✕
                                                </button>
                                            </div>
                                        );
                                    })}
                                    {covering.length > 0 && (
                                        <button style={{ ...mini, alignSelf: "flex-start" }} onClick={() => p.onPlayChapter(c)}>
                                            ▶ Play this chapter
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* rendering */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {p.cutStates
                    .filter(({ cut }) => cut.assembles)
                    .map(({ cut, a }) => {
                        const job = p.render[cut.id];
                        return (
                            <div key={cut.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                                <button style={ghost} disabled={job?.state === "rendering"} onClick={() => p.onRender(cut)}>
                                    {job?.state === "rendering" ? `Rendering ${Math.round((job.progress ?? 0) * 100)}%` : `Render ${cut.label.split(" ·")[0].toLowerCase()}`}
                                </button>
                                {job?.state === "done" &&
                                    job.files?.map((f) => (
                                        <a key={f} href={`/out/${f}`} target="_blank" rel="noreferrer" style={{ color: "#36CCD6" }}>
                                            {f}
                                        </a>
                                    ))}
                                {job?.state === "error" && <span style={{ color: "#FF5A5F" }}>render failed — see the server's log</span>}
                                {!job && a && a.missing.length > 0 && <span style={{ color: "rgba(255,255,255,0.4)" }}>{a.missing.length} line(s) to record</span>}
                            </div>
                        );
                    })}
            </div>
        </div>
    );
};

const Toast: React.FC<{ text: string; onDone: () => void }> = ({ text, onDone }) => {
    useEffect(() => {
        const id = window.setTimeout(onDone, 4000);
        return () => window.clearTimeout(id);
    }, [text, onDone]);
    return <div style={{ ...panel, left: "auto", right: 448, width: "auto", maxWidth: 520 }}>{text}</div>;
};

/* ── talking it through, rehearsing ───────────────────────────────────── */

/** A talk-through's transcript, under the chapter each part was said in. */
function talkMarkdown(words: readonly HeardWord[], marks: readonly { chapter: number; at: number }[]): string {
    const LAG = 12;
    const parts = marks.map((m, i) => {
        const from = i === 0 ? -Infinity : m.at;
        const to = marks[i + 1]?.at ?? Infinity;
        const text = words
            .filter((w) => w.at - LAG >= from && w.at - LAG < to)
            .map((w) => w.text)
            .join(" ");
        return `## ${FILM.chapters[m.chapter].title}\n\n${text || "(nothing heard)"}`;
    });
    return [
        `# Talk-through · ${FILM.title} · ${new Date().toLocaleString()}`,
        "Transcribed live by Chrome's speech recognition: no punctuation, and a word here and there may be misheard. The recording is next to this file.",
        ...parts,
    ].join("\n\n") + "\n";
}

/** The talk-through's prompter: the chapter titles, the current one large,
 *  pinned under the camera like the script's rows. */
const TalkPrompter: React.FC<{ current: number; active: boolean }> = ({ current, active }) => (
    <div style={{ position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", left: 24, top: 10, fontFamily: "JetBrains Mono, monospace", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,255,255,0.35)" }}>
            talk it through · in your own words
        </div>
        <div style={{ width: "min(560px, 46vw)", margin: "0 auto", paddingTop: 10, fontFamily: "Instrument Sans, Inter, sans-serif" }}>
            <div style={{ fontSize: "clamp(28px, 4.4vh, 44px)", fontWeight: 600, letterSpacing: "-0.015em", color: "#FFFFFF" }}>{FILM.chapters[current].title}</div>
            <div style={{ marginTop: 6, fontSize: "clamp(15px, 2vh, 19px)", lineHeight: 1.45, color: "rgba(255,255,255,0.5)" }}>
                {active ? "What is it, and why does it matter? Say it the way you would to a colleague." : "Space starts. The chapter titles are the only prompts."}
            </div>
            <div style={{ marginTop: 10, fontSize: "clamp(14px, 1.8vh, 17px)", color: "rgba(255,255,255,0.32)" }}>
                {FILM.chapters
                    .slice(current + 1, current + 4)
                    .map((c) => c.title)
                    .join("  ·  ")}
            </div>
        </div>
    </div>
);

/**
 * A rehearsal's result: every line, what you said, and where they differ.
 * A line you said differently gets your version, already punctuated from
 * the script where the words agree, to edit and keep — "Use mine" writes it
 * into the film's source (and the voice-over docs) through the server.
 */
const RehearsalPanel: React.FC<{ rows: RehearsedLine[]; onClose: () => void }> = ({ rows, onClose }) => {
    const [drafts, setDrafts] = useState(() => rows.map((r) => (r.heard ? suggestLine(r.script, r.heard) : r.script)));
    const [done, setDone] = useState<Record<string, "mine" | "kept" | string>>({});
    const changed = Object.values(done).some((d) => d === "mine");
    const differing = rows.filter((r) => r.heard && !sameWords(r.script, r.heard)).length;
    const keep = async (k: number) => {
        const r = rows[k];
        const res = await fetch(`/api/script/${FILM.id}`, { method: "POST", body: JSON.stringify({ from: r.script, to: drafts[k] }) });
        const out = (await res.json()) as { error?: string };
        setDone((d) => ({ ...d, [r.id]: res.ok ? "mine" : `couldn't change it: ${out.error ?? res.status}` }));
    };
    return (
        <div style={sheet}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <span style={{ fontWeight: 600, flex: 1 }}>
                    Rehearsal · {differing ? `${differing} of ${rows.length} lines said differently` : "every line as written"}
                </span>
                {changed && (
                    <button style={button} onClick={() => location.reload()}>
                        Reload with the new script
                    </button>
                )}
                <button style={mini} onClick={onClose}>
                    Close
                </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {rows.map((r, k) => {
                    const state = done[r.id];
                    const same = !!r.heard && sameWords(r.script, r.heard);
                    return (
                        <div key={r.id} style={{ ...card, display: "flex", flexDirection: "column", gap: 8 }}>
                            <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                                <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "rgba(255,255,255,0.4)", width: 90, flex: "none" }}>{r.id}</span>
                                <span style={{ fontSize: 15, lineHeight: 1.5 }}>
                                    {!r.heard ? (
                                        <span style={{ color: "rgba(255,255,255,0.4)" }}>{r.script} — not reached</span>
                                    ) : same ? (
                                        <span style={{ color: "rgba(255,255,255,0.7)" }}>{r.script} ✓</span>
                                    ) : (
                                        <Diff parts={diffWords(r.script, r.heard)} />
                                    )}
                                </span>
                            </div>
                            {r.heard && !same && (
                                <div style={{ display: "flex", gap: 8, alignItems: "center", paddingLeft: 100 }}>
                                    <input
                                        value={drafts[k]}
                                        disabled={state === "mine"}
                                        onChange={(e) => setDrafts((d) => d.map((x, i) => (i === k ? e.target.value : x)))}
                                        style={{ flex: 1, background: "#0B0C0E", color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 6, padding: "7px 10px", fontSize: 15 }}
                                    />
                                    {state === "mine" ? (
                                        <span style={{ color: "#34D399", fontSize: 13 }}>in the script</span>
                                    ) : state === "kept" ? (
                                        <span style={{ color: "rgba(255,255,255,0.45)", fontSize: 13 }}>kept as written</span>
                                    ) : (
                                        <>
                                            <button style={mini} onClick={() => void keep(k)}>
                                                Use mine
                                            </button>
                                            <button style={mini} onClick={() => setDone((d) => ({ ...d, [r.id]: "kept" }))}>
                                                Keep script
                                            </button>
                                        </>
                                    )}
                                </div>
                            )}
                            {state && state !== "mine" && state !== "kept" && <div style={{ paddingLeft: 100, color: "#FFB4B6", fontSize: 13 }}>{state}</div>}
                        </div>
                    );
                })}
            </div>
            <div style={{ marginTop: 14, fontSize: 13, color: "rgba(255,255,255,0.45)" }}>
                Green: what you said that the script doesn't. Struck through: what you left out. Changing a line means its takes must be recorded again.
            </div>
        </div>
    );
};

const Diff: React.FC<{ parts: DiffPart[] }> = ({ parts }) => (
    <>
        {parts.map((p, i) => (
            <span
                key={i}
                style={
                    p.kind === "said"
                        ? { color: "#34D399" }
                        : p.kind === "dropped"
                          ? { color: "rgba(255,120,120,0.75)", textDecorationLine: "line-through" }
                          : { color: "rgba(255,255,255,0.8)" }
                }
            >
                {p.text}{" "}
            </span>
        ))}
    </>
);

/* ── the prompter ────────────────────────────────────────────────────── */

/**
 * A teleprompter for EYE CONTACT: the row being read is pinned to the top
 * edge of the screen, right under the camera, and everything else keeps the
 * eyes there.
 *
 *   - A narrow column, about thirty characters, centred under the lens: the
 *     eyes sweep a few centimetres across a row, not the whole screen.
 *   - Left-aligned, so every row starts in the same place.
 *   - It scrolls a ROW at a time, when the word being said wraps: the eyes
 *     stay on the top row and the text comes up to them. Two rows of what is
 *     coming sit under it, fading, to read ahead.
 *
 * It shows only the lines of the take about to be recorded (or the line
 * being played back): one chapter is all there is to read.
 */
const PROMPTER_PAD = 10;

const Prompter: React.FC<{ lines: Script; position: { line: number; word: number }; active: boolean; label: string }> = ({ lines: script, position, active, label }) => {
    const words = useRef(new Map<string, HTMLSpanElement>());
    const [offset, setOffset] = useState(0);
    const current = Math.min(position.line, script.length - 1);
    const spoken = active ? position.word : 0;
    const focus = Math.min(spoken, (script[current]?.words.length ?? 1) - 1);

    useLayoutEffect(() => {
        const span = words.current.get(`${script[active ? current : 0]?.id}:${active ? focus : 0}`);
        if (span) setOffset(Math.max(0, span.offsetTop - PROMPTER_PAD));
    }, [current, focus, active, script]);

    return (
        <div style={{ position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", left: 24, top: 10, fontFamily: "JetBrains Mono, monospace", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,255,255,0.35)" }}>{label}</div>
            <div
                style={{
                    position: "relative",
                    height: "100%",
                    WebkitMaskImage: "linear-gradient(#000 0%, #000 70%, transparent 100%)",
                    maskImage: "linear-gradient(#000 0%, #000 70%, transparent 100%)",
                }}
            >
                <div
                    style={{
                        position: "relative",
                        width: "min(520px, 42vw)",
                        margin: "0 auto",
                        paddingTop: PROMPTER_PAD,
                        transform: `translateY(${-offset}px)`,
                        transition: "transform 300ms cubic-bezier(0.16, 1, 0.3, 1)",
                        fontFamily: "Instrument Sans, Inter, sans-serif",
                        fontSize: "clamp(24px, 3.4vh, 36px)",
                        lineHeight: 1.28,
                        fontWeight: 500,
                        letterSpacing: "-0.01em",
                        textAlign: "left",
                    }}
                >
                    {script.map((line, k) => (
                        <p key={line.id} style={{ margin: "0 0 0.45em" }}>
                            {line.speaker && line.speaker !== script[k - 1]?.speaker && <Speaker name={line.speaker} />}
                            {line.words.map((w, i) => {
                                const done = active && (k < current || (k === current && i < spoken));
                                const next = active && k === current && i === spoken;
                                const color = done ? "#FFFFFF" : !active || k === current ? "rgba(255,255,255,0.82)" : "rgba(255,255,255,0.5)";
                                return (
                                    <span
                                        key={i}
                                        ref={(el) => {
                                            if (el) words.current.set(`${line.id}:${i}`, el);
                                        }}
                                        style={{
                                            color,
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
        </div>
    );
};

/** Whose line it is, inline before its first word, wherever the voice
 *  changes: in the row being read, so the next voice sees it in time. */
const SPEAKER_COLOR: Record<string, string> = { francesco: "#FFC600", marian: "#36CCD6", both: "#FF9A9E" };

const Speaker: React.FC<{ name: string }> = ({ name }) => (
    <span
        style={{
            fontFamily: "JetBrains Mono, monospace",
            fontSize: "0.5em",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            verticalAlign: "0.35em",
            marginRight: "0.7em",
            padding: "0.15em 0.5em",
            borderRadius: 6,
            color: "#090A0C",
            background: SPEAKER_COLOR[name] ?? "#FFFFFF",
        }}
    >
        {name}
    </span>
);

const Meter: React.FC<{ level: number; threshold: number; speaking: boolean }> = ({ level, threshold, speaking }) => {
    const x = (db: number) => `${Math.max(0, Math.min(100, ((db + 80) / 80) * 100))}%`;
    return (
        <span style={{ position: "relative", width: 140, height: 8, borderRadius: 4, background: "rgba(255,255,255,0.08)", overflow: "hidden" }} title="microphone level; the line is the voice threshold">
            <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: x(level), background: speaking ? "#34D399" : "rgba(255,255,255,0.35)" }} />
            <span style={{ position: "absolute", left: x(threshold), top: 0, bottom: 0, width: 2, background: "#36CCD6" }} />
        </span>
    );
};

const Select: React.FC<{ label: string; value: string | undefined; options: ReadonlyArray<{ deviceId: string; label: string }>; onChange: (v: string) => void }> = ({ label, value, options, onChange }) => (
    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {label}
        <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} style={select}>
            <option value="">default</option>
            {options.map((o) => (
                <option key={o.deviceId} value={o.deviceId}>
                    {o.label || o.deviceId.slice(0, 8)}
                </option>
            ))}
        </select>
    </label>
);

/** Pairing the phone: the QR code to scan, and what happens next. */
const PhonePairing: React.FC<{ state: PhoneState | null; onCancel: () => void }> = ({ state, onCancel }) => {
    const [url, setUrl] = useState<string | null | undefined>(undefined);
    useEffect(() => {
        let live = true;
        fetch("/api/phone")
            .then((r) => r.json())
            .then((v: unknown) => live && setUrl(typeof v === "object" && v !== null && "url" in v && typeof v.url === "string" ? v.url : null))
            .catch(() => live && setUrl(null));
        return () => {
            live = false;
        };
    }, []);
    return (
        <div style={{ ...sheet, display: "flex", gap: 28, alignItems: "center" }}>
            {url && <img src="/api/phone/qr.svg" alt="" width={220} height={220} style={{ borderRadius: 8, background: "#fff", flex: "none" }} />}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
                <span style={{ fontWeight: 600, fontSize: 18 }}>{state?.status === "connecting" ? "The phone is connecting…" : "Scan this with the phone"}</span>
                {url === null ? (
                    <span>This Mac has no address on a network. Connect it to Wi-Fi and restart pnpm live.</span>
                ) : (
                    <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7, color: "rgba(255,255,255,0.75)" }}>
                        <li>Phone on the same Wi-Fi as this Mac; open the code's link in Chrome.</li>
                        <li>The first time, Chrome warns about the certificate: Advanced → Proceed.</li>
                        <li>Allow the camera. The picture appears here; the sound stays this Mac's microphone.</li>
                        <li>Hold the phone sideways for the 16:9 film. Then press Sync check, once per phone camera.</li>
                    </ol>
                )}
                {url && <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "rgba(255,255,255,0.45)", userSelect: "all", wordBreak: "break-all" }}>{url}</span>}
                <span>
                    <button style={ghost} onClick={onCancel}>
                        Use this Mac's camera instead
                    </button>
                </span>
            </div>
        </div>
    );
};

/** The phone in the status bar: its live picture, size, rate and delay. */
const PhoneBadge: React.FC<{ link: PhoneLink; state: PhoneState; onSync: (() => void) | null }> = ({ link, state, onSync }) => {
    const host = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        const el = host.current;
        if (!el) return;
        const video = link.video;
        Object.assign(video.style, { width: "64px", height: "36px", objectFit: "cover", borderRadius: "4px", background: "#000", display: "block" });
        el.appendChild(video);
        /* A video element taken out of the page pauses: play it again. */
        void video.play().catch(() => undefined);
        return () => {
            if (video.parentNode === el) el.removeChild(video);
        };
    }, [link]);
    const r = state.received;
    const synced = state.cameraMs !== null;
    const how = synced
        ? `the link's delay now plus the camera's ${state.cameraMs} ms from the sync check`
        : "the link's delay only — the camera's own is unknown until a sync check";
    return (
        <span style={{ display: "flex", alignItems: "center", gap: 8, color: "rgba(255,255,255,0.6)", fontSize: 13 }} title={`${state.camera?.label ?? "phone"} — the picture lags the sound by ${how}. Each take is lined up by it.`}>
            <span ref={host} />
            {`phone${r?.width ? ` · ${r.width}×${r.height} · ${r.fps} fps` : ""}${state.latencyMs !== null ? ` · ${state.latencyMs} ms` : ""}`}
            {onSync && (
                <button style={{ ...mini, ...(synced ? null : { borderColor: "#F5B83D", color: "#F5B83D" }) }} onClick={onSync} title="Flashes this screen while the phone films it, to measure the camera's own delay">
                    {synced ? "synced · check again" : "Sync check"}
                </button>
            )}
        </span>
    );
};

/**
 * The sync check: the phone films this screen while it flashes. Full screen
 * and drawn directly (not through React), so each flash reaches the display
 * on the frame it was timed for.
 */
const SyncCheck: React.FC<{ link: PhoneLink; track: MediaStreamTrack; onDone: (result: SyncResult | null) => void }> = ({ link, track, onDone }) => {
    const screen = useRef<HTMLDivElement>(null);
    const preview = useRef<HTMLVideoElement>(null);
    const [progress, setProgress] = useState<{ done: number; of: number } | null>(null);
    useEffect(() => {
        const v = preview.current;
        if (!v) return;
        v.srcObject = new MediaStream([track]);
        void v.play().catch(() => undefined);
        return () => {
            v.srcObject = null;
        };
    }, [track]);
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.code === "Escape" && !progress) onDone(null);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onDone, progress]);
    const run = async () => {
        const el = screen.current;
        const v = preview.current;
        if (!el || !v) return;
        setProgress({ done: 0, of: 1 });
        const result = await link.syncCheck(
            v,
            (white) => {
                el.style.background = white ? "#FFFFFF" : "#000000";
            },
            (done, of) => setProgress({ done, of }),
        );
        onDone(result);
    };
    return (
        <div ref={screen} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "#000", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <video ref={preview} muted playsInline autoPlay style={{ position: "absolute", right: 24, bottom: 24, width: 240, borderRadius: 8, background: "#111" }} />
            {progress ? (
                <span style={{ position: "absolute", left: 24, bottom: 24, color: "#777", fontSize: 13 }}>
                    flash {progress.done}/{progress.of}
                </span>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 520, color: "rgba(255,255,255,0.8)", lineHeight: 1.6 }}>
                    <span style={{ fontWeight: 600, fontSize: 20, color: "#fff" }}>Sync check</span>
                    <span>
                        Point the phone at this screen, close enough that the screen fills most of its picture (the preview, bottom right), and hold it still. The screen will flash white
                        about ten times over eight seconds.
                    </span>
                    <span>It measures how late the phone's picture arrives after the sound, camera included, so every take can be lined up exactly. Once per phone camera.</span>
                    <span style={{ display: "flex", gap: 10 }}>
                        <button style={button} onClick={() => void run()}>
                            Start — flashes the screen
                        </button>
                        <button style={ghost} onClick={() => onDone(null)}>
                            Cancel
                        </button>
                    </span>
                </div>
            )}
        </div>
    );
};

/* ── helpers ─────────────────────────────────────────────────────────── */

/** What listens to a read: the follower, and the transcript beside it. */
interface Ear {
    onSession(now: number): void;
    onTranscript(text: string, final: boolean, now: number): void;
    onVoice(speaking: boolean, at: number, now: number): void;
}

/** Feeds a simulated read of `script` to the ear, on the real clock. */
function runSimulation(follower: Ear, t0: number, wpm: number, script: Script, onText: (text: string) => void, mishear?: number): () => void {
    const read = simulateRead({ wpm, startMs: 1500, script, seed: Math.floor(Math.random() * 1e6), ...(mishear === undefined ? {} : { mishear }) });
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

/** The open camera, as it really runs: its name, size and frame rate. */
function cameraLabel(track: MediaStreamTrack): string {
    const { width, height, frameRate } = track.getSettings();
    const size = width && height ? ` · ${width}×${height}` : "";
    const fps = frameRate ? ` · ${Math.round(frameRate)} fps` : "";
    return `${track.label || "camera"}${size}${fps}`;
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}.${Math.floor((seconds % 1) * 10)}`;

/* One screen, never scrolled: the prompter's band on top, the film and the
   chapters in whatever height is left, the status and the keys under it. */
const PROMPTER_HEIGHT = "19vh";
const page: React.CSSProperties = {
    height: "100vh",
    overflow: "hidden",
    background: "#090A0C",
    color: "#FFFFFF",
    fontFamily: "Inter, sans-serif",
    display: "grid",
    gridTemplateRows: `${PROMPTER_HEIGHT} minmax(0, 1fr) auto auto`,
    gap: 12,
    paddingBottom: 16,
    boxSizing: "border-box",
};
const bar: React.CSSProperties = { display: "flex", alignItems: "center", gap: 20, padding: "4px 24px 0", fontSize: 14 };
const panel: React.CSSProperties = {
    position: "fixed",
    left: 48,
    right: 448,
    bottom: 96,
    padding: "16px 20px",
    borderRadius: 9,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "#111316",
    zIndex: 2,
};
const button: React.CSSProperties = { background: "#FFFFFF", color: "#090A0C", border: 0, borderRadius: 6, padding: "8px 16px", fontWeight: 600, fontSize: 14, cursor: "pointer" };
const ghost: React.CSSProperties = { background: "transparent", color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 6, padding: "7px 14px", fontWeight: 500, fontSize: 14, cursor: "pointer" };
const mini: React.CSSProperties = { background: "transparent", color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 5, padding: "2px 8px", fontSize: 12, cursor: "pointer", lineHeight: 1.5 };
const select: React.CSSProperties = { background: "#16181c", color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 6, padding: "5px 8px", maxWidth: 260 };
const check: React.CSSProperties = { display: "flex", gap: 6, alignItems: "center", cursor: "pointer" };
const tab: React.CSSProperties = { flex: 1, textAlign: "left", background: "#111316", color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 12px", cursor: "pointer", fontSize: 13 };
const tabOn: React.CSSProperties = { background: "#FFFFFF", color: "#090A0C", border: "1px solid #FFFFFF" };
const card: React.CSSProperties = { background: "#0F1114", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 9, padding: "10px 12px", fontSize: 14 };
const cardOn: React.CSSProperties = { background: "#14171B", border: "1px solid rgba(255,255,255,0.22)" };
const segment: React.CSSProperties = { background: "transparent", color: "rgba(255,255,255,0.7)", border: 0, padding: "7px 12px", fontSize: 13, cursor: "pointer" };
const segmentOn: React.CSSProperties = { background: "rgba(255,255,255,0.14)", color: "#FFFFFF" };
/* A large sheet over the film and the chapters: a rehearsal, a transcript. */
const sheet: React.CSSProperties = {
    position: "fixed",
    left: 48,
    right: 48,
    top: "21vh",
    bottom: 96,
    overflow: "auto",
    padding: "18px 22px",
    borderRadius: 11,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "#0E1013",
    zIndex: 3,
    boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
};
const badge: React.CSSProperties = { fontFamily: "JetBrains Mono, monospace", fontSize: 10, padding: "1px 5px", borderRadius: 4, border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.55)" };
