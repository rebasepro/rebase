/**
 * THE PHONE'S PAGE — the phone as a wireless camera for the recording page.
 *
 * Opened on the phone from the QR code the recording page shows (served by
 * scripts/phone.mjs over HTTPS on the local network). It opens the camera
 * and sends it to the recording page over WebRTC, tuned for the lowest
 * delay a Wi-Fi link allows:
 *
 *   - 60 fps when the camera gives it: a frame waits half as long to exist.
 *   - H.264 first: the phone's hardware encoder, which never reorders frames.
 *   - A high starting bitrate (x-google-start-bitrate), so the first seconds
 *     are not blurry while the link measures itself, and up to 20 Mbit/s.
 *   - contentHint "motion": under pressure it keeps the frame rate and gives
 *     up resolution, rather than holding frames back.
 *
 * The recording page sets its receive buffer to the minimum, and measures
 * the delay that is left so a take's sound can be lined up with its picture.
 * Nothing but video leaves the phone: the voice is the Mac's microphone.
 */

const KEY = new URLSearchParams(location.search).get("k") ?? "";
const START_KBPS = 10_000;
const MIN_KBPS = 3_000;
const MAX_KBPS = 20_000;

/* ── the page ───────────────────────────────────────────────────────── */

document.body.innerHTML = `
<video id="preview" playsinline muted autoplay style="position:fixed;inset:0;width:100%;height:100%;object-fit:contain;background:#000"></video>
<div style="position:fixed;left:0;right:0;top:0;padding:max(12px,env(safe-area-inset-top)) 14px 12px;display:flex;gap:10px;align-items:center;background:linear-gradient(#000c,#0000)">
  <span id="dot" style="width:10px;height:10px;border-radius:50%;background:#888;flex:none"></span>
  <span id="status" style="font-weight:600">Opening the camera…</span>
  <span id="detail" style="margin-left:auto;font:12px ui-monospace,monospace;opacity:.7"></span>
</div>
<div style="position:fixed;left:0;right:0;bottom:0;padding:12px 14px max(16px,env(safe-area-inset-bottom));display:flex;gap:10px;justify-content:center;background:linear-gradient(#0000,#000c)">
  <button id="lens" style="${buttonCss()}">Switch camera</button>
  <button id="fps" style="${buttonCss()}">60 fps</button>
  <button id="dim" style="${buttonCss()}">Dim screen</button>
</div>
<div id="curtain" style="position:fixed;inset:0;background:#000;display:none;align-items:center;justify-content:center;color:#555;font-size:13px">Still sending — tap to show the preview</div>`;

function buttonCss(): string {
    return "background:#fff2;color:#fff;border:1px solid #fff3;border-radius:8px;padding:10px 14px;font:600 14px system-ui;backdrop-filter:blur(8px)";
}

function el<T extends HTMLElement>(id: string, type: new () => T): T {
    const node = document.getElementById(id);
    if (!(node instanceof type)) throw new Error(`#${id}?`);
    return node;
}

const preview = el("preview", HTMLVideoElement);
const statusText = el("status", HTMLSpanElement);
const detail = el("detail", HTMLSpanElement);
const dot = el("dot", HTMLSpanElement);
const curtain = el("curtain", HTMLDivElement);

function show(text: string, colour: "grey" | "amber" | "green" | "red"): void {
    statusText.textContent = text;
    dot.style.background = { grey: "#888", amber: "#F5B83D", green: "#3DDC84", red: "#FF5A5F" }[colour];
}

/* ── the camera ─────────────────────────────────────────────────────── */

let stream: MediaStream | null = null;
let deviceId: string | null = localStorage.getItem("phone.camera");
let fps = Number(localStorage.getItem("phone.fps")) || 60;
el("fps", HTMLButtonElement).textContent = `${fps} fps`;

async function openCamera(): Promise<MediaStreamTrack> {
    stream?.getTracks().forEach((t) => t.stop());
    const video: MediaTrackConstraints = {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: fps },
        ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } }),
    };
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch (err) {
        /* The camera remembered from last time is gone: the rear one. */
        if (!deviceId) throw err;
        deviceId = null;
        localStorage.removeItem("phone.camera");
        stream = await navigator.mediaDevices.getUserMedia({ video: { ...video, deviceId: undefined, facingMode: { ideal: "environment" } }, audio: false });
    }
    const track = stream.getVideoTracks()[0];
    track.contentHint = "motion";
    preview.srcObject = stream;
    return track;
}

function describe(track: MediaStreamTrack): { label: string; width: number; height: number; fps: number } {
    const s = track.getSettings();
    return { label: track.label, width: s.width ?? 0, height: s.height ?? 0, fps: Math.round(s.frameRate ?? 0) };
}

/* ── the link ───────────────────────────────────────────────────────── */

let pc: RTCPeerConnection | null = null;
let sender: RTCRtpSender | null = null;
let channel: RTCDataChannel | null = null;
let connecting = false;

/** Raises the bitrate the encoder starts at and may use: on a home network
 *  the default ramp-up leaves the first seconds soft. */
function withBitrate(sdp: string): string {
    let video = false;
    return sdp
        .split("\r\n")
        .map((line) => {
            if (line.startsWith("m=")) video = line.startsWith("m=video");
            if (video && line.startsWith("a=fmtp:") && !line.includes("x-google-start-bitrate") && !/apt=\d+$/.test(line)) {
                return `${line};x-google-start-bitrate=${START_KBPS};x-google-min-bitrate=${MIN_KBPS};x-google-max-bitrate=${MAX_KBPS}`;
            }
            return line;
        })
        .join("\r\n");
}

/** Asks for the absolute capture time in every frame's header: with it,
 *  the recording page learns exactly when each frame was captured, and so
 *  how late it arrived. Chrome supports it but does not offer it unasked. */
const ABS_CAPTURE_TIME = "http://www.webrtc.org/experiments/rtp-hdrext/abs-capture-time";
function withCaptureTime(sdp: string): string {
    if (sdp.includes(ABS_CAPTURE_TIME)) return sdp;
    const lines = sdp.split("\r\n");
    const start = lines.findIndex((l) => l.startsWith("m=video"));
    if (start < 0) return sdp;
    let end = lines.findIndex((l, i) => i > start && l.startsWith("m="));
    if (end < 0) end = lines.length;
    const section = lines.slice(start, end);
    const used = new Set(section.map((l) => /^a=extmap:(\d+)/.exec(l)?.[1]).filter((x): x is string => !!x).map(Number));
    let id = 1;
    while (used.has(id)) id++;
    /* One-byte header ids run 1–14; past that only with extmap-allow-mixed. */
    if (id > 14 && !sdp.includes("a=extmap-allow-mixed")) return sdp;
    const last = section.map((l) => l.startsWith("a=extmap:")).lastIndexOf(true);
    const at = start + (last >= 0 ? last + 1 : section.findIndex((l) => l.startsWith("a=")) || 1);
    lines.splice(at, 0, `a=extmap:${id} ${ABS_CAPTURE_TIME}`);
    return lines.join("\r\n");
}

/** Every candidate gathered: one round trip through the server, no trickle.
 *  On a local network that takes a few milliseconds. */
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

async function connect(): Promise<void> {
    if (connecting) return;
    connecting = true;
    try {
        pc?.close();
        const track = stream?.getVideoTracks()[0] ?? (await openCamera());
        const conn = new RTCPeerConnection({ iceServers: [] });
        pc = conn;
        const transceiver = conn.addTransceiver(track, {
            direction: "sendonly",
            streams: [stream ?? new MediaStream([track])],
            sendEncodings: [{ maxBitrate: MAX_KBPS * 1000, maxFramerate: 60 }],
        });
        sender = transceiver.sender;
        const codecs = RTCRtpSender.getCapabilities("video")?.codecs ?? [];
        const rank = (mime: string) => (mime === "video/H264" ? 0 : mime === "video/VP8" ? 1 : 2);
        transceiver.setCodecPreferences([...codecs].sort((a, b) => rank(a.mimeType) - rank(b.mimeType)));
        channel = conn.createDataChannel("status");
        channel.onopen = () => report();
        conn.onconnectionstatechange = () => {
            if (pc !== conn) return;
            const state = conn.connectionState;
            if (state === "connected") show("Live on the recording page", "green");
            else if (state === "connecting") show("Connecting…", "amber");
            else if (state === "disconnected" || state === "failed" || state === "closed") {
                show("Lost the recording page — reconnecting…", "amber");
                retry(1000);
            }
        };
        channel.onclose = () => {
            if (pc === conn && conn.connectionState !== "connected") retry(1000);
        };

        const offer = await conn.createOffer();
        await conn.setLocalDescription({ type: "offer", sdp: withCaptureTime(offer.sdp ?? "") });
        await gathered(conn);
        show("Looking for the recording page…", "amber");
        const res = await fetch(`/phone/offer?k=${encodeURIComponent(KEY)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sdp: conn.localDescription?.sdp }),
        });
        const reply: unknown = await res.json().catch(() => ({}));
        if (!res.ok) {
            const error = typeof reply === "object" && reply && "error" in reply ? String(reply.error) : `HTTP ${res.status}`;
            show(res.status === 409 ? "Open the recording page on the Mac and pick Phone as the camera" : error, res.status === 403 ? "red" : "amber");
            conn.close();
            retry(2000);
            return;
        }
        const sdp = typeof reply === "object" && reply && "sdp" in reply && typeof reply.sdp === "string" ? reply.sdp : null;
        if (!sdp) throw new Error("no answer");
        await conn.setRemoteDescription({ type: "answer", sdp: withBitrate(sdp) });
    } catch (err) {
        show(`Could not connect: ${err instanceof Error ? err.message : String(err)}`, "red");
        retry(3000);
    } finally {
        connecting = false;
    }
}

let retryTimer = 0;
function retry(ms: number): void {
    window.clearTimeout(retryTimer);
    retryTimer = window.setTimeout(() => void connect(), ms);
}

/* ── what the recording page is told ─────────────────────────────────── */

let lastEncode = { time: 0, frames: 0 };

/** Once a second: which camera, its size and rate, and how long a frame
 *  takes to encode — the recording page adds that to the delay it shows. */
async function report(): Promise<void> {
    const track = stream?.getVideoTracks()[0];
    if (!track || !pc || !sender) return;
    let encodeMs: number | null = null;
    let sent = { width: 0, height: 0, fps: 0 };
    const stats = await sender.getStats();
    stats.forEach((value: unknown) => {
        if (!isRecord(value) || value.type !== "outbound-rtp") return;
        const time = num(value.totalEncodeTime);
        const frames = num(value.framesEncoded);
        if (frames > lastEncode.frames) encodeMs = ((time - lastEncode.time) / (frames - lastEncode.frames)) * 1000;
        lastEncode = { time, frames };
        sent = { width: num(value.frameWidth), height: num(value.frameHeight), fps: Math.round(num(value.framesPerSecond)) };
    });
    const camera = describe(track);
    detail.textContent = sent.width ? `${sent.width}×${sent.height} · ${sent.fps} fps${encodeMs === null ? "" : ` · enc ${Math.round(encodeMs)} ms`}` : `${camera.width}×${camera.height}`;
    if (channel?.readyState === "open") channel.send(JSON.stringify({ type: "status", camera, sent, encodeMs }));
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null;
}
function num(v: unknown): number {
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/* ── controls ───────────────────────────────────────────────────────── */

/** Swaps the camera under the running link: no renegotiation, no gap. */
async function useCamera(): Promise<void> {
    const track = await openCamera();
    if (sender) await sender.replaceTrack(track);
    void report();
}

el("lens", HTMLButtonElement).onclick = async () => {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
    if (cams.length < 2) return;
    const current = stream?.getVideoTracks()[0]?.getSettings().deviceId ?? deviceId;
    const next = cams[(cams.findIndex((c) => c.deviceId === current) + 1) % cams.length];
    deviceId = next.deviceId;
    localStorage.setItem("phone.camera", deviceId);
    await useCamera();
    show(`${next.label || "camera"}`, pc?.connectionState === "connected" ? "green" : "amber");
    window.setTimeout(() => pc?.connectionState === "connected" && show("Live on the recording page", "green"), 1500);
};

el("fps", HTMLButtonElement).onclick = async (e) => {
    fps = fps === 60 ? 30 : 60;
    localStorage.setItem("phone.fps", String(fps));
    if (e.currentTarget instanceof HTMLButtonElement) e.currentTarget.textContent = `${fps} fps`;
    await useCamera();
};

/* The preview costs battery and heat over a long session; the link keeps
   running behind a black curtain. */
el("dim", HTMLButtonElement).onclick = () => {
    curtain.style.display = "flex";
};
curtain.onclick = () => {
    curtain.style.display = "none";
};

/* The screen must stay on: a locked phone stops its camera. */
let wakeLock: WakeLockSentinel | null = null;
async function keepAwake(): Promise<void> {
    try {
        if (document.visibilityState === "visible" && !wakeLock) {
            wakeLock = await navigator.wakeLock.request("screen");
            wakeLock.addEventListener("release", () => (wakeLock = null));
        }
    } catch {
        /* not allowed yet: retried on the next tap */
    }
}
document.addEventListener("visibilitychange", () => {
    void keepAwake();
    /* Chrome stops the camera of a page in the background; open it again. */
    if (document.visibilityState === "visible" && stream?.getVideoTracks()[0]?.readyState === "ended") void useCamera();
});
document.addEventListener("click", () => void keepAwake());

/* ── go ─────────────────────────────────────────────────────────────── */

if (!window.isSecureContext) {
    show("Open this page over https:// — Chrome only opens the camera on a secure page", "red");
} else {
    openCamera()
        .then(() => {
            void keepAwake();
            void connect();
            window.setInterval(() => void report(), 1000);
        })
        .catch((err: unknown) => {
            const name = err instanceof DOMException ? err.name : "";
            show(
                name === "NotAllowedError" ? "Camera blocked — allow it in the address bar's site settings, then reload" : `The camera would not open (${name || String(err)})`,
                "red",
            );
        });
}
