import { isLocalhostOrigin, loadBootEnv, resolveCorsOrigin, resolveEnableSwagger } from "../src/boot/env";
import type { RebaseBootEnv } from "../src/boot/env";
import { MetricsRegistry, classifySurface } from "../src/metrics";

function env(overrides: Partial<RebaseBootEnv>): RebaseBootEnv {
    return { NODE_ENV: "development", ...overrides } as RebaseBootEnv;
}

/**
 * CORS is the one piece of boot configuration where a permissive mistake is
 * silent and serious: credentials are enabled, so reflecting an arbitrary origin
 * lets any site the developer visits make authenticated requests with their
 * session and read the responses.
 */
describe("resolveCorsOrigin", () => {
    it("reflects only localhost in development", () => {
        const origin = resolveCorsOrigin(env({ NODE_ENV: "development" }));

        expect(origin("http://localhost:5173")).toBe("http://localhost:5173");
        expect(origin("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
        expect(origin("https://evil.example.com")).toBeNull();
    });

    it("allows a request with no Origin in development", () => {
        // curl, same-origin and server-to-server calls send no Origin header.
        expect(resolveCorsOrigin(env({ NODE_ENV: "development" }))("")).toBe("*");
    });

    /**
     * `CORS_ORIGINS` used to be read only in production, so setting it in
     * development did nothing — and development is where it is most often
     * needed: a phone on the LAN, an ngrok tunnel, a forwarded Codespaces port.
     * All non-localhost, all refused, with the variable that names the fix
     * having no effect.
     */
    it("adds CORS_ORIGINS to localhost in development rather than ignoring it", () => {
        const origin = resolveCorsOrigin(env({
            NODE_ENV: "development",
            CORS_ORIGINS: "http://192.168.1.5:5173"
        }));

        expect(origin("http://192.168.1.5:5173")).toBe("http://192.168.1.5:5173");
        // Localhost still works without being listed…
        expect(origin("http://localhost:5173")).toBe("http://localhost:5173");
        // …and an origin that is neither is still refused. Credentials are on,
        // so reflecting an arbitrary Origin would hand any site the developer
        // visits their dev session.
        expect(origin("https://evil.example.com")).toBeNull();
    });

    it("reads FRONTEND_URL in development too", () => {
        const origin = resolveCorsOrigin(env({
            NODE_ENV: "development",
            FRONTEND_URL: "http://192.168.1.5:5173"
        }));

        expect(origin("http://192.168.1.5:5173")).toBe("http://192.168.1.5:5173");
    });

    it("names the variable that would allow a refused origin, once", () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => { /* capture */ });
        try {
            const origin = resolveCorsOrigin(env({ NODE_ENV: "development" }));
            origin("http://192.168.1.5:5173");
            origin("http://192.168.1.5:5173");

            // A refused preflight is retried on every request; one line is the
            // fix, a line per request is noise that buries it.
            expect(warn).toHaveBeenCalledTimes(1);
            expect(String(warn.mock.calls[0][0])).toContain("CORS_ORIGINS=http://192.168.1.5:5173");
        } finally {
            warn.mockRestore();
        }
    });

    it("serves an explicit allow-list in production and nothing else", () => {
        const origin = resolveCorsOrigin(env({
            NODE_ENV: "production",
            CORS_ORIGINS: "https://app.example.com, https://admin.example.com"
        }));

        expect(origin("https://app.example.com")).toBe("https://app.example.com");
        expect(origin("https://admin.example.com")).toBe("https://admin.example.com");
        expect(origin("https://evil.example.com")).toBeNull();
        // Localhost is not special in production.
        expect(origin("http://localhost:5173")).toBeNull();
    });

    it("falls back to FRONTEND_URL when CORS_ORIGINS is unset", () => {
        const origin = resolveCorsOrigin(env({
            NODE_ENV: "production",
            FRONTEND_URL: "https://app.example.com"
        }));

        expect(origin("https://app.example.com")).toBe("https://app.example.com");
    });

    it("refuses to start production with neither set", () => {
        expect(() => resolveCorsOrigin(env({ NODE_ENV: "production" })))
            .toThrow(/CORS_ORIGINS or FRONTEND_URL/);
    });

    it("rejects a wildcard rather than letting browsers reject every request", () => {
        // `*` with credentials is refused by every browser, so accepting it here
        // would turn a config mistake into an opaque runtime CORS failure.
        expect(() => resolveCorsOrigin(env({ NODE_ENV: "production", CORS_ORIGINS: "*" })))
            .toThrow(/cannot be/);
    });

    it("ignores blank entries in the list", () => {
        const origin = resolveCorsOrigin(env({
            NODE_ENV: "production",
            CORS_ORIGINS: "https://app.example.com,,  ,"
        }));

        expect(origin("https://app.example.com")).toBe("https://app.example.com");
        expect(origin("")).toBeNull();
    });
});

/**
 * This defaulted to a flat `false`, and the runtime is how every scaffolded
 * project boots — so `/api/docs` and `/api/swagger` 404'd for projects that
 * never asked, including the one `rebase init` tells the user to open. The
 * distinction the tests below pin is that "unset" is not "off": it defers to the
 * server's own policy in development and only hard-disables in production.
 */
describe("resolveEnableSwagger", () => {
    it("defers to the server's policy when unset in development", () => {
        // Not `true`. `undefined` is what lets init/docs.ts decide, which is
        // also what withholds the UI while still serving the spec.
        expect(resolveEnableSwagger(env({ NODE_ENV: "development" }))).toBeUndefined();
    });

    it("is off when unset in production", () => {
        // The spec enumerates every collection and field, so an unconfigured
        // production deployment must not publish it.
        expect(resolveEnableSwagger(env({ NODE_ENV: "production" }))).toBe(false);
    });

    it("honours an explicit value in either environment", () => {
        expect(resolveEnableSwagger(env({ NODE_ENV: "production", REBASE_ENABLE_SWAGGER: true }))).toBe(true);
        expect(resolveEnableSwagger(env({ NODE_ENV: "development", REBASE_ENABLE_SWAGGER: false }))).toBe(false);
    });
});

describe("isLocalhostOrigin", () => {
    it.each([
        ["http://localhost:5173", true],
        ["http://127.0.0.1", true],
        ["http://[::1]:3000", true],
        ["https://example.com", false],
        // A hostname that merely *contains* localhost is a different host.
        ["https://localhost.evil.com", false],
        ["not a url", false]
    ])("%s → %s", (origin, expected) => {
        expect(isLocalhostOrigin(origin)).toBe(expected);
    });
});

describe("classifySurface", () => {
    it("names the API surface that served a request", () => {
        expect(classifySurface("/api/data/products").surface).toBe("data");
        expect(classifySurface("/api/auth/login").surface).toBe("auth");
        expect(classifySurface("/api/storage/upload").surface).toBe("storage");
        expect(classifySurface("/api/functions/invoice").surface).toBe("functions");
        expect(classifySurface("/api/meta/contract").surface).toBe("meta");
        expect(classifySurface("/health").surface).toBe("other");
    });

    it("labels the collection but never the entity id", () => {
        // An id per label would create unbounded time series — the classic way
        // to take down a Prometheus.
        const withId = classifySurface("/api/data/products/8f14e45f-ceea-467a-9f8b-1a2b3c4d5e6f");
        expect(withId.collection).toBe("products");

        const listing = classifySurface("/api/data/products");
        expect(listing.collection).toBe("products");
    });

    it("honours a non-default base path", () => {
        expect(classifySurface("/v2/data/products", "/v2")).toMatchObject({
            surface: "data",
            collection: "products"
        });
    });
});

describe("MetricsRegistry", () => {
    it("renders counters and histograms in Prometheus text format", () => {
        const registry = new MetricsRegistry();
        registry.recordRequest({ surface: "data", method: "GET", status: "200" }, 12);
        registry.recordRequest({ surface: "data", method: "GET", status: "200" }, 300);

        const output = registry.render();

        expect(output).toContain('rebase_requests_total{method="GET",status="200",surface="data"} 2');
        expect(output).toContain("rebase_request_duration_ms_count");
        // Cumulative buckets: one request under 25ms, both under 500ms.
        expect(output).toMatch(/rebase_request_duration_ms_bucket\{.*le="25"\} 1/);
        expect(output).toMatch(/rebase_request_duration_ms_bucket\{.*le="500"\} 2/);
        expect(output).toMatch(/rebase_request_duration_ms_bucket\{.*le="\+Inf"\} 2/);
    });

    it("keeps a metric name distinct from its labels", () => {
        // Concatenating name and labels without a separator once made
        // `rebase_x{y="1"}` indistinguishable from a metric named `rebase_xy=1`.
        const registry = new MetricsRegistry();
        registry.incrementCounter("rebase_jobs_total", { queue: "email" }, 3);
        registry.incrementCounter("rebase_jobs_total", { queue: "sms" });
        registry.setGauge("rebase_pool_size", 7, { source: "(default)" });

        const output = registry.render();

        expect(output).toContain('rebase_jobs_total{queue="email"} 3');
        expect(output).toContain('rebase_jobs_total{queue="sms"} 1');
        expect(output).toContain('rebase_pool_size{source="(default)"} 7');
        expect(output).toContain("# TYPE rebase_jobs_total counter");
        expect(output).toContain("# TYPE rebase_pool_size gauge");
    });

    it("escapes label values so a quote cannot break the exposition format", () => {
        const registry = new MetricsRegistry();
        registry.incrementCounter("rebase_odd_total", { label: 'a"b\\c' });

        expect(registry.render()).toContain('rebase_odd_total{label="a\\"b\\\\c"} 1');
    });

    it("always emits process gauges, even with no traffic", () => {
        const output = new MetricsRegistry().render();
        expect(output).toContain("rebase_process_heap_bytes");
        expect(output).toContain("rebase_uptime_seconds");
    });
});

/**
 * The message an operator who forgot a variable actually reads.
 *
 * `loadBootEnv` restates a ZodError as a list of variables, and its "this one
 * is simply missing" branch tested for zod 3's `"Invalid input"` — a string zod
 * 4 never produces. Every missing variable therefore printed the validator's
 * own wording, which says `expected string, received undefined` rather than the
 * one thing the reader needs to know.
 */
describe("loadBootEnv", () => {
    const saved = { ...process.env };

    afterEach(() => {
        for (const key of Object.keys(process.env)) delete process.env[key];
        Object.assign(process.env, saved);
    });

    it("says a missing variable is required, and quotes the rule for a wrong one", () => {
        // Production so that nothing is auto-generated into process.env and no
        // dev-secret file is written beside the test.
        process.env.NODE_ENV = "production";
        process.env.JWT_SECRET = "j".repeat(48);
        process.env.REBASE_SERVICE_KEY = "s".repeat(48);
        process.env.CORS_ORIGINS = "https://app.example.com";
        delete process.env.DATABASE_URL;

        expect(() => loadBootEnv()).toThrow(/DATABASE_URL: is required/);

        // A variable that IS set, and wrong, keeps the rule it broke — "is
        // required" would be a lie there.
        process.env.DATABASE_URL = "not-a-url";
        expect(() => loadBootEnv()).toThrow(/DATABASE_URL must be a valid URL/);
    });
});
