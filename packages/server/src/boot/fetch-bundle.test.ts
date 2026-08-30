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
import { execFileSync } from "child_process";
import {
    fetchBundle,
    shouldFetchBundle,
    bundleRootIn,
    installBundleDependencies,
    dedupeRuntimePackages,
    BUNDLE_URL_ENV,
    BUNDLE_TOKEN_ENV,
    unpackedBundleSource,
    usableBundleFallback
} from "./fetch-bundle";
import { MANIFEST_FILENAME, loadBundle } from "./bundle";

let scratch: string;

beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-bundle-test-"));
});
afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
});

const URL_ = "https://control-plane.internal/bundles/p1/b1";

/**
 * A fetch that returns the given bytes as a real `Response`.
 *
 * Real, not a shape with an `arrayBuffer` method: the download is streamed
 * through `response.body`, and a stub carrying only `arrayBuffer` would pass
 * while the production path — which never calls it — was broken. That is not
 * hypothetical, it is what the previous version of this helper was.
 */
const okFetch = (body: Uint8Array, capture?: (init: RequestInit) => void) =>
    (async (_url: string, init: RequestInit) => {
        capture?.(init);
        return new Response(body as unknown as BodyInit, { status: 200, statusText: "OK" });
    }) as unknown as typeof fetch;

/** An extractor that writes a manifest, standing in for a real tarball. */
const extractManifest = (nested?: string) => async (_tarball: string, destination: string) => {
    const target = nested ? path.join(destination, nested) : destination;
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, MANIFEST_FILENAME), JSON.stringify({ kind: "backend" }));
};

/** Never install in a unit test — npm is not a dependency of this suite. */
const noInstall = { installDependencies: false as const };

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
            extract: extractManifest(),
            ...noInstall
        });
        expect(root).toBe(scratch);
        expect(fs.existsSync(path.join(root, MANIFEST_FILENAME))).toBe(true);
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
            extract: extractManifest(),
            ...noInstall
        });
        expect((init?.headers as Record<string, string>)?.authorization).toBe("Bearer svc-key");
    });

    it("sends no authorization header when there is no token", async () => {
        let init: RequestInit | undefined;
        await fetchBundle({
            url: URL_,
            destination: scratch,
            fetchImpl: okFetch(new Uint8Array([1]), (i) => { init = i; }),
            extract: extractManifest(),
            ...noInstall
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
            extract: extractManifest(),
            ...noInstall
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
            url: URL_, destination: scratch, attempts: 1,
            fetchImpl: okFetch(new Uint8Array([])), ...noInstall
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

    it("unpacks a real archive rooted at `.` without leaving staging behind", async () => {
        // The default extractor, not an injected one — the thing under test is
        // the `tar` invocation itself.
        //
        // GNU tar applies the archive root's mode to the extraction root as its
        // last act, and where the process does not own that directory the chmod
        // is refused *after* every file is written: a complete bundle reported
        // as corrupt, which is what a Kubernetes emptyDir (root:node 0775
        // setgid, runtime uid 1000) produced on every managed pod. No flag
        // avoids it, so the extractor stages into a directory it creates and
        // moves the entries up.
        //
        // The ownership half cannot be reproduced in-process without root; what
        // this holds is the move: everything the archive carried arrives,
        // dotfiles included, an existing entry is replaced rather than merged
        // with, and no staging directory survives.
        const src = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-src-"));
        fs.writeFileSync(path.join(src, MANIFEST_FILENAME), JSON.stringify({ kind: "backend" }));
        fs.writeFileSync(path.join(src, ".hidden"), "dot");
        fs.mkdirSync(path.join(src, "sub"));
        fs.writeFileSync(path.join(src, "sub", "f"), "nested");
        // Outside `src`, not in it: archiving a directory that contains the
        // archive being written is an error under GNU tar, and passes under the
        // bsdtar on a developer's Mac. This suite runs on both.
        const tarball = path.join(scratch, "..", `bundle-${path.basename(src)}.tar.gz`);
        execFileSync("tar", ["-czf", tarball, "-C", src, "."]);

        // A stale file the archive also carries: the move must replace it.
        fs.writeFileSync(path.join(scratch, MANIFEST_FILENAME), "stale");

        await fetchBundle({
            url: URL_,
            destination: scratch,
            fetchImpl: okFetch(new Uint8Array(fs.readFileSync(tarball))),
            ...noInstall
        });

        expect(fs.existsSync(path.join(scratch, ".rebase-unpack"))).toBe(false);
        expect(fs.readFileSync(path.join(scratch, ".hidden"), "utf8")).toBe("dot");
        expect(fs.readFileSync(path.join(scratch, "sub", "f"), "utf8")).toBe("nested");
        expect(JSON.parse(fs.readFileSync(path.join(scratch, MANIFEST_FILENAME), "utf8")))
            .toEqual({ kind: "backend" });

        fs.rmSync(src, { recursive: true, force: true });
        fs.rmSync(tarball, { force: true });
    });

    it("refuses something that unpacked without a manifest", async () => {
        // Not a Rebase bundle, or truncated. Booting on it would surface much
        // later as an empty schema.
        await expect(fetchBundle({
            url: URL_,
            destination: scratch,
            fetchImpl: okFetch(new Uint8Array([1, 2, 3])),
            extract: async (_t, d) => { fs.writeFileSync(path.join(d, "readme.txt"), "hi"); }
        })).rejects.toThrow(/without a manifest\.json/);
    });

    it("names the URL in every failure", async () => {
        // A cold start that fails in a serverless container leaves one log line
        // and no shell to investigate from. It has to say which URL.
        const cases: (() => Promise<unknown>)[] = [
            () => fetchBundle({
                url: URL_, destination: scratch, attempts: 1,
                fetchImpl: okFetch(new Uint8Array([])), ...noInstall
            }),
            () => fetchBundle({
                url: URL_, destination: scratch, attempts: 1,
                fetchImpl: okFetch(new Uint8Array([1])),
                extract: async () => { throw new Error("boom"); },
                ...noInstall
            })
        ];
        for (const run of cases) {
            await expect(run()).rejects.toThrow(URL_);
        }
    });

    it("reports a network failure rather than leaking an abort", async () => {
        const failing = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
        await expect(fetchBundle({
            url: URL_, destination: scratch, attempts: 1, fetchImpl: failing, ...noInstall
        })).rejects.toThrow(/Could not download the bundle.*ECONNREFUSED/s);
    });
});

describe("bundleRootIn", () => {
    it("finds a manifest at the top level", () => {
        fs.writeFileSync(path.join(scratch, MANIFEST_FILENAME), "{}");
        expect(bundleRootIn(scratch)).toBe(scratch);
    });

    it("tolerates one level of nesting", () => {
        // Whether a tarball has a top-level directory depends on how it was
        // made: `tar czf x.tgz dist-bundle` and `tar czf x.tgz -C dist-bundle .`
        // produce different shapes from the same files, and both are things a
        // build script does.
        const nested = path.join(scratch, "dist-bundle");
        fs.mkdirSync(nested);
        fs.writeFileSync(path.join(nested, MANIFEST_FILENAME), "{}");
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
        fs.writeFileSync(path.join(deep, MANIFEST_FILENAME), "{}");
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

describe("the marker this looks for is the one bundles carry", () => {
    /**
     * The test that was missing, and the reason this whole path was dead.
     *
     * `bundleRootIn` looked for `rebase-bundle.json`. Nothing writes that file —
     * the CLI writes `manifest.json` and `loadBundle` reads `manifest.json`. The
     * only thing that ever produced it was the fixture in this suite, which
     * wrote the marker it then asserted on. So every test passed and every real
     * download was rejected as "not a Rebase bundle", on Cloud Run and under the
     * chart's `bundle.mode: url` alike.
     *
     * A fixture that invents its own subject can only ever agree with itself.
     * These tie the name to the loader instead.
     */
    it("accepts a directory the bundle loader would accept", () => {
        fs.writeFileSync(
            path.join(scratch, MANIFEST_FILENAME),
            JSON.stringify({ format: 2, kind: "backend", app: "backend" })
        );
        expect(bundleRootIn(scratch)).toBe(scratch);
        // The loader is the authority on what a bundle is; if it stops reading
        // this file, finding it here means nothing.
        expect(() => loadBundle(scratch)).not.toThrow(new RegExp(`No ${MANIFEST_FILENAME} found`));
    });

    it("rejects the name that was looked for and never written", () => {
        fs.writeFileSync(path.join(scratch, "rebase-bundle.json"), "{}");
        expect(bundleRootIn(scratch)).toBeNull();
    });
});

describe("fetchBundle retries", () => {
    /** Fails `failures` times, then succeeds. */
    const flaky = (failures: number, body = new Uint8Array([1, 2, 3])) => {
        let calls = 0;
        const impl = (async () => {
            calls++;
            if (calls <= failures) throw new Error("ECONNRESET");
            return new Response(body as unknown as BodyInit, { status: 200, statusText: "OK" });
        }) as unknown as typeof fetch;
        return { impl, calls: () => calls };
    };

    it("survives a transient failure rather than crash-looping on it", async () => {
        // A pod starting during a control-plane rollout gets one refused
        // connection. Without a retry the container exits, and a restart re-runs
        // the entire boot — strictly more expensive than waiting three seconds.
        const f = flaky(2);
        const root = await fetchBundle({
            url: URL_, destination: scratch, retryDelayMs: 1,
            fetchImpl: f.impl, extract: extractManifest(), ...noInstall
        });
        expect(root).toBe(scratch);
        expect(f.calls()).toBe(3);
    });

    it("gives up after the last attempt", async () => {
        const f = flaky(99);
        await expect(fetchBundle({
            url: URL_, destination: scratch, attempts: 3, retryDelayMs: 1,
            fetchImpl: f.impl, extract: extractManifest(), ...noInstall
        })).rejects.toThrow(/Could not download the bundle/);
        expect(f.calls()).toBe(3);
    });

    it("does not retry a 403, which will not become a 200 by waiting", async () => {
        // A bad token spends the pod's whole startup budget confirming it is
        // still bad, and the eventual message is the same one the first attempt
        // had. Worse, on a startup probe that budget is what stands between a
        // clear failure and a CrashLoop with a misleading cause.
        let calls = 0;
        const denied = (async () => {
            calls++;
            return new Response(null, { status: 403, statusText: "Forbidden" });
        }) as unknown as typeof fetch;

        await expect(fetchBundle({
            url: URL_, destination: scratch, retryDelayMs: 1,
            fetchImpl: denied, extract: extractManifest(), ...noInstall
        })).rejects.toThrow(/403/);
        expect(calls).toBe(1);
    });
});

describe("fetchBundle installs the bundle's dependencies", () => {
    it("installs when the bundle declares them and has none", async () => {
        const installed: string[] = [];
        await fetchBundle({
            url: URL_, destination: scratch,
            fetchImpl: okFetch(new Uint8Array([1])),
            extract: async (_t, d) => {
                fs.writeFileSync(path.join(d, MANIFEST_FILENAME), "{}");
                fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({ dependencies: { x: "1" } }));
            },
            installImpl: async (root) => { installed.push(root); }
        });
        expect(installed).toEqual([scratch]);
    });

    it("is skipped entirely when asked", async () => {
        // What a vendored bundle wants: node_modules is already in the tarball,
        // and reinstalling over it is slower and no safer.
        const installed: string[] = [];
        await fetchBundle({
            url: URL_, destination: scratch,
            fetchImpl: okFetch(new Uint8Array([1])),
            extract: extractManifest(),
            installDependencies: false,
            installImpl: async (root) => { installed.push(root); }
        });
        expect(installed).toEqual([]);
    });

    it("installs into the nested root, not the directory above it", async () => {
        // The tarball shape varies; installing beside the bundle rather than in
        // it produces a node_modules the runtime cannot resolve through.
        const installed: string[] = [];
        await fetchBundle({
            url: URL_, destination: scratch,
            fetchImpl: okFetch(new Uint8Array([1])),
            extract: extractManifest("dist-bundle"),
            installImpl: async (root) => { installed.push(root); }
        });
        expect(installed).toEqual([path.join(scratch, "dist-bundle")]);
    });

    it("fails the boot when the install fails", async () => {
        // Booting on a bundle whose dependencies are missing surfaces as an
        // import error deep in a request, long after the cause.
        await expect(fetchBundle({
            url: URL_, destination: scratch,
            fetchImpl: okFetch(new Uint8Array([1])),
            extract: extractManifest(),
            installImpl: async () => { throw new Error("ENOSPC: no space left on device"); }
        })).rejects.toThrow(/ENOSPC/);
    });
});

describe("installBundleDependencies", () => {
    /**
     * These carry over from a suite that asserted on a shell script embedded in
     * a Kubernetes init container. The container is gone; the decisions it
     * encoded are not, and they are the kind that fail silently — an install
     * that runs lifecycle scripts, or one that reinstalls over a vendored tree.
     */
    const calls: { cmd: string; args: string[]; cwd?: string }[] = [];
    const exec = async (cmd: string, args: string[], opts: object) => {
        calls.push({ cmd, args, cwd: (opts as { cwd?: string }).cwd });
        return undefined;
    };
    beforeEach(() => { calls.length = 0; });

    const bundle = (files: Record<string, string>) => {
        for (const [name, body] of Object.entries(files)) {
            fs.writeFileSync(path.join(scratch, name), body);
        }
        return scratch;
    };

    it("does nothing when the bundle declares no dependencies", () => {
        // A project using only what the runtime already provides. Common, and
        // an npm call there is pure latency on every cold start.
        return installBundleDependencies(bundle({}), exec).then(() => {
            expect(calls).toEqual([]);
        });
    });

    it("uses npm ci when a lockfile is present", async () => {
        await installBundleDependencies(
            bundle({ "package.json": "{}", "package-lock.json": "{}" }), exec);
        expect(calls[0].args[0]).toBe("ci");
    });

    it("falls back to npm install without one, rather than refusing to boot", async () => {
        await installBundleDependencies(bundle({ "package.json": "{}" }), exec);
        expect(calls[0].args[0]).toBe("install");
    });

    it("never runs lifecycle scripts", async () => {
        // The runtime image's entrypoint refuses to run them. An install that
        // ran them here would void that at every pod start, executing arbitrary
        // code from the dependency tree before the process it is booting exists.
        await installBundleDependencies(bundle({ "package.json": "{}" }), exec);
        expect(calls[0].args).toContain("--ignore-scripts");
        expect(calls[0].args).toContain("--omit=dev");
    });

    it("installs in the bundle, not wherever the process happens to be", async () => {
        await installBundleDependencies(bundle({ "package.json": "{}" }), exec);
        expect(calls[0].cwd).toBe(scratch);
    });

    it("skips a bundle that already carries node_modules", async () => {
        // Vendored at build time, or a container restarting inside a live pod
        // onto a volume it already populated. Installing over it is slower and
        // no safer.
        fs.mkdirSync(path.join(scratch, "node_modules"));
        await installBundleDependencies(bundle({ "package.json": "{}" }), exec);
        expect(calls).toEqual([]);
    });

    it("drops the npm cache, which is a duplicate of the tree beside it", async () => {
        await installBundleDependencies(bundle({ "package.json": "{}" }), exec);
        expect(calls.at(-1)!.args).toEqual(["cache", "clean", "--force"]);
    });

    it("says so when the volume ran out of room", async () => {
        // The failure this whole change is about. In an init container it
        // produced no output at all — npm slept in epoll_wait and the only
        // symptom was a deploy that never became ready.
        const failing = async () => { throw new Error("ENOSPC: no space left on device"); };
        await expect(installBundleDependencies(bundle({ "package.json": "{}" }), failing))
            .rejects.toThrow(/ran out of space/);
    });

    it("still fails loudly for an ordinary install error", async () => {
        const failing = async () => { throw new Error("404 Not Found - GET registry/foo"); };
        await expect(installBundleDependencies(bundle({ "package.json": "{}" }), failing))
            .rejects.toThrow(/404 Not Found/);
    });
});

describe("a failed install leaves nothing a later boot would trust", () => {
    /**
     * Measured, not imagined. An `npm install` OOMKilled partway through leaves
     * `node_modules` holding 124 of 156 packages — a directory check cannot tell
     * that from a finished install, and the skip at the top of
     * `installBundleDependencies` would take it. The runtime would then boot on
     * a tree missing a third of its dependencies and fail as an import error
     * deep inside a request, an hour of debugging away from the cause.
     *
     * The init container this replaced had the same `[ ! -d node_modules ]`
     * check and the same hole, and its volume also survived the restart.
     */
    it("removes a partial tree when the install fails", async () => {
        fs.writeFileSync(path.join(scratch, "package.json"), "{}");
        const partial = async () => {
            fs.mkdirSync(path.join(scratch, "node_modules", "half-a-package"), { recursive: true });
            throw new Error("Killed");
        };
        await expect(installBundleDependencies(scratch, partial)).rejects.toThrow(/Killed/);
        expect(fs.existsSync(path.join(scratch, "node_modules"))).toBe(false);
    });

    it("so the next attempt installs rather than skipping", async () => {
        fs.writeFileSync(path.join(scratch, "package.json"), "{}");
        const failOnce = async () => {
            fs.mkdirSync(path.join(scratch, "node_modules"), { recursive: true });
            throw new Error("ENOSPC: no space left on device");
        };
        await expect(installBundleDependencies(scratch, failOnce)).rejects.toThrow();

        const second: string[] = [];
        await installBundleDependencies(scratch, async (_c, args) => { second.push(args[0]); });
        expect(second[0]).toMatch(/^(ci|install)$/);
    });

    it("still leaves a vendored tree alone", async () => {
        // The cleanup must not turn "skip a complete tree" into "never skip".
        fs.writeFileSync(path.join(scratch, "package.json"), "{}");
        fs.mkdirSync(path.join(scratch, "node_modules", "vendored"), { recursive: true });
        const calls: string[] = [];
        await installBundleDependencies(scratch, async (c) => { calls.push(c); });
        expect(calls).toEqual([]);
        expect(fs.existsSync(path.join(scratch, "node_modules", "vendored"))).toBe(true);
    });
});

describe("dedupeRuntimePackages", () => {
    /**
     * The absent case is the common one.
     *
     * `rebase build` correctly does not declare `@rebasepro/server` in a
     * bundle's package.json — declaring it is what produces the duplicate this
     * collapses — so most bundles carry no copy at all. Treating absent as
     * "nothing to do" leaves Node resolving a function's import by walking up
     * from the importing file, never reaching the image's node_modules, and
     * every custom function and cron fails to load while the container reports
     * itself healthy.
     */
    function imageWith(pkg: string) {
        const image = path.join(scratch, "image-modules");
        fs.mkdirSync(path.join(image, pkg), { recursive: true });
        fs.writeFileSync(path.join(image, pkg, "package.json"), "{}");
        return image;
    }

    it("links the runtime's copy into a bundle that has none", () => {
        const image = imageWith("@rebasepro/server");
        const bundle = path.join(scratch, "bundle");
        fs.mkdirSync(bundle, { recursive: true });

        expect(dedupeRuntimePackages(bundle, image)).toEqual(["@rebasepro/server"]);
        const linked = path.join(bundle, "node_modules", "@rebasepro", "server");
        expect(fs.lstatSync(linked).isSymbolicLink()).toBe(true);
        expect(fs.realpathSync(linked)).toBe(fs.realpathSync(path.join(image, "@rebasepro/server")));
    });

    it("replaces a real duplicate with the link", () => {
        const image = imageWith("@rebasepro/server");
        const bundle = path.join(scratch, "bundle");
        const dup = path.join(bundle, "node_modules", "@rebasepro", "server");
        fs.mkdirSync(dup, { recursive: true });
        fs.writeFileSync(path.join(dup, "package.json"), '{"version":"0.0.1"}');

        expect(dedupeRuntimePackages(bundle, image)).toEqual(["@rebasepro/server"]);
        expect(fs.lstatSync(dup).isSymbolicLink()).toBe(true);
    });

    it("leaves an existing link alone", () => {
        const image = imageWith("@rebasepro/server");
        const bundle = path.join(scratch, "bundle");
        const target = path.join(bundle, "node_modules", "@rebasepro", "server");
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.symlinkSync(path.join(image, "@rebasepro/server"), target, "dir");

        expect(dedupeRuntimePackages(bundle, image)).toEqual([]);
    });

    it("does nothing outside a container, where there is no image to link to", () => {
        const bundle = path.join(scratch, "bundle");
        fs.mkdirSync(bundle, { recursive: true });
        expect(dedupeRuntimePackages(bundle, undefined)).toEqual([]);
        expect(fs.existsSync(path.join(bundle, "node_modules"))).toBe(false);
    });
});


/**
 * The default extractor, running the real `tar`.
 *
 * Every other test in this file stubs `extract`, so none of them exercise the
 * command that actually runs in production — which is how a broken flag set
 * shipped and crash-looped managed pods on every start.
 */
describe("the default extractor, running real tar", () => {
    /** Pack a bundle rooted at `.`, as a build script does, from a dir of `mode`. */
    const packTarball = (rootMode: number): Uint8Array => {
        const src = fs.mkdtempSync(path.join(scratch, "src-"));
        fs.writeFileSync(path.join(src, MANIFEST_FILENAME), JSON.stringify({ kind: "backend" }));
        fs.mkdirSync(path.join(src, "config"));
        fs.writeFileSync(path.join(src, "config", "collections.js"), "export default [];");
        fs.chmodSync(src, rootMode);
        const tarball = path.join(scratch, `bundle-${rootMode.toString(8)}.tar.gz`);
        execFileSync("tar", ["-czf", tarball, "-C", src, "."]);
        // Readable again, so the afterEach cleanup can descend into it.
        fs.chmodSync(src, 0o755);
        return fs.readFileSync(tarball);
    };

    it("leaves the destination's own permissions alone", async () => {
        // An archive rooted at `.` carries the mode of the directory it was
        // packed from, and `tar` restores that onto the destination last. In a
        // managed pod the destination is a mount the runtime does not own, so
        // that chmod is refused and `tar` exits non-zero having already written
        // every file — a complete bundle reported as a corrupt one. Here the
        // test owns the directory, so the chmod would succeed silently; the
        // mode left behind is what gives the behaviour away.
        const body = packTarball(0o700);
        const destination = path.join(scratch, "dest-mode");
        fs.mkdirSync(destination);
        fs.chmodSync(destination, 0o755);

        await fetchBundle({ url: URL_, destination, fetchImpl: okFetch(body), ...noInstall });

        expect(fs.statSync(destination).mode & 0o777).toBe(0o755);
    });

    it("unpacks a real tarball into a root the bundle loader accepts", async () => {
        const body = packTarball(0o755);
        const destination = path.join(scratch, "dest-contents");
        fs.mkdirSync(destination);

        const root = await fetchBundle({
            url: URL_, destination, fetchImpl: okFetch(body), ...noInstall
        });

        expect(fs.existsSync(path.join(root, MANIFEST_FILENAME))).toBe(true);
        expect(fs.existsSync(path.join(root, "config", "collections.js"))).toBe(true);
    });

    it("records which URL the unpacked tree came from", async () => {
        const destination = path.join(scratch, "dest-marked");
        fs.mkdirSync(destination);

        await fetchBundle({
            url: URL_, destination, fetchImpl: okFetch(packTarball(0o755)), ...noInstall
        });

        expect(unpackedBundleSource(destination)).toBe(URL_);
    });

    it("discards a tree left by a different bundle instead of unpacking onto it", async () => {
        // The failure this exists for: something else filled the directory from
        // another bundle, and files that bundle had but this one does not used
        // to survive the unpack — stale assets beside fresh ones, and a
        // node_modules the install step would then consider already done.
        const destination = path.join(scratch, "dest-stale");
        fs.mkdirSync(destination);

        await fetchBundle({
            url: "https://example.test/bundle/OLD",
            destination,
            fetchImpl: okFetch(packTarball(0o755)),
            ...noInstall
        });
        fs.writeFileSync(path.join(destination, "only-in-the-old-bundle.js"), "stale");

        await fetchBundle({
            url: URL_, destination, fetchImpl: okFetch(packTarball(0o755)), ...noInstall
        });

        expect(fs.existsSync(path.join(destination, "only-in-the-old-bundle.js"))).toBe(false);
        expect(unpackedBundleSource(destination)).toBe(URL_);
    });

    it("keeps what is there when the same bundle is fetched again", async () => {
        const destination = path.join(scratch, "dest-same");
        fs.mkdirSync(destination);

        await fetchBundle({
            url: URL_, destination, fetchImpl: okFetch(packTarball(0o755)), ...noInstall
        });
        fs.writeFileSync(path.join(destination, "installed-marker"), "kept");

        await fetchBundle({
            url: URL_, destination, fetchImpl: okFetch(packTarball(0o755)), ...noInstall
        });

        expect(fs.existsSync(path.join(destination, "installed-marker"))).toBe(true);
    });

    it("does not vouch for a tree whose unpack failed", async () => {
        const destination = path.join(scratch, "dest-badunpack");
        fs.mkdirSync(destination);

        await expect(fetchBundle({
            url: URL_,
            destination,
            fetchImpl: okFetch(Buffer.from("not a tarball")),
            ...noInstall
        })).rejects.toThrow();

        expect(unpackedBundleSource(destination)).toBeNull();
    });
});

describe("usableBundleFallback", () => {
    /**
     * The last resort when a download fails.
     *
     * The entrypoint re-fetches whenever the tree on disk cannot be shown to
     * match the URL, which includes every tenant provisioned before the source
     * marker existed. On those the fetch path had never run, and on 2026-08-30
     * it turned out not to work: runtime 1.19.0 failed every rollout with
     * "Failed to start the Rebase runtime" while a complete bundle sat unused
     * at /bundle. Serving possibly-stale code with a loud error beats serving
     * none at all.
     */
    it("accepts a directory that actually holds a bundle", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fallback-"));
        fs.writeFileSync(path.join(dir, MANIFEST_FILENAME), JSON.stringify({ kind: "backend" }));
        expect(usableBundleFallback(dir)).toBe(dir);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("rejects a directory with no manifest — that is a second failure, not a fallback", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fallback-empty-"));
        expect(usableBundleFallback(dir)).toBeUndefined();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("rejects a path that does not exist", () => {
        expect(usableBundleFallback(path.join(os.tmpdir(), "definitely-not-here-9d3f"))).toBeUndefined();
    });

    it("rejects nothing at all, so the caller rethrows the fetch error", () => {
        expect(usableBundleFallback(undefined)).toBeUndefined();
        expect(usableBundleFallback("")).toBeUndefined();
    });
});
