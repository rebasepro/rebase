/**
 * THE PHONE AS A WIRELESS CAMERA for the recording page.
 *
 * The recording page runs on the Mac at http://localhost:3500. A phone on the
 * same Wi-Fi opens https://<the Mac's address>:3501/phone?k=<pairing key> in
 * Chrome, opens its own camera and sends it straight to the recording page
 * over WebRTC — the video never passes through this server. All this server
 * does is introduce the two: the phone posts an offer, the recording page
 * (listening on /api/phone/events) answers it, and the answer goes back in
 * the response to the phone's post.
 *
 *   phone  → POST /phone/offer?k=…   { sdp }   waits for the page's answer
 *   page   ← GET  /api/phone/events             the offers, as server-sent events
 *   page   → POST /api/phone/answer  { id, sdp }
 *   page   → GET  /api/phone                    the address and pairing QR code
 *
 * HTTPS because Chrome only opens a camera on a secure page. The certificate
 * is self-signed (made once with openssl, kept in build/live-phone/), so the
 * phone shows a warning the first time: Advanced → Proceed. The pairing key
 * is kept beside it, so a phone that paired once reconnects after a restart.
 *
 * The phone side listens on the network; the recording page's own API stays
 * on localhost. The network side serves the phone page and takes offers, and
 * nothing else, and only with the pairing key.
 */
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { renderSVG, renderUnicodeCompact } from "uqr";

/** The Mac's address on the local network: Wi-Fi first. */
export function lanAddress() {
    const all = os.networkInterfaces();
    const v4 = (name) => (all[name] ?? []).find((a) => a.family === "IPv4" && !a.internal && !a.address.startsWith("169.254."));
    const preferred = ["en0", "en1"].map(v4).find(Boolean);
    if (preferred) return preferred.address;
    for (const name of Object.keys(all)) {
        const hit = v4(name);
        if (hit) return hit.address;
    }
    return null;
}

/** A self-signed certificate and the pairing key, made once and kept. */
async function credentials(dir, address) {
    await mkdir(dir, { recursive: true });
    const key = path.join(dir, "key.pem");
    const cert = path.join(dir, "cert.pem");
    const tokenFile = path.join(dir, "pairing-key");
    if (!existsSync(key) || !existsSync(cert)) {
        const san = ["DNS:localhost", "IP:127.0.0.1", ...(address ? [`IP:${address}`] : [])].join(",");
        execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "825", "-subj", "/CN=Rebase recording page", "-addext", `subjectAltName=${san}`], { stdio: "ignore" });
    }
    if (!existsSync(tokenFile)) await writeFile(tokenFile, randomBytes(12).toString("base64url"));
    return { key: await readFile(key), cert: await readFile(cert), token: (await readFile(tokenFile, "utf8")).trim() };
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#090A0C">
<title>Rebase — phone camera</title>
<link rel="icon" href="data:,">
<style>html,body{margin:0;height:100%;background:#090A0C;color:#fff;font:15px/1.4 system-ui,sans-serif;overflow:hidden}</style>
</head>
<body><script type="module" src="/phone/phone.js"></script></body>
</html>`;

const NOT_PAIRED = `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
<body style="margin:0;padding:32px;background:#090A0C;color:#fff;font:17px/1.5 system-ui,sans-serif">
<h2>Not paired</h2><p>Scan the QR code on the recording page again (pick <b>Phone</b> as the camera on the Mac).</p></body>`;

/**
 * Starts the phone side. `serveFile(req, res, file)` and `bundleDir` come
 * from the recording page's server, which builds phone.js with the page.
 */
export async function startPhone({ port, root, bundleDir, serveFile }) {
    const address = lanAddress();
    const { key, cert, token } = await credentials(path.join(root, "build", "live-phone"), address);
    const url = address ? `https://${address}:${port}/phone?k=${token}` : null;

    /** The recording pages listening for a phone; the newest one answers. */
    const pages = new Set();
    /** Offers waiting for an answer, by id. */
    const waiting = new Map();

    const send = (res, event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    const json = (res, status, value) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(value));
    const body = (req, limit = 256 * 1024) =>
        new Promise((resolve, reject) => {
            const chunks = [];
            let size = 0;
            req.on("data", (c) => {
                size += c.length;
                if (size > limit) {
                    reject(new Error("too large"));
                    req.destroy();
                } else chunks.push(c);
            });
            req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
            req.on("error", reject);
        });

    const server = https.createServer({ key, cert }, async (req, res) => {
        const u = new URL(req.url ?? "/", "https://phone");
        const paired = u.searchParams.get("k") === token;
        try {
            if (u.pathname === "/" || u.pathname === "/phone") {
                if (!paired) return res.writeHead(403, { "Content-Type": "text/html" }).end(NOT_PAIRED);
                return res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" }).end(PAGE);
            }
            if (req.method === "GET" && (u.pathname === "/phone/phone.js" || u.pathname === "/phone/phone.js.map")) {
                return serveFile(req, res, path.join(bundleDir, u.pathname.slice("/phone/".length)));
            }
            if (u.pathname === "/phone/offer" && req.method === "POST") {
                if (!paired) return json(res, 403, { error: "not paired — scan the QR code again" });
                const page = [...pages].at(-1);
                if (!page) return json(res, 409, { error: "The recording page isn't open on the Mac." });
                const { sdp } = JSON.parse(await body(req));
                if (typeof sdp !== "string") return json(res, 400, { error: "sdp?" });
                const id = randomUUID();
                const answer = new Promise((resolve) => {
                    const timer = setTimeout(() => resolve(null), 15000);
                    waiting.set(id, (value) => {
                        clearTimeout(timer);
                        resolve(value);
                    });
                });
                send(page, { type: "offer", id, sdp });
                const sdpAnswer = await answer;
                waiting.delete(id);
                return sdpAnswer ? json(res, 200, { sdp: sdpAnswer }) : json(res, 504, { error: "The recording page did not answer." });
            }
            return res.writeHead(404).end("not found");
        } catch (err) {
            return json(res, 500, { error: String(err instanceof Error ? err.message : err) });
        }
    });
    server.on("error", (err) => console.error(`  The phone camera is off: ${err.message}`));
    server.listen(port, "0.0.0.0");

    /** The recording page's side, mounted on its localhost server. */
    async function handle(req, res, pathname) {
        if (pathname === "/api/phone" && req.method === "GET") {
            return json(res, 200, { url, listening: pages.size > 0 });
        }
        if (pathname === "/api/phone/qr.svg" && req.method === "GET") {
            if (!url) return res.writeHead(404).end();
            return res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" }).end(renderSVG(url, { border: 2, whiteColor: "#FFFFFF", blackColor: "#000000" }));
        }
        if (pathname === "/api/phone/events" && req.method === "GET") {
            res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
            res.write(": hello\n\n");
            pages.add(res);
            const beat = setInterval(() => res.write(": beat\n\n"), 15000);
            req.on("close", () => {
                clearInterval(beat);
                pages.delete(res);
            });
            return true;
        }
        if (pathname === "/api/phone/answer" && req.method === "POST") {
            const { id, sdp } = JSON.parse(await body(req));
            const resolve = waiting.get(id);
            if (!resolve || typeof sdp !== "string") return json(res, 404, { error: "no such offer (it timed out?)" });
            resolve(sdp);
            return json(res, 200, { ok: true });
        }
        return false;
    }

    function banner() {
        if (!url) {
            console.log("  Phone camera: no network address found — connect the Mac to Wi-Fi and restart.\n");
            return;
        }
        console.log(`  Phone camera (same Wi-Fi): pick "Phone" as the camera on the page, or scan:\n`);
        console.log(renderUnicodeCompact(url, { border: 1 }).replace(/^/gm, "    "));
        console.log(`\n    ${url}`);
        console.log(`    First time: Chrome warns about the certificate → Advanced → Proceed.\n`);
    }

    return { handle, banner, url };
}
