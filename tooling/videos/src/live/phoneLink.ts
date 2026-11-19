/**
 * The recording page's end of the phone camera (src/live/phone.ts is the
 * phone's end, scripts/phone.mjs introduces the two).
 *
 * Always listening while the page is open, so a phone can join at any time;
 * picking "Phone" as the camera uses it. It answers the phone's offer and
 * keeps the receive buffer as small as Chrome allows.
 *
 * THE DELAY. A take records the Mac's microphone as it happens and the
 * phone's picture some 60–200 ms later, so take.mjs moves the picture back
 * by the delay each take records. The delay has two parts:
 *
 *   - The link: the phone's encode, half the round trip, the receive buffer
 *     and the decode. Read from the link's statistics every second; it moves
 *     with the Wi-Fi, so each take uses its own.
 *   - The camera: from light reaching the phone's sensor to the frame being
 *     handed to Chrome. No statistic reports it, and Chrome does not report
 *     a remote frame's capture time, so it is MEASURED once, by the sync
 *     check: the page flashes the screen while the phone films it, and the
 *     time from each flash to the frame that shows it is the whole delay.
 *     Less the link's part at that moment, it is the camera's, kept per
 *     camera and frame rate (localStorage) and added to every take.
 *
 * Until a sync check has run, a take records the link's part alone and says
 * so (latencySource "estimated").
 */

export interface PhoneCamera {
    label: string;
    width: number;
    height: number;
    fps: number;
}

export interface PhoneState {
    status: "off" | "waiting" | "connecting" | "live";
    track: MediaStreamTrack | null;
    /** The camera as the phone opened it. */
    camera: PhoneCamera | null;
    /** What arrives here. */
    received: { width: number; height: number; fps: number } | null;
    /** How far the picture lags the sound now. */
    latencyMs: number | null;
    latencySource: LatencySource | null;
    /** The camera's own delay, from a sync check, for the camera in use. */
    cameraMs: number | null;
}

/** "synced": link + the camera's measured delay; "estimated": the link only. */
export type LatencySource = "synced" | "estimated";

/** What a take records about its picture, for take.mjs. */
export interface TakeVideo {
    source: "phone";
    /** How far the picture lags the sound: take.mjs moves it back by this. */
    latencyMs: number | null;
    latencySource: LatencySource | null;
    /** The link's part (median over the take) and the camera's. */
    linkMs: number | null;
    cameraMs: number | null;
    camera: PhoneCamera | null;
}

export type SyncResult = { ok: true; totalMs: number; cameraMs: number; flashes: number } | { ok: false; reason: string };

const median = (xs: number[]): number | null => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
};

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null;
}
function num(v: unknown): number | null {
    return typeof v === "number" && Number.isFinite(v) ? v : null;
}

const store = {
    get(key: string): number | null {
        try {
            const v = localStorage.getItem(key);
            return v === null ? null : num(Number(v));
        } catch {
            return null;
        }
    },
    set(key: string, value: number): void {
        try {
            localStorage.setItem(key, String(Math.round(value)));
        } catch {
            /* private window: measured again next time */
        }
    },
};

/** Every candidate gathered before the answer goes back: no trickle. */
function gathered(conn: RTCPeerConnection): Promise<void> {
    if (conn.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve) => {
        const done = () => {
            if (conn.iceGatheringState !== "complete") return;
            conn.removeEventListener("icegatheringstatechange", done);
            resolve();
        };
        conn.addEventListener("icegatheringstatechange", done);
        setTimeout(resolve, 2000);
    });
}

const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class PhoneLink {
    /** A small live view of the phone, for the page's status bar. */
    readonly video: HTMLVideoElement;
    private state: PhoneState = { status: "off", track: null, camera: null, received: null, latencyMs: null, latencySource: null, cameraMs: null };
    private listeners = new Set<(s: PhoneState) => void>();
    private events: EventSource | null = null;
    private pc: RTCPeerConnection | null = null;
    private pendingTrack: MediaStreamTrack | null = null;
    private statsTimer = 0;
    private encodeMs: number | null = null;
    /** The link's part of the delay, from the last second's statistics. */
    private linkMs: number | null = null;
    private collectors = new Set<number[]>();
    private last = { jitter: 0, emitted: 0, processing: 0, decode: 0, decoded: 0 };
    private readonly onUnload = () => this.pc?.close();

    constructor() {
        this.video = document.createElement("video");
        this.video.muted = true;
        this.video.playsInline = true;
        this.video.autoplay = true;
    }

    get current(): PhoneState {
        return this.state;
    }

    subscribe(fn: (s: PhoneState) => void): () => void {
        this.listeners.add(fn);
        fn(this.state);
        return () => this.listeners.delete(fn);
    }

    private set(patch: Partial<PhoneState>): void {
        this.state = { ...this.state, ...patch };
        for (const fn of this.listeners) fn(this.state);
    }

    start(): void {
        if (this.events) return;
        this.set({ status: "waiting" });
        this.events = new EventSource("/api/phone/events");
        this.events.onmessage = (e: MessageEvent<string>) => {
            const msg: unknown = JSON.parse(e.data);
            if (isRecord(msg) && msg.type === "offer" && typeof msg.id === "string" && typeof msg.sdp === "string") void this.answer(msg.id, msg.sdp);
        };
        window.addEventListener("beforeunload", this.onUnload);
        this.statsTimer = window.setInterval(() => void this.sample(), 1000);
    }

    stop(): void {
        this.events?.close();
        this.events = null;
        this.pc?.close();
        this.pc = null;
        window.clearInterval(this.statsTimer);
        window.removeEventListener("beforeunload", this.onUnload);
        this.video.srcObject = null;
        this.set({ status: "off", track: null });
    }

    /** Starts collecting the link's delay for a take; call the result when
     *  the take ends. */
    mark(): () => TakeVideo {
        const samples: number[] = [];
        this.collectors.add(samples);
        return () => {
            this.collectors.delete(samples);
            const link = median(samples) ?? this.linkMs;
            const cam = this.state.cameraMs;
            return {
                source: "phone",
                latencyMs: link === null ? null : Math.round(link + (cam ?? 0)),
                latencySource: link === null ? null : cam !== null ? "synced" : "estimated",
                linkMs: link === null ? null : Math.round(link),
                cameraMs: cam,
                camera: this.state.camera,
            };
        };
    }

    /** Where a camera's measured delay is kept: per camera and frame rate. */
    private cameraKey(cam: PhoneCamera | null): string | null {
        return cam ? `phone.cameraMs.${cam.label}@${cam.fps}` : null;
    }

    /**
     * THE SYNC CHECK. `flash(white)` turns the screen white or black; the
     * phone must be filming the screen, and `video` showing the phone.
     * Each flash is timed from the animation frame after the one that drew
     * it (about when it reached the display) to the first phone frame whose
     * brightness crossed over — that frame's presentation time is when it
     * reached this page, which is when a take's recorder receives it.
     */
    async syncCheck(video: HTMLVideoElement, flash: (white: boolean) => void, onProgress?: (done: number, of: number) => void): Promise<SyncResult> {
        const FLASHES = 12;
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 18;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return { ok: false, reason: "no canvas" };
        const frames: { t: number; y: number }[] = [];
        let running = true;
        const onFrame = (_now: number, meta: VideoFrameCallbackMetadata) => {
            if (!running) return;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let sum = 0;
            for (let i = 0; i < px.length; i += 4) sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
            frames.push({ t: meta.presentationTime, y: sum / (px.length / 4) });
            video.requestVideoFrameCallback(onFrame);
        };
        video.requestVideoFrameCallback(onFrame);

        const flips: { t: number; white: boolean; linkMs: number | null }[] = [];
        flash(false);
        await wait(1500); /* the camera settles its exposure on black */
        for (let i = 0; i < FLASHES; i++) {
            const white = i % 2 === 0;
            await nextFrame();
            flash(white);
            const shown = await nextFrame();
            flips.push({ t: shown, white, linkMs: this.linkMs });
            onProgress?.(i + 1, FLASHES);
            /* Irregular, so a flash never lines up with the camera's rhythm. */
            await wait(550 + Math.random() * 250);
        }
        await wait(400);
        running = false;
        flash(false);

        if (frames.length < 20) return { ok: false, reason: "The phone's picture stopped during the check. Is it still connected?" };
        const ys = frames.map((f) => f.y).sort((a, b) => a - b);
        const lo = ys[Math.floor(ys.length * 0.1)];
        const hi = ys[Math.floor(ys.length * 0.9)];
        if (hi - lo < 20) return { ok: false, reason: "The phone didn't see the screen flash. Point it at this screen, close enough that the screen fills most of its picture, and try again." };
        const mid = (lo + hi) / 2;
        const delays: number[] = [];
        const links: number[] = [];
        for (const flip of flips) {
            const hit = frames.find((f) => f.t > flip.t && (flip.white ? f.y > mid : f.y < mid));
            if (!hit) continue;
            const d = hit.t - flip.t;
            if (d > 0 && d < 700) {
                delays.push(d);
                if (flip.linkMs !== null) links.push(flip.linkMs);
            }
        }
        if (delays.length < FLASHES / 2) return { ok: false, reason: `Only ${delays.length} of ${FLASHES} flashes were seen. Hold the phone steady, pointed at this screen, and try again.` };
        const total = median(delays) ?? 0;
        const link = median(links) ?? this.linkMs ?? 0;
        const cameraMs = Math.max(0, Math.round(total - link));
        const key = this.cameraKey(this.state.camera);
        if (key) store.set(key, cameraMs);
        this.set({ cameraMs });
        this.publishLatency();
        return { ok: true, totalMs: Math.round(total), cameraMs, flashes: delays.length };
    }

    private async answer(id: string, sdp: string): Promise<void> {
        this.pc?.close();
        const conn = new RTCPeerConnection({ iceServers: [] });
        this.pc = conn;
        this.set({ status: "connecting" });
        conn.ontrack = (e) => {
            /* The smallest receive buffer Chrome allows: frames are shown as
               soon as they are decoded, not smoothed. (jitterBufferTarget is
               the standard name, playoutDelayHint Chrome's older one.) */
            Reflect.set(e.receiver, "jitterBufferTarget", 0);
            Reflect.set(e.receiver, "playoutDelayHint", 0);
            this.pendingTrack = e.track;
        };
        conn.ondatachannel = (e) => {
            e.channel.onmessage = (m: MessageEvent<string>) => this.onStatus(m.data);
        };
        conn.onconnectionstatechange = () => {
            if (this.pc !== conn) return;
            const state = conn.connectionState;
            if (state === "connected" && this.pendingTrack) this.useTrack(this.pendingTrack);
            /* "disconnected" can recover by itself (a Wi-Fi blip): keep the
               picture until the link has failed or the phone offers again. */
            if (state === "failed" || state === "closed") this.drop();
        };
        try {
            await conn.setRemoteDescription({ type: "offer", sdp });
            await conn.setLocalDescription(await conn.createAnswer());
            await gathered(conn);
            await fetch("/api/phone/answer", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, sdp: conn.localDescription?.sdp }),
            });
        } catch (err) {
            console.warn("phone camera: could not answer", err);
            if (this.pc === conn) this.drop();
        }
    }

    private useTrack(track: MediaStreamTrack): void {
        this.linkMs = null;
        this.last = { jitter: 0, emitted: 0, processing: 0, decode: 0, decoded: 0 };
        this.video.srcObject = new MediaStream([track]);
        void this.video.play().catch(() => undefined);
        this.set({ status: "live", track });
        track.addEventListener("ended", () => this.state.track === track && this.drop());
    }

    private drop(): void {
        this.pendingTrack = null;
        this.video.srcObject = null;
        this.set({ status: this.events ? "waiting" : "off", track: null, received: null, latencyMs: null, latencySource: null });
    }

    private onStatus(data: string): void {
        const msg: unknown = JSON.parse(data);
        if (!isRecord(msg) || msg.type !== "status") return;
        this.encodeMs = num(msg.encodeMs);
        const cam = msg.camera;
        if (!isRecord(cam)) return;
        const camera: PhoneCamera = { label: typeof cam.label === "string" ? cam.label : "", width: num(cam.width) ?? 0, height: num(cam.height) ?? 0, fps: num(cam.fps) ?? 0 };
        const key = this.cameraKey(camera);
        /* Another camera or frame rate: its own sync check, if it had one. */
        if (key !== this.cameraKey(this.state.camera)) this.set({ camera, cameraMs: key ? store.get(key) : null });
        else this.set({ camera });
    }

    private publishLatency(): void {
        const link = this.linkMs;
        const cam = this.state.cameraMs;
        this.set({
            latencyMs: link === null ? null : Math.round(link + (cam ?? 0)),
            latencySource: link === null ? null : cam !== null ? "synced" : "estimated",
        });
    }

    /** Once a second: what arrives, and the link's part of the delay. */
    private async sample(): Promise<void> {
        const pc = this.pc;
        if (!pc || this.state.status !== "live") return;
        const report = await pc.getStats();
        let v: Record<string, unknown> | null = null;
        let rtt: number | null = null;
        for (const raw of report.values()) {
            const value: unknown = raw;
            if (!isRecord(value)) continue;
            if (value.type === "inbound-rtp" && value.kind === "video") v = value;
            if (value.type === "candidate-pair" && value.nominated === true && value.state === "succeeded") rtt = num(value.currentRoundTripTime) ?? rtt;
        }
        if (!v) return;
        const jitter = num(v.jitterBufferDelay) ?? 0;
        const emitted = num(v.jitterBufferEmittedCount) ?? 0;
        const processing = num(v.totalProcessingDelay) ?? 0;
        const decode = num(v.totalDecodeTime) ?? 0;
        const decoded = num(v.framesDecoded) ?? 0;
        const fps = num(v.framesPerSecond) ?? 0;
        const frames = decoded - this.last.decoded;
        /* From a frame's first packet arriving to it being decoded (the
           receive buffer and the decode), per frame over the last second. */
        let hereMs: number | null = null;
        if (frames > 0 && processing > this.last.processing) hereMs = ((processing - this.last.processing) / frames) * 1000;
        else if (emitted > this.last.emitted) hereMs = ((jitter - this.last.jitter) / (emitted - this.last.emitted) + (decode - this.last.decode) / Math.max(1, frames)) * 1000;
        this.last = { jitter, emitted, processing, decode, decoded };
        if (hereMs !== null) {
            /* A frame waits up to one interval to be captured, then is
               encoded, crosses the network, and waits here. */
            const captureMs = fps > 0 ? 1000 / fps : 33;
            this.linkMs = captureMs + (this.encodeMs ?? 8) + ((rtt ?? 0.01) * 1000) / 2 + hereMs;
            for (const c of this.collectors) c.push(this.linkMs);
        }
        this.set({ received: { width: num(v.frameWidth) ?? 0, height: num(v.frameHeight) ?? 0, fps: Math.round(fps) } });
        this.publishLatency();
    }
}
