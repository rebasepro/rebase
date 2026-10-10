import { Hono, type Context, type MiddlewareHandler } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import * as path from "path";
import * as fs from "fs";
import fsp from "node:fs/promises";
import zlib from "node:zlib";
import { COMPRESSIBLE_CONTENT_TYPE_REGEX } from "hono/compress";
import { getMimeType } from "hono/utils/mime";
import { responseCompression } from "./utils/compression.js";
import { logger } from "./utils/logger.js";
import { STATIC_APP_CSP } from "./boot/security-headers.js";

/**
 * Configuration for serving a Single Page Application
 */
export interface ServeSPAConfig {
    /**
     * Absolute path to the frontend build directory
     * @example path.join(__dirname, "../../frontend/dist")
     */
    frontendPath: string;

    /**
     * Public base path this app is served under (default: "/").
     *
     * No trailing slash unless it *is* "/". Several apps run in one process,
     * each under its own prefix — a site at "/" and an admin at "/admin" — so
     * both the asset middleware and the SPA fallback are scoped here rather
     * than claiming "/*" globally.
     *
     * The assets must have been *built* for this path too; see
     * `assertBuiltForPath` in the CLI.
     */
    basePath?: string;

    /**
     * Base path for API routes (default: "/api")
     * Requests to this path will be passed through to API handlers
     */
    apiBasePath?: string;

    /**
     * Additional paths to exclude from SPA handling
     * These paths will be passed through to other handlers
     *
     * When several apps share a process, the "/"-rooted one must list its
     * siblings here. Mount order alone is not enough: a request to "/admin/x"
     * that misses the admin's files would otherwise fall through to the root
     * app's catch-all and be answered with the *site's* index.html under the
     * admin's URL — which reads as an admin bug for a long time.
     *
     * Each entry excludes a path *segment*, not a string prefix: "/admin"
     * excludes "/admin" and "/admin/x" but not "/administrators", which is an
     * ordinary route of the app rooted at "/".
     *
     * @example ["/health", "/ws", "/metrics", "/admin"]
     */
    excludePaths?: string[];

    /**
     * Index file to serve for SPA routes (default: "index.html")
     */
    indexFile?: string;

    /**
     * Serve index.html for unmatched paths under `basePath` (default: true).
     *
     * `false` registers the asset middleware only, for a static *site* whose
     * generator emitted a real file per route.
     */
    spa?: boolean;

    /**
     * Whether this app answers a request under `basePath` at all (default:
     * every one).
     *
     * For apps told apart by hostname as well as by path, which `excludePaths`
     * cannot express: two apps can both be rooted at "/", one on
     * `admin.example.com` and one on every other hostname, and no list of paths
     * says which of them a request belongs to. The caller, which sees every
     * app, decides; each mount asks. A request this returns `false` for passes
     * through everything the mount registers — assets, caching, compression and
     * the fallback alike — as if the mount were not there, because an app that
     * declined the fallback but still served its files would answer the other
     * app's hostname with its own `/assets/*`.
     */
    owns?: (request: StaticAppRequest) => boolean;
}

/** What {@link ServeSPAConfig.owns} is asked about. */
export interface StaticAppRequest {
    /**
     * The `Host` the request named, exactly as sent: any case, and possibly
     * with a port or a trailing dot. The request URL's host when the header is
     * absent, as it is on a request built in-process.
     *
     * Never `X-Forwarded-Host`. The proxy in front of the runtime passes the
     * original `Host` through, and a forwarded header is one any client can
     * write — reading it would let a request for the site choose the admin.
     */
    host: string;
    /** The request path, as routed. */
    path: string;
}

/**
 * A request path that must never reach the static file server.
 *
 * Two shapes, and both were answering 200.
 *
 * **Dot-segments.** A build directory is not only the build: it is a directory
 * on a disk, and in a self-host it is very often the project checkout or
 * something beside it. `serveStatic` will happily answer for `/.env` and
 * `/.git/config` because they are files under the root it was given, and the
 * one thing that distinguishes them from `/assets/app.js` is the leading dot
 * that every convention uses to mean "not content". A build has no legitimate
 * dot-file to serve — `.well-known` is the one exception people reach for, and
 * it is mounted as its own route rather than fished out of the SPA build.
 *
 * **Encoded traversal.** `%2e%2e%2f` decodes to `../` after routing, so a
 * check on the raw path misses it while the file server does not. The path is
 * decoded first and then judged.
 */
function isForbiddenStaticPath(requestPath: string): boolean {
    let decoded = requestPath;
    try {
        decoded = decodeURIComponent(requestPath);
    } catch {
        // A path that is not valid percent-encoding is not a path to a build
        // artifact either.
        return true;
    }
    return decoded.split(/[/\\]/).some(segment => segment.startsWith("."));
}

/**
 * Is the file this path names actually inside the build directory?
 *
 * `serveStatic` joins and reads, and a symlink inside the build resolves
 * wherever it points — so a `node_modules` symlink, or a `public/` that a
 * build tool linked to somewhere else, becomes a way out of the directory
 * being served. Containment is asked of the RESOLVED path, because that is the
 * file that would be read.
 *
 * A path that does not resolve is not refused here: it does not exist, and
 * `serveStatic` answering 404 for it is the right outcome and a cheaper one.
 */
async function resolvesInsideBuild(buildRoot: BuildRoot, frontendPath: string, relativePath: string): Promise<boolean> {
    try {
        const target = await fsp.realpath(path.join(frontendPath, relativePath));
        const inside = (root: string) => target === root || target.startsWith(root + path.sep);
        // A refusal is never made against a remembered root: it is asked again.
        return inside(await buildRoot.resolve()) || inside(await buildRoot.resolve({ fresh: true }));
    } catch {
        return true;
    }
}

/** The build directory's real path, for {@link resolvesInsideBuild}. */
interface BuildRoot {
    resolve(options?: { fresh?: boolean }): Promise<string>;
}

/**
 * The build root's real path, resolved once where that is safe.
 *
 * Every static request resolved it, although it is the one path in the check
 * that does not depend on the request. Remembered only when the build path
 * holds no symlink at mount — resolving to itself — because the deploy
 * pattern that does flip a symlink (`current -> releases/N`) moves the root
 * under a running server, and such a root is resolved per request as before.
 * A failed resolve is not remembered.
 */
function buildRootOf(frontendPath: string): BuildRoot {
    const absolute = path.resolve(frontendPath);
    let stable: boolean | undefined;
    let remembered: Promise<string> | undefined;
    const resolveNow = () => fsp.realpath(frontendPath);
    return {
        resolve({ fresh = false } = {}) {
            if (fresh || stable === false) return resolveNow();
            remembered ??= resolveNow().then(
                (real) => {
                    stable = real === absolute;
                    if (!stable) remembered = undefined;
                    return real;
                },
                (error: unknown) => {
                    remembered = undefined;
                    throw error;
                }
            );
            return remembered;
        }
    };
}

/**
 * Does the build hold any precompressed sibling (`.br`, `.gz`, `.zst`)?
 *
 * Asked once at mount, so `serveStatic` looks for siblings only in a build
 * that has them. With `precompressed` on it `statSync`s all three beside every
 * file, each a throw-and-catch on the event loop, for files no build of ours
 * emits. Bounded: past a few thousand entries the answer is "maybe", which
 * keeps the per-request lookup — what every mount did before. Dot-directories
 * and `node_modules` are not build output; a symlinked directory is not
 * followed. Siblings written after the mount are not seen, and those files are
 * then compressed on the fly instead: the same bytes, at a CPU cost.
 */
function buildHasPrecompressedFiles(frontendPath: string, budget = 5000): boolean {
    const pending = [frontendPath];
    let seen = 0;
    while (pending.length > 0) {
        const dir = pending.pop() as string;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (++seen > budget) return true;
            if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
            if (entry.isDirectory()) pending.push(path.join(dir, entry.name));
            else if (/\.(?:br|gz|zst)$/.test(entry.name)) return true;
        }
    }
    return false;
}

/**
 * A request path as `serveStatic` reads it — `decodeURI`, falling back per
 * escape — or `null` where `serveStatic` refuses it. Mirrored so the file the
 * validators below describe is the file `serveStatic` would send.
 */
function decodeStaticPath(requestPath: string): string | null {
    let decoded: string;
    try {
        decoded = decodeURI(requestPath);
    } catch {
        decoded = requestPath.replace(/(?:%[0-9A-Fa-f]{2})+/g, (escape) => {
            try {
                return decodeURI(escape);
            } catch {
                return escape;
            }
        });
    }
    return /(?:^|[/\\])\.{1,2}(?:$|[/\\])|[/\\]{2,}|\\/.test(decoded) ? null : decoded;
}

/** The file a static request maps to, and its validators. */
interface StaticFile {
    path: string;
    size: number;
    mtimeMs: number;
    etag: string;
    lastModified: string;
}

/**
 * A weak validator from size and modification time — what changes when a
 * file is rewritten or rebuilt. Weak because the gzip and identity bodies of
 * one file share it, as Hono's `compress` makes a strong one weak.
 */
function weakETag(size: number, mtimeMs: number): string {
    return `W/"${size.toString(16)}-${Math.trunc(mtimeMs).toString(16)}"`;
}

async function statStaticFile(filePath: string): Promise<StaticFile | null> {
    try {
        let resolved = filePath;
        let stats = await fsp.stat(resolved);
        // A directory serves its index.html, as `serveStatic` does.
        if (stats.isDirectory()) {
            resolved = path.join(resolved, "index.html");
            stats = await fsp.stat(resolved);
        }
        if (!stats.isFile()) return null;
        return {
            path: resolved,
            size: stats.size,
            mtimeMs: stats.mtimeMs,
            etag: weakETag(stats.size, stats.mtimeMs),
            lastModified: stats.mtime.toUTCString()
        };
    } catch {
        return null;
    }
}

/**
 * Whether the client's copy is current: `If-None-Match` (weak comparison) if
 * it sent one, else `If-Modified-Since` at the second resolution
 * `Last-Modified` carries. RFC 9110 §13.1.
 */
function isNotModified(c: Context, etag: string, mtimeMs: number): boolean {
    const ifNoneMatch = c.req.header("if-none-match");
    if (ifNoneMatch !== undefined) {
        const opaque = etag.replace(/^W\//, "");
        return ifNoneMatch.split(",").some((tag) => {
            const trimmed = tag.trim();
            return trimmed === "*" || trimmed.replace(/^W\//, "") === opaque;
        });
    }
    const ifModifiedSince = c.req.header("if-modified-since");
    if (ifModifiedSince === undefined) return false;
    const since = Date.parse(ifModifiedSince);
    return !Number.isNaN(since) && Math.floor(mtimeMs / 1000) * 1000 <= since;
}

/** The 304 for {@link isNotModified}: the validators, and no body. */
function notModified(c: Context, file: { etag: string; lastModified: string }): Response {
    return c.body(null, 304, {
        ETag: file.etag,
        "Last-Modified": file.lastModified,
        Vary: "Accept-Encoding"
    });
}

/**
 * Would Hono's `compress` pick gzip for this `Accept-Encoding`? Its rule,
 * restated: of gzip and deflate, the first with q=1, else the higher q above 0.
 */
function negotiatesGzip(acceptEncoding: string | undefined): boolean {
    if (!acceptEncoding) return false;
    const q = new Map<string, number>();
    for (const part of acceptEncoding.split(",")) {
        const [name, ...params] = part.split(";").map((piece) => piece.trim());
        const weight = params.find((param) => /^q=/i.test(param));
        const value = weight === undefined ? 1 : Number(weight.slice(2));
        q.set(name.toLowerCase(), Number.isFinite(value) ? value : 1);
    }
    const wildcard = q.get("*");
    const gzip = q.get("gzip") ?? wildcard ?? 0;
    const deflate = q.get("deflate") ?? wildcard ?? 0;
    if (gzip === 1) return true;
    return gzip > 0 && deflate !== 1 && gzip >= deflate;
}

/**
 * Gzipped content-hashed build files, so each is compressed once per process
 * rather than once per visitor.
 *
 * Key: the file's path, size and modification time — a file rewritten under
 * the same name (a rebuild in place) is a new entry, and a hashed name changes
 * with its bytes anyway. These are public build artifacts, the same bytes for
 * every caller of a mount, so nothing request- or user-specific is stored.
 * Bounded by compressed bytes, least recently used first out; a file larger
 * than {@link COMPRESSED_ASSET_MAX_SOURCE} is left to on-the-fly compression.
 * Same zlib default level as `CompressionStream`.
 */
const COMPRESSED_ASSET_BUDGET = 32 * 1024 * 1024;
const COMPRESSED_ASSET_MAX_SOURCE = 8 * 1024 * 1024;
const COMPRESSION_THRESHOLD = 1024;
const compressedAssets = new Map<string, Uint8Array<ArrayBuffer>>();
const compressingAssets = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();
let compressedAssetBytes = 0;

function gzippedAsset(file: StaticFile): Promise<Uint8Array<ArrayBuffer>> {
    const key = `${file.path}\0${file.size}\0${file.mtimeMs}`;
    const hit = compressedAssets.get(key);
    if (hit) {
        compressedAssets.delete(key);
        compressedAssets.set(key, hit);
        return Promise.resolve(hit);
    }
    let pending = compressingAssets.get(key);
    if (!pending) {
        pending = (async () => {
            const source = await fsp.readFile(file.path);
            const gzipped = await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) =>
                zlib.gzip(source, (error, result) => error ? reject(error) : resolve(result)));
            // Rewritten between the stat and the read: serve what was read,
            // but do not file it under the old size and time.
            if (source.byteLength === file.size) {
                compressedAssets.set(key, gzipped);
                compressedAssetBytes += gzipped.byteLength;
                for (const [oldest, bytes] of compressedAssets) {
                    if (compressedAssetBytes <= COMPRESSED_ASSET_BUDGET) break;
                    compressedAssets.delete(oldest);
                    compressedAssetBytes -= bytes.byteLength;
                }
            }
            return gzipped;
        })().finally(() => compressingAssets.delete(key));
        compressingAssets.set(key, pending);
    }
    return pending;
}

/**
 * Is `requestPath` the path `prefix`, or something beneath it?
 *
 * Segment-aware on purpose. A plain `startsWith` reads "/api" as excluding
 * "/apidocs", and "/admin" as excluding "/administrators" — both ordinary
 * client-side routes of the app rooted at "/", both then answered with a 404
 * because the SPA fallback declined them and nothing else claims the path.
 * `apiBasePath` is always in the exclusion list, so this reached single-app
 * setups too, not just the multi-app ones the list was added for.
 *
 * Exported because deciding which app owns a request asks the same question of
 * each app's own path, and two readings of "under" would disagree at exactly
 * the boundary this exists for.
 */
export function isUnderPath(requestPath: string, prefix: string): boolean {
    // "/" would exclude everything below it, which is every request.
    const trimmed = prefix.replace(/\/+$/, "");
    if (trimmed === "") return true;
    return requestPath === trimmed || requestPath.startsWith(`${trimmed}/`);
}

/**
 * The paths of the apps nested inside the one at `basePath` — what its SPA
 * fallback must leave to them, as `excludePaths`.
 *
 * Only those beneath it. Every other app's path used to be excluded, ancestors
 * included, and an app at `/admin/beta` beside one at `/admin` then declined
 * every deep link it had: each is under "/admin". The enclosing app declined
 * them too, as it should, and a URL two apps were mounted for answered 404. An
 * ancestor's path can never be right here — anything that reaches this app's
 * fallback is under it — and an unrelated app's path can never match, so the
 * apps beneath are the whole list.
 */
export function nestedAppPaths(basePath: string, otherPaths: readonly string[]): string[] {
    return otherPaths.filter(other => other !== basePath && isUnderPath(other, basePath));
}

/**
 * Extensions a build emits, never a client-side route.
 *
 * An allowlist rather than "does the last segment contain a dot": entity routes
 * carry ids, and an id is often an email or a dotted slug, so a generic
 * extension test answers `/c/users/ada@example.com` with a 404.
 */
const ASSET_EXTENSIONS = new Set([
    "js", "mjs", "cjs", "css", "map", "wasm",
    "png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "ico", "bmp",
    "woff", "woff2", "ttf", "otf", "eot",
    "mp3", "mp4", "webm", "ogg", "wav"
]);

/**
 * Is this request for a build artifact rather than a client-side route?
 *
 * It matters because of what the fallback would otherwise do. A tab opened
 * before a deploy still holds the previous entry chunk, so the first lazy view
 * it opens fetches a content hash that no longer exists; answering that with
 * index.html hands the browser HTML where it asked for a module, and the error
 * it reports ("Failed to fetch dynamically imported module: …") names the chunk
 * and nothing else — it reads as a broken build, not as a stale tab, and a 404
 * would have said so. Serving HTML for a missing asset also poisons any cache
 * sitting in front of the origin with an HTML body under a .js URL.
 *
 * `Sec-Fetch-Dest` catches the extensionless cases browsers still label for us;
 * a missing header (curl, a health probe, an old browser) falls back to the
 * extension, and so keeps answering navigations with the app.
 */
function isAssetRequest(requestPath: string, destination: string | undefined): boolean {
    if (destination && destination !== "document" && destination !== "iframe" && destination !== "frame") {
        return true;
    }
    const lastSegment = requestPath.slice(requestPath.lastIndexOf("/") + 1);
    const dot = lastSegment.lastIndexOf(".");
    if (dot <= 0) return false;
    return ASSET_EXTENSIONS.has(lastSegment.slice(dot + 1).toLowerCase());
}

/**
 * Does this filename carry a content hash, and may it therefore be cached forever?
 *
 * The two answers a build needs are opposites, and picking wrong in either
 * direction is a real bug. A hashed chunk (`index-vgugiqRO.js`) can be
 * `immutable` for a year because a new build gives it a new URL. `index.html`
 * cannot be cached at all: it is the document naming those hashed chunks, so a
 * cached copy pins a tab to the previous deploy's filenames, which the new build
 * no longer contains — the page dies on a 404 for a chunk, and the user has no
 * way to know a reload is what they need.
 *
 * Erring toward "not hashed" is therefore the safe direction: the cost is a
 * revalidation that usually answers 304, against serving a year-stale file with
 * no way to recall it. So this demands positive evidence of a hash rather than
 * assuming one — a segment of 8+ characters after the last `-` that is not
 * ordinary lowercase prose. Vite and Rollup emit base64url digests, which
 * essentially always carry a digit or a capital; a hand-written
 * `vendor-analytics.js` does not, and gets revalidated.
 *
 * Deliberately not "everything under /assets/": that is a Vite convention, not a
 * guarantee, and a build that drops an unhashed file there would have it pinned
 * in every visitor's cache for a year with no way to correct it.
 */
function isContentHashed(requestPath: string): boolean {
    const lastSegment = requestPath.slice(requestPath.lastIndexOf("/") + 1);
    const dot = lastSegment.lastIndexOf(".");
    if (dot <= 0) return false;

    const stem = lastSegment.slice(0, dot);
    const dash = stem.lastIndexOf("-");
    if (dash < 0) return false;

    const suffix = stem.slice(dash + 1);
    if (suffix.length < 8) return false;
    if (!/^[A-Za-z0-9_-]+$/.test(suffix)) return false;
    return /[0-9A-Z]/.test(suffix);
}

/** A year, and never revalidated: the URL changes when the bytes do. */
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

/**
 * Store it, but check before using it. Not `no-store`: revalidation answers 304
 * on an unchanged document, which is cheaper than re-sending it, and correctness
 * here needs freshness rather than absence.
 */
const REVALIDATE_CACHE = "no-cache";

/**
 * Serve a Single Page Application from an Hono app.
 *
 * @internal Not part of the stable public API. Exported only because the
 * entrypoint `rebase eject` writes
 * (`packages/cli/templates/eject/backend/src/index.ts`) and `app/backend/src/index.ts`
 * call it to serve the built frontend in production — the scaffolded template
 * has no entrypoint of its own. Its request-handling behavior is an
 * implementation detail and may change without a major version bump.
 */
export function serveSPA<E extends import("hono").Env>(app: Hono<E>, config: ServeSPAConfig): void {
    const {
        frontendPath,
        apiBasePath = "/api",
        excludePaths = [],
        indexFile = "index.html",
        spa = true
    } = config;

    // "/admin/" and "/admin" must not be two different mounts.
    const rawBase = config.basePath ?? "/";
    const basePath = rawBase !== "/" ? rawBase.replace(/\/+$/, "") : "/";
    const isRoot = basePath === "/";

    // Validate frontend path exists.
    //
    // NOTE: this warns and disables itself rather than throwing, so a wrong path
    // leaves the API answering perfectly while the site 404s. Verify a mount by
    // fetching it, never by reading the logs.
    if (!fs.existsSync(frontendPath)) {
        logger.warn(`⚠️ Frontend build path does not exist: ${frontendPath}`);
        logger.warn("   SPA serving is disabled. Build your frontend first.");
        return;
    }

    // Scoped to this app's prefix. Registering at "/*" would mean one process
    // could serve exactly one SPA — and, worse, the first one registered would
    // silently answer for every app mounted after it.
    const scope = isRoot ? "/*" : `${basePath}/*`;

    // Every middleware below asks this first. The `Host` header rather than the
    // URL wherever there is one, because that is the value the proxy in front
    // passed through; the URL is the fallback for a request built in-process,
    // which may carry no header at all.
    const { owns } = config;
    const declines = (c: Context): boolean => owns !== undefined && !owns({
        host: c.req.header("host") ?? new URL(c.req.url).host,
        path: c.req.path
    });
    // Paths under this app's scope that are not the app's: the API, the
    // probes, sibling apps. The SPA fallback steps aside for them, and the
    // app's own headers stay off them.
    const allExcludePaths = [apiBasePath, ...excludePaths];
    const isExcludedFromApp = (requestPath: string): boolean =>
        allExcludePaths.some(p => isUnderPath(requestPath, p));
    // A third-party middleware cannot ask for itself. Returned as it came when
    // there is no `owns`, so a mount without one registers exactly what it
    // always has.
    const unlessDeclined = (handler: MiddlewareHandler): MiddlewareHandler => owns === undefined
        ? handler
        : async (c, next) => declines(c) ? next() : handler(c, next);

    // Compress the bundle. The API is compressed by `configureMiddlewares`, but
    // that is scoped to the API base path — static assets are served here, and
    // the JS bundle is the single largest thing most apps ship.
    //
    // Registered before serveStatic so it wraps it. `precompressed` takes
    // priority where the build emitted .br/.gz siblings: those cost no CPU and
    // give brotli, and set Content-Encoding themselves, which makes the
    // compression middleware skip them.
    // Cache-Control, for everything this mount answers — the static middleware
    // below and the SPA fallback at the end alike.
    //
    // Registered first so its post-`next` half runs last, after the response
    // exists and after compression has had its say. Without this, nothing here
    // set the header at all: `app.rebase.pro` served `index.html` with no
    // `Cache-Control`, which leaves browsers applying *heuristic* freshness —
    // a fraction of the document's age, decided per browser, unbounded by
    // anything the server said. A tab could therefore hold a deploy-old
    // document naming chunks that no longer exist, and the only cure was a
    // hard reload that nobody knows to perform.
    //
    // An explicit header already on the response wins: a route that has thought
    // about its own caching knows more than a default does.
    app.use(scope, async (c, next) => {
        if (declines(c)) return next();
        await next();
        // The app's pages, not the API or the probes that share the scope of
        // an app at "/". An explicit policy already on the response wins, as
        // an explicit Cache-Control does below.
        if (!isExcludedFromApp(c.req.path) && !c.res.headers.has("content-security-policy")) {
            c.header("Content-Security-Policy", STATIC_APP_CSP);
        }
        if (c.res.headers.has("cache-control")) return;
        // 404s and redirects are not the build's artifacts to cache. A 304
        // repeats the 200's policy, as RFC 9110 §15.4.5 asks.
        if (c.res.status !== 200 && c.res.status !== 304) return;
        c.header("Cache-Control", isContentHashed(c.req.path) ? IMMUTABLE_CACHE : REVALIDATE_CACHE);
    });

    const buildRoot = buildRootOf(frontendPath);
    const precompressed = buildHasPrecompressedFiles(frontendPath);

    // Before `serveStatic`, because it is what `serveStatic` will otherwise
    // answer. See {@link isForbiddenStaticPath} and {@link resolvesInsideBuild}.
    app.use(scope, async (c, next) => {
        if (declines(c)) return next();
        const requestPath = isRoot ? c.req.path : (c.req.path.slice(basePath.length) || "/");

        if (isForbiddenStaticPath(requestPath)) {
            return c.text("Not found", 404);
        }
        if (!await resolvesInsideBuild(buildRoot, frontendPath, "." + requestPath)) {
            logger.warn(
                `[static] Refused ${c.req.path}: it resolves outside the build directory ` +
                `(${frontendPath}). A symlink in a build is a way out of it.`
            );
            return c.text("Not found", 404);
        }

        return next();
    });

    // Validators, and the kept gzip of hashed chunks — for a request that maps
    // to a file of the build. After the containment check above, before
    // compression and `serveStatic`: a 304 and a kept gzip need neither.
    //
    //  - `ETag` (weak, size + mtime) on what `serveStatic` sends, and a 304 when
    //    the client already holds it. `serveStatic` sets `Last-Modified` but
    //    never reads `If-Modified-Since`, and sends no ETag.
    //  - A content-hashed, compressible file of 1 KB or more, asked for in
    //    full by a client that negotiates gzip, in a build without
    //    precompressed siblings: its gzip from {@link gzippedAsset}, with a
    //    `Content-Length`, instead of `CompressionStream` on every request.
    app.use(scope, async (c, next) => {
        if (declines(c) || (c.req.method !== "GET" && c.req.method !== "HEAD")) return next();
        const decoded = decodeStaticPath(c.req.path);
        if (decoded === null) return next();
        const relative = isRoot ? decoded : (decoded.slice(basePath.length) || "/");
        const file = await statStaticFile(path.join(frontendPath, relative));
        if (!file) return next();

        if (isNotModified(c, file.etag, file.mtimeMs)) return notModified(c, file);

        const mimeType = getMimeType(file.path);
        if (
            c.req.method === "GET" && !precompressed && !c.req.header("range")
            && isContentHashed(relative) && mimeType !== undefined && COMPRESSIBLE_CONTENT_TYPE_REGEX.test(mimeType)
            && file.size >= COMPRESSION_THRESHOLD && file.size <= COMPRESSED_ASSET_MAX_SOURCE
            && negotiatesGzip(c.req.header("accept-encoding"))
        ) {
            let gzipped: Uint8Array<ArrayBuffer> | undefined;
            try {
                gzipped = await gzippedAsset(file);
            } catch {
                // Gone or unreadable since the stat: `serveStatic` decides.
            }
            if (gzipped) {
                return c.body(gzipped, 200, {
                    "Content-Type": mimeType,
                    "Content-Encoding": "gzip",
                    "Content-Length": String(gzipped.byteLength),
                    Vary: "Accept-Encoding",
                    "Last-Modified": file.lastModified,
                    ETag: file.etag
                });
            }
        }

        await next();
        // Only on the response `serveStatic` built from this same file — it
        // stamps the same `Last-Modified` — never on a fallback that answered
        // instead, nor on a precompressed sibling's.
        if (c.res.status === 200 && !c.res.headers.has("etag")
            && c.res.headers.get("last-modified") === file.lastModified) {
            c.res.headers.set("ETag", file.etag);
        }
    });

    app.use(scope, unlessDeclined(responseCompression()));
    app.use(scope, unlessDeclined(serveStatic({
        root: path.relative(process.cwd(), frontendPath),
        // Only where the build has siblings to find; see buildHasPrecompressedFiles.
        precompressed,
        // The prefix is a serving concern, not a directory: `/admin/assets/x.js`
        // lives at `<adminBuild>/assets/x.js`.
        ...(isRoot ? {} : { rewriteRequestPath: (p: string) => p.slice(basePath.length) || "/" })
    })));

    if (!spa) {
        logger.info(`✅ Static serving enabled at ${basePath} from: ${frontendPath}`);
        return;
    }


    // Cache the index.html content to avoid re-reading from disk on every navigation request.
    // Its validators are those of the file it was read from — the same ones `/`
    // carries when `serveStatic` answers it — taken when it is read, so a
    // deep link revalidates to a 304 like any file.
    let cachedHtml: string | null = null;
    let cachedHtmlFile: StaticFile | null = null;

    // SPA fallback - serve index.html for all non-excluded routes under basePath.
    //
    // Middleware that answers only GET and HEAD, not `app.get(scope)`. A route
    // is visible in `c.req.matchedRoutes` whether it answered or declined, and
    // `installUnmatchedApiEnvelope` reads a matched non-middleware route as "a
    // handler answered this". `app.get("/*")` matches every GET — the `/api/*`
    // paths it declines included — so with an app at "/" an unknown `GET /api/x`
    // kept Hono's `text/plain` 404 while `POST /api/x` got the JSON envelope.
    app.use(scope, async (c, next) => {
        if (c.req.method !== "GET" && c.req.method !== "HEAD") return next();
        // Skip excluded paths (API, health checks, sibling apps), and requests
        // another app owns.
        if (declines(c) || isExcludedFromApp(c.req.path)) {
            return next();
        }

        // The static middleware above already declined it, so a request that
        // asks for a build artifact is asking for one this build does not have.
        // 404 is both the honest answer and the legible one.
        if (isAssetRequest(c.req.path, c.req.header("sec-fetch-dest"))) {
            return c.text("Not found", 404);
        }

        const indexPath = path.join(frontendPath, indexFile);

        if (!cachedHtml) {
            try {
                cachedHtmlFile = await statStaticFile(indexPath);
                cachedHtml = await fsp.readFile(indexPath, "utf-8");
            } catch {
                logger.warn(`⚠️ Index file not found: ${indexPath}`);
                return next();
            }
        }

        if (cachedHtmlFile) {
            if (isNotModified(c, cachedHtmlFile.etag, cachedHtmlFile.mtimeMs)) return notModified(c, cachedHtmlFile);
            c.header("ETag", cachedHtmlFile.etag);
            c.header("Last-Modified", cachedHtmlFile.lastModified);
        }
        return c.html(cachedHtml);
    });

    logger.info(`✅ SPA serving enabled at ${basePath} from: ${frontendPath}`);
}

