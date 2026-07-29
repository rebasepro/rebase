/**
 * Fetching a bundle at boot.
 *
 * The path a serverless tenant takes on every cold start, which is why the
 * failure cases matter more than the happy one: a partially-unpacked bundle
 * boots into a confusing failure much later — missing collections read as an
 * empty schema, and `REBASE_MIGRATE_ON_BOOT=ensure` then creates nothing and
 * reports success. Failing at the fetch is the only place the error still says
 * what is actually wrong.
 */
import fs from "fs";
import os from "os";
import path from "path";
import {
    fetchBundle,
    shouldFetchBundle,
    bundleRootIn,
    BUNDLE_URL_ENV,
    BUNDLE_TOKEN_ENV
} from "./fetch-bundle";

let scratch: string;

beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-bundle-test-"));
});
afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
});

const URL_ = "https://control-plane.internal/bundles/p1/b1";

/** A fetch that returns the given bytes. */
const okFetch = (body: Uint8Array, capture?: (init: RequestInit) => void) =>
    (async (_url: string, init: RequestInit) => {
        capture?.(init);
        return {
            ok: true,
            status: 200,
            statusText: "OK",
            arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
        } as unknown as Response;
    }) as unknown as typeof fetch;

/** An extractor that writes a manifest, standing in for a real tarball. */
const extractManifest = (nested?: string) => async (_tarball: string, destination: string) => {
    const target = nested ? path.join(destination, nested) : destination;
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "rebase-bundle.json"), JSON.stringify({ kind: "backend" }));
};

describe("shouldFetchBundle", () => {
    it("fetches when given a URL and nothing on disk", () => {
        expect(shouldFetchBundle({ [BUNDLE_URL_ENV]: URL_ } as NodeJS.ProcessEnv)).toBe(true);
    });

    it("does nothing without a URL", () => {
        expect(shouldFetchBundle({} as NodeJS.ProcessEnv)).toBe(false);
    });

    it("lets an explicit bundle path win over a URL", () => {
        // A platform that mounted a bundle AND set a URL is mid-migration
        // between the two, and the local copy is the one that is definitely
        // there. Downloading over it would swap a known-good bundle for a
        // network round trip that can fail.
        expect(shouldFetchBundle({
            [BUNDLE_URL_ENV]: URL_,
            REBASE_BUNDLE: "/bundle"
        } as NodeJS.ProcessEnv)).toBe(false);
    });
});

describe("fetchBundle", () => {
    it("downloads, unpacks, and returns the bundle root", async () => {
        const root = await fetchBundle({
            url: URL_,
            destination: scratch,
            fetchImpl: okFetch(new Uint8Array([1, 2, 3])),
            extract: extractManifest()
        });
        expect(root).toBe(scratch);
        expect(fs.existsSync(path.join(root, "rebase-bundle.json"))).toBe(true);
    });

    it("sends the bearer token when it has one", async () => {
        // The fetch is authenticated by the tenant's service key, which does not
        // expire — the whole reason the platform hands over a stable URL rather
        // than a signed one.
        let init: RequestInit | undefined;
        await fetchBundle({
            url: URL_,
            token: "svc-key",
            destination: scratch,
            fetchImpl: okFetch(new Uint8Array([1]), (i) => { init = i; }),
            extract: extractManifest()
        });
        expect((init?.headers as Record<string, string>)?.authorization).toBe("Bearer svc-key");
    });

    it("sends no authorization header when there is no token", async () => {
        let init: RequestInit | undefined;
        await fetchBundle({
            url: URL_,
            destination: scratch,
            fetchImpl: okFetch(new Uint8Array([1]), (i) => { init = i; }),
            extract: extractManifest()
        });
        expect((init?.headers as Record<string, string>)?.authorization).toBeUndefined();
    });

    it("removes the tarball after unpacking", async () => {
        // A Cloud Run instance's /tmp is a tmpfs, so leaving the archive there
        // costs real memory against the instance limit for its whole life.
        await fetchBundle({
            url: URL_,
            destination: scratch,
            fetchImpl: okFetch(new Uint8Array([1, 2, 3])),
            extract: extractManifest()
        });
        expect(fs.existsSync(path.join(scratch, "bundle.tar.gz"))).toBe(false);
    });

    it("names the status when the download is refused", async () => {
        // The status IS the diagnosis: 401/403 is a bad or missing token, 404 is
        // a bundle garbage-collected out from under a running service.
        const refusing = (async () => ({
            ok: false, status: 403, statusText: "Forbidden",
            arrayBuffer: async () => new ArrayBuffer(0)
        })) as unknown as typeof fetch;

        await expect(fetchBundle({ url: URL_, destination: scratch, fetchImpl: refusing }))
            .rejects.toThrow(/403 Forbidden/);
    });

    it("refuses an empty response", async () => {
        await expect(fetchBundle({
            url: URL_, destination: scratch, fetchImpl: okFetch(new Uint8Array([]))
        })).rejects.toThrow(/empty/);
    });

    it("refuses a tarball that will not unpack", async () => {
        // A truncated download reaches `tar` as a corrupt archive, which is the
        // point of writing the whole file before extracting: a STREAM that dies
        // mid-transfer leaves tar having extracted a prefix and exiting 0.
        await expect(fetchBundle({
            url: URL_,
            destination: scratch,
            fetchImpl: okFetch(new Uint8Array([1, 2, 3])),
            extract: async () => { throw new Error("gzip: unexpected end of file"); }
        })).rejects.toThrow(/could not be unpacked/);
    });

    it("refuses something that unpacked without a manifest", async () => {
        // Not a Rebase bundle, or truncated. Booting on it would surface much
        // later as an empty schema.
        await expect(fetchBundle({
            url: URL_,
            destination: scratch,
            fetchImpl: okFetch(new Uint8Array([1, 2, 3])),
            extract: async (_t, d) => { fs.writeFileSync(path.join(d, "readme.txt"), "hi"); }
        })).rejects.toThrow(/without a rebase-bundle\.json/);
    });

    it("names the URL in every failure", async () => {
        // A cold start that fails in a serverless container leaves one log line
        // and no shell to investigate from. It has to say which URL.
        const cases: (() => Promise<unknown>)[] = [
            () => fetchBundle({ url: URL_, destination: scratch, fetchImpl: okFetch(new Uint8Array([])) }),
            () => fetchBundle({
                url: URL_, destination: scratch,
                fetchImpl: okFetch(new Uint8Array([1])),
                extract: async () => { throw new Error("boom"); }
            })
        ];
        for (const run of cases) {
            await expect(run()).rejects.toThrow(URL_);
        }
    });

    it("reports a network failure rather than leaking an abort", async () => {
        const failing = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
        await expect(fetchBundle({ url: URL_, destination: scratch, fetchImpl: failing }))
            .rejects.toThrow(/Could not download the bundle.*ECONNREFUSED/s);
    });
});

describe("bundleRootIn", () => {
    it("finds a manifest at the top level", () => {
        fs.writeFileSync(path.join(scratch, "rebase-bundle.json"), "{}");
        expect(bundleRootIn(scratch)).toBe(scratch);
    });

    it("tolerates one level of nesting", () => {
        // Whether a tarball has a top-level directory depends on how it was
        // made: `tar czf x.tgz dist-bundle` and `tar czf x.tgz -C dist-bundle .`
        // produce different shapes from the same files, and both are things a
        // build script does.
        const nested = path.join(scratch, "dist-bundle");
        fs.mkdirSync(nested);
        fs.writeFileSync(path.join(nested, "rebase-bundle.json"), "{}");
        expect(bundleRootIn(scratch)).toBe(nested);
    });

    it("returns null when there is no manifest anywhere", () => {
        fs.mkdirSync(path.join(scratch, "src"));
        fs.writeFileSync(path.join(scratch, "src", "index.js"), "");
        expect(bundleRootIn(scratch)).toBeNull();
    });

    it("does not descend two levels", () => {
        // A bundle two directories down is not a shape any build produces, and
        // searching for one would find an unrelated manifest in a node_modules
        // fixture.
        const deep = path.join(scratch, "a", "b");
        fs.mkdirSync(deep, { recursive: true });
        fs.writeFileSync(path.join(deep, "rebase-bundle.json"), "{}");
        expect(bundleRootIn(scratch)).toBeNull();
    });
});

describe("the environment contract", () => {
    it("names the variables the platform sets", () => {
        // These strings are duplicated in the SaaS repo's Cloud Run manifest
        // builder, which cannot import from here. Renaming one without the other
        // produces a container that boots with no bundle and no explanation.
        expect(BUNDLE_URL_ENV).toBe("REBASE_BUNDLE_URL");
        expect(BUNDLE_TOKEN_ENV).toBe("REBASE_BUNDLE_TOKEN");
    });
});
