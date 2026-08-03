import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import { detectStorageAuthorize } from "../bundle";
import { storageAuthorize } from "../../templates/template/config/storage";
import { storageAuthorize as baasStorageAuthorize } from "../../templates/overlays/baas/config/storage";
import type { StorageAuthorizeContext } from "@rebasepro/types";

/**
 * The scaffolded project must declare a storage access model.
 *
 * `assertStorageAccessControlConfigured` throws at boot when storage is configured
 * in production and none of `storageAuthorize` / `storagePublicRead` /
 * `storageInsecureAllowAnyAuthenticated` is set — and the template's
 * docker-compose.yml sets `NODE_ENV: production` *and* `FORCE_LOCAL_STORAGE: true`,
 * so storage *is* configured there. For a while it declared none of the three, and
 * every `docker compose up` on a fresh project crash-looped.
 *
 * That bug was invisible from three directions at once, which is why this file
 * exists rather than a note in a README:
 *
 * - the guard only **throws** in production and merely warns in development, so
 *   `rebase dev` and every dev-mode test passed;
 * - the container restarts fast enough that a health check can answer `ok` in the
 *   gap between attempts, so the visible symptom was a `fetch failed / ECONNRESET`
 *   on some later call, pointing nowhere near storage;
 * - the only suite that exercised it was the admin init e2e, inside a Docker build
 *   roughly fifteen minutes in, and it needs Docker.
 *
 * So the checks below are deliberately cheap and deliberately not dev-mode.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const templateRoot = path.resolve(here, "../../templates/template");

describe("the scaffolded project declares a storage access model", () => {
    it("exports storageAuthorize from the config package", () => {
        // The *real* detector, not a copy of its regex. This is the same function
        // `rebase build` uses to fill in the bundle manifest, and the same signal
        // the cloud intake gate refuses a deploy on — so the template and the host
        // cannot disagree about whether a hook exists.
        expect(detectStorageAuthorize(path.join(templateRoot, "config"))).toBe(true);
    });

    it("passes it to initializeRebaseBackend once ejected", () => {
        // Exporting it is what the host checks; passing it is what actually stops
        // the boot guard. They are separate mistakes.
        //
        // A managed project has no entrypoint of its own — the runtime reads the
        // export above. The entrypoint exists only after `rebase eject`, and it
        // has to wire the hook itself, so the payload is what is checked here.
        const backend = fs.readFileSync(
            path.resolve(here, "../../templates/eject/backend/src/index.ts"),
            "utf8"
        );
        expect(backend).toMatch(/^\s*storageAuthorize,?\s*$/m);
        expect(backend).toContain('from "../../config/storage.js"');
    });

    it("still enables storage under NODE_ENV=production, so the guard does apply", () => {
        // If this stops being true the test above becomes vacuous — storage would
        // be off in the container and the guard would never fire either way.
        const compose = fs.readFileSync(path.join(templateRoot, "docker-compose.yml"), "utf8");
        expect(compose).toMatch(/NODE_ENV:\s*production/);
        expect(compose).toMatch(/FORCE_LOCAL_STORAGE:\s*"?true"?/);
    });
});

/**
 * The hook's decision matrix.
 *
 * A hook that exists but answers `true` to everything satisfies the boot guard and
 * closes nothing, so the shape of the answers is the part worth pinning.
 */
describe("the template's storageAuthorize", () => {
    const ask = (
        operation: StorageAuthorizeContext["operation"],
        key: string,
        roles?: string[]
    ): boolean | Promise<boolean> =>
        storageAuthorize({
            key,
            bucket: "uploads",
            operation,
            user: roles === undefined ? null : { uid: "u1",
roles }
        });

    it("lets anyone read a public/ object", () => {
        expect(ask("read", "public/logo.png")).toBe(true);
    });

    it("denies an anonymous caller everything else", () => {
        expect(ask("read", "author_pictures/a.png")).toBe(false);
        expect(ask("list", "")).toBe(false);
        expect(ask("write", "public/anything.png")).toBe(false);
        expect(ask("delete", "public/logo.png")).toBe(false);
    });

    it("lets any signed-in user read shared content", () => {
        // The admin panel renders these images for a viewer, so a read gate on
        // roles would break the panel rather than protect anything.
        expect(ask("read", "author_pictures/a.png", [])).toBe(true);
        expect(ask("read", "posts/hero/x.jpg", ["viewer"])).toBe(true);
    });

    it("refuses a viewer any write, delete or list", () => {
        // `list` is the one that matters: enumeration is what turns an unguessable
        // key into a known one, and it is step one of the attack the guard names.
        expect(ask("write", "author_pictures/a.png", ["viewer"])).toBe(false);
        expect(ask("delete", "author_pictures/a.png", ["viewer"])).toBe(false);
        expect(ask("list", "author_pictures/", ["viewer"])).toBe(false);
    });

    it("refuses a user with no roles at all", () => {
        expect(ask("write", "posts/hero/x.jpg", [])).toBe(false);
        expect(ask("list", "", undefined as never as string[])).toBe(false);
    });

    it("allows editors and admins to manage the library", () => {
        for (const role of ["editor", "admin"]) {
            expect(ask("write", "author_pictures/a.png", [role])).toBe(true);
            expect(ask("delete", "author_pictures/a.png", [role])).toBe(true);
            expect(ask("list", "author_pictures/", [role])).toBe(true);
        }
    });

    it("accepts every path the template's own collections upload to", () => {
        // A hook that rejects the starter's first upload is worse than no hook: the
        // boot guard passes and the failure moves to a user clicking "upload".
        const uploadPaths = [
            "author_pictures/",
            "customer_avatars/",
            "posts/content/",
            "posts/hero/",
            "product_images/",
            "exercise_images/"
        ];
        for (const prefix of uploadPaths) {
            expect(ask("write", `${prefix}file.png`, ["editor"])).toBe(true);
        }
    });

    it("is not fooled by a public/ lookalike", () => {
        expect(ask("read", "publicity/secret.png")).toBe(false);
        expect(ask("read", "notpublic/secret.png")).toBe(false);
    });
});

/**
 * The headless flavour has the same exposure and less covering it.
 *
 * `applyHeadless` deletes `config/collections` — headless derives collections from the
 * live database — but keeps the config *package*, because that is the only place the
 * managed runtime looks for the hook. The overlay ships no docker-compose.yml of its
 * own either, so it *inherits* the one that sets `NODE_ENV: production` and
 * `FORCE_LOCAL_STORAGE: true`, and the boot guard applies exactly as it does to the
 * full flavour.
 *
 * Nothing exercises this: `cli-init-baas-e2e.ts` boots the project directly and never
 * runs `docker compose up`, so the crash-loop would only ever be found by a user.
 */
describe("the scaffolded BaaS project declares a storage access model", () => {
    const overlayConfig = path.resolve(here, "../../templates/overlays/baas/config");

    it("exports storageAuthorize from the config package the runtime reads", () => {
        // The real detector, exactly as in the full flavour above.
        expect(detectStorageAuthorize(overlayConfig)).toBe(true);
    });

    it("declares no collections, which is what makes this flavour headless", () => {
        // `rebase build` reads the absence of this directory as "introspect from
        // the live database". The config package itself must survive.
        expect(fs.existsSync(path.join(overlayConfig, "collections"))).toBe(false);
        expect(fs.existsSync(path.join(overlayConfig, "index.ts"))).toBe(true);
    });

    const ask = (
        operation: StorageAuthorizeContext["operation"],
        key: string,
        uid?: string
    ): boolean | Promise<boolean> =>
        baasStorageAuthorize({
            key,
            bucket: "uploads",
            operation,
            user: uid === undefined ? null : { uid }
        });

    it("lets anyone read a public/ object and nothing else", () => {
        expect(ask("read", "public/logo.png")).toBe(true);
        expect(ask("read", "users/u1/a.png")).toBe(false);
        expect(ask("list", "")).toBe(false);
    });

    it("scopes a caller to their own prefix", () => {
        expect(ask("write", "users/u1/a.png", "u1")).toBe(true);
        expect(ask("read", "users/u1/a.png", "u1")).toBe(true);
        expect(ask("delete", "users/u1/a.png", "u1")).toBe(true);
        expect(ask("list", "users/u1/", "u1")).toBe(true);
    });

    it("keeps one caller out of another's prefix", () => {
        expect(ask("read", "users/u2/a.png", "u1")).toBe(false);
        expect(ask("write", "users/u2/a.png", "u1")).toBe(false);
        expect(ask("delete", "users/u2/a.png", "u1")).toBe(false);
    });

    it("denies the empty prefix, which would enumerate the whole bucket", () => {
        expect(ask("list", "", "u1")).toBe(false);
    });

    it("is not fooled by a uid that is a prefix of another", () => {
        // `users/u1` must not open `users/u10/…`. The trailing slash is what makes
        // startsWith safe here, and it is easy to drop.
        expect(ask("read", "users/u10/a.png", "u1")).toBe(false);
    });
});
