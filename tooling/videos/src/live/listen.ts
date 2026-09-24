/**
 * LISTENING — the two ways the recording page hears the presenter, and the
 * recording itself. Browser-only; follow.ts decides what any of it means.
 *
 *   Recognizer     Chrome's speech recognition (the Web Speech API): the
 *                  words, as a transcript that grows and gets revised.
 *   VoiceDetector  a level meter on the microphone: THAT someone is
 *                  speaking, within a tenth of a second, and the level.
 *   TakeRecorder   the camera and microphone to a file, streamed to the
 *                  page's server a second at a time so a crash loses at
 *                  most a second.
 */

/* The Web Speech API's recognition object is not in TypeScript's DOM types
   (its events and results are; the constructor was never standardised).
   This is the part of it used here, declared where Chrome puts it. */
interface SpeechRecognitionLike extends EventTarget {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    maxAlternatives: number;
    start(): void;
    stop(): void;
    abort(): void;
    onresult: ((e: SpeechRecognitionEvent) => void) | null;
    onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
    onend: (() => void) | null;
    onstart: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

declare global {
    interface Window {
        SpeechRecognition?: SpeechRecognitionCtor;
        webkitSpeechRecognition?: SpeechRecognitionCtor;
    }
}

function recognitionCtor(): SpeechRecognitionCtor | null {
    return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export const canRecognize = (): boolean => typeof window !== "undefined" && recognitionCtor() !== null;

export interface RecognizerHandlers {
    /** A new session: its transcript starts empty. */
    onSession(): void;
    /** The session's whole transcript so far, and whether its tail is final. */
    onTranscript(text: string, final: boolean): void;
    onState(state: "listening" | "restarting" | "stopped" | "error", detail?: string): void;
}

/**
 * Chrome's recogniser, kept running. It ends a session on its own — after
 * a stretch of silence, after about a minute, on a network hiccup — so it is
 * restarted every time it ends until `stop()`. Each restart is a new session
 * whose transcript starts empty, which the follower is told about.
 */
export class Recognizer {
    private rec: SpeechRecognitionLike | null = null;
    private running = false;
    private restartTimer: number | null = null;

    constructor(
        private readonly lang: string,
        private readonly handlers: RecognizerHandlers,
    ) {}

    start(): void {
        const Ctor = recognitionCtor();
        if (!Ctor) {
            this.handlers.onState("error", "This browser has no speech recognition. Use Chrome.");
            return;
        }
        this.running = true;
        this.open(Ctor);
    }

    stop(): void {
        this.running = false;
        if (this.restartTimer !== null) window.clearTimeout(this.restartTimer);
        this.rec?.abort();
        this.rec = null;
        this.handlers.onState("stopped");
    }

    private open(Ctor: SpeechRecognitionCtor) {
        const rec = new Ctor();
        rec.lang = this.lang;
        rec.continuous = true;
        rec.interimResults = true;
        rec.maxAlternatives = 1;
        rec.onstart = () => {
            this.handlers.onSession();
            this.handlers.onState("listening");
        };
        rec.onresult = (e) => {
            let text = "";
            let final = true;
            for (let i = 0; i < e.results.length; i++) {
                const r = e.results[i];
                text += (text ? " " : "") + (r[0]?.transcript ?? "").trim();
                final = r.isFinal;
            }
            this.handlers.onTranscript(text, final);
        };
        rec.onerror = (e) => {
            /* "no-speech" and "aborted" are the recogniser giving up on a
               quiet stretch; it ends, and is restarted. The others are real. */
            if (e.error === "no-speech" || e.error === "aborted") return;
            if (e.error === "not-allowed" || e.error === "service-not-allowed") {
                this.running = false;
                this.handlers.onState("error", "Microphone blocked for speech recognition — allow it in the address bar.");
                return;
            }
            this.handlers.onState("error", `recognition: ${e.error}`);
        };
        rec.onend = () => {
            if (!this.running) return;
            this.handlers.onState("restarting");
            this.restartTimer = window.setTimeout(() => {
                if (this.running) this.open(Ctor);
            }, 120);
        };
        this.rec = rec;
        try {
            rec.start();
        } catch (err) {
            this.handlers.onState("error", `recognition: ${String(err)}`);
        }
    }
}

/**
 * A voice detector: the microphone's level every 20 ms against a noise
 * floor it learns. Speech is 12 dB over the floor for 120 ms; silence is
 * under it (less 3 dB of hysteresis) for 400 ms. Each change is reported
 * with the time it actually began, not the time it was confirmed.
 *
 * The floor is the 5th percentile of the last eight seconds: the room, as
 * measured in the gaps between words. A floor that starts low and creeps
 * up takes seconds to reach a noisy room and calls the room a voice until
 * it does; one that drops to every dip is pinned by a single frame of
 * digital silence while the microphone starts.
 */
export class VoiceDetector {
    private ctx: AudioContext | null = null;
    private timer: number | null = null;
    /** Current level, dBFS, for the meter. */
    level = -100;
    floor = -70;
    threshold = -58;
    speaking = false;

    constructor(
        private readonly stream: MediaStream,
        private readonly onChange: (speaking: boolean, atMs: number) => void,
    ) {}

    start(): void {
        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(this.stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        const history: number[] = [];
        let above = 0;
        let below = 0;
        let runStart = 0;
        this.ctx = ctx;
        this.timer = window.setInterval(() => {
            const now = performance.now();
            analyser.getFloatTimeDomainData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
            const db = 10 * Math.log10(sum / buf.length + 1e-12);
            this.level = db;
            history.push(Math.max(-90, db));
            if (history.length > 400) history.shift();
            const sorted = [...history].sort((a, b) => a - b);
            this.floor = Math.min(-20, sorted[Math.floor(sorted.length * 0.05)]);
            const threshold = Math.max(this.floor + 12, -62);
            this.threshold = threshold;
            if (!this.speaking) {
                if (db > threshold) {
                    if (above === 0) runStart = now - 20;
                    above++;
                    if (above >= 6) {
                        this.speaking = true;
                        below = 0;
                        this.onChange(true, runStart);
                    }
                } else above = 0;
            } else if (db < threshold - 3) {
                if (below === 0) runStart = now - 20;
                below++;
                if (below >= 20) {
                    this.speaking = false;
                    above = 0;
                    this.onChange(false, runStart);
                }
            } else below = 0;
        }, 20);
    }

    stop(): void {
        if (this.timer !== null) window.clearInterval(this.timer);
        void this.ctx?.close();
        this.ctx = null;
    }
}

/** The best container Chrome will record: WebM with VP9 and Opus, else
 *  whatever it offers. The server re-encodes it for the film either way. */
function recordingType(): string {
    const prefer = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
    return prefer.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

/**
 * The take: camera and microphone to the server, one second at a time.
 * `startedAt` is the performance.now() of the recording's first frame —
 * the zero every other time on the page is measured from.
 */
export class TakeRecorder {
    private recorder: MediaRecorder | null = null;
    private queue: Promise<void> = Promise.resolve();
    startedAt = 0;
    bytes = 0;
    readonly type: string;

    constructor(
        private readonly stream: MediaStream,
        private readonly upload: (chunk: Blob) => Promise<void>,
    ) {
        this.type = recordingType();
    }

    get extension(): string {
        return this.type.startsWith("video/mp4") ? "mp4" : "webm";
    }

    start(): Promise<void> {
        return new Promise((resolve, reject) => {
            const recorder = new MediaRecorder(this.stream, {
                mimeType: this.type || undefined,
                videoBitsPerSecond: 10_000_000,
                audioBitsPerSecond: 192_000,
            });
            recorder.ondataavailable = (e) => {
                if (!e.data.size) return;
                this.bytes += e.data.size;
                /* In order, one at a time: the server appends. */
                this.queue = this.queue.then(() => this.upload(e.data));
            };
            recorder.onstart = () => {
                this.startedAt = performance.now();
                resolve();
            };
            recorder.onerror = () => reject(new Error("recording failed"));
            this.recorder = recorder;
            recorder.start(1000);
        });
    }

    /** Stops, and resolves once every chunk has reached the server. */
    stop(): Promise<void> {
        return new Promise((resolve) => {
            const recorder = this.recorder;
            if (!recorder || recorder.state === "inactive") return resolve();
            recorder.onstop = () => {
                void this.queue.then(() => resolve());
            };
            recorder.stop();
        });
    }
}
