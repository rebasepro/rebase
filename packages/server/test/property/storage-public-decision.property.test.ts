/**
 * An anonymous storage read is let through exactly when the key it serves is public.
 *
 * Two parties read the request path. `publicObjectAuth` decides whether an
 * anonymous caller may read without credentials — and if it says yes, the
 * authorize hook is not asked. The route decides which key to serve. When the
 * two derived the key separately, `GET /file/notes://public/secret.txt` was
 * public to the first (it stripped a "scheme") and `notes:/public/secret.txt`
 * to the second (it folded `//`): a private object, served to anyone.
 *
 * So this is stated as a property of the whole door rather than of either
 * function, and observed from outside: the route is mounted with a hook that
 * refuses everything and records what it was asked, and the controller records
 * the key it was asked to serve. For any path,
 *
 * - if the hook was asked about key `k`, the request was not let through as
 *   public — so `k` must not be public;
 * - if the hook was not asked and the controller served `k`, the request was
 *   let through as public — so `k` must be public;
 * - otherwise the path named no object (400 or 404) and nothing was served.
 *
 * Both directions, so the decision cannot drift from the key either way:
 * a wider one serves private objects, a narrower one 401s public ones.
 */

import { jest } from "@jest/globals";
import fc from "fast-check";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Hono } from "hono";
import { isPublicStorageKey } from "@rebasepro/types";
import { HonoEnv } from "../../src/api/types";
import { errorHandler } from "../../src/api/errors";
import { LocalStorageController } from "../../src/storage/LocalStorageController";
import { createStorageRoutes } from "../../src/storage/routes";
import { configureJwt } from "../../src/auth/jwt";

const RUNS = Number(process.env.FC_RUNS ?? 600);

/**
 * URL path segments, weighted towards the spellings that broke or nearly did:
 * a scheme's `:` before an empty segment, encoded separators, case variants of
 * the two words the routes give meaning to, dot segments, a raw `%`, and
 * look-alike Unicode.
 */
const segment = fc.oneof(
    { arbitrary: fc.stringMatching(/^[a-z0-9_-]{1,6}$/), weight: 4 },
    {
        arbitrary: fc.constantFrom(
            "public", "PUBLIC", "Public", "default", "DEFAULT",
            "notes:", "x:", "s3:", "local:", ":",
            "", ".", "..", "%2E", "%2E%2E",
            "%2F", "%2f", "%2F%2F", "%3A", "%3A%2F%2F", "%5C", "%252F", "%25",
            "a%2Fpublic", "public%2F", ".%2Fpublic",
            "ü", "%C3%BC", "ｐｕｂｌｉｃ", "_rebase", "renditions", "%"
        ),
        weight: 6
    }
);

const rawPath = fc
    .tuple(
        fc.constantFrom("", "/", "//", "default/", "default//", "notes://", "x:///"),
        fc.array(segment, { minLength: 1, maxLength: 5 }),
        fc.constantFrom("", "/", "/x.txt")
    )
    .map(([lead, parts, trail]) => `${lead}${parts.join("/")}${trail}`);

/** Paths a reviewer would name first, run on every pass rather than left to chance. */
const NAMED = [
    "notes://public/secret.txt",
    "notes:/public/secret.txt",
    "notes:%2F%2Fpublic/secret.txt",
    "default/notes://public/secret.txt",
    "x://default/public/y",
    "public/x",
    "default/public/x",
    "DEFAULT/public/x",
    "default/default/public/x",
    "public//x",
    "//public/x",
    ".%2Fpublic/x",
    "public%2F..%2Fsecret",
    "public/",
    "public",
    "_rebase/renditions/x.webp",
    "100%-done.txt"
];

type Observation = {
    status: number;
    hookAsked: string[];
    served: string[];
};

describe("the public decision is the served key's", () => {
    let tempDir: string;
    let controller: LocalStorageController;
    let app: Hono<HonoEnv>;
    let hookAsked: string[];
    // Every refusal is logged as a warning; hundreds of them bury a failure.
    let quiet: { mockRestore(): void };

    beforeAll(async () => {
        quiet = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        configureJwt({ secret: "test-secret-key-for-jwt-testing-1234567890" });
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-storage-public-decision-"));
        controller = new LocalStorageController({ type: "local", basePath: tempDir });
        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({
            controller,
            // Off, so a request that is not let through as public still reaches
            // the route — where the hook says which key it would have served.
            requireAuth: false,
            authorize: async ({ key }) => {
                hookAsked.push(key);
                return false;
            }
        }));
    });

    afterAll(async () => {
        quiet.mockRestore();
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    async function observe(door: "file" | "metadata", raw: string): Promise<Observation> {
        hookAsked = [];
        const spy = door === "file"
            ? jest.spyOn(controller, "getAbsolutePath")
            : jest.spyOn(controller, "getSignedUrl");
        try {
            const res = await app.fetch(new Request(`http://localhost/api/storage/${door}/${raw}`));
            await res.arrayBuffer();
            return {
                status: res.status,
                hookAsked: [...hookAsked],
                served: spy.mock.calls.map(call => String(call[0]))
            };
        } finally {
            spy.mockRestore();
        }
    }

    function holds(raw: string, o: Observation): void {
        const at = { raw, ...o };
        if (o.hookAsked.length > 0) {
            // Not let through as public: the hook was asked, refused, and
            // nothing was served. The key it was asked about is the key the
            // route would serve, and that key must not be public.
            expect(at).toMatchObject({ status: 403, served: [] });
            expect(o.hookAsked).toHaveLength(1);
            expect({ raw, key: o.hookAsked[0], public: isPublicStorageKey(o.hookAsked[0]) })
                .toEqual({ raw, key: o.hookAsked[0], public: false });
        } else if (o.served.length > 0) {
            // Let through as public, past a hook that refuses everything. The
            // key served must be public.
            expect(o.served).toHaveLength(1);
            expect({ raw, key: o.served[0], public: isPublicStorageKey(o.served[0]) })
                .toEqual({ raw, key: o.served[0], public: true });
        } else {
            // The path named no object at all.
            expect([400, 404]).toContain(o.status);
        }
    }

    for (const door of ["file", "metadata"] as const) {
        it(`GET /${door}/*: named spellings`, async () => {
            for (const raw of NAMED) holds(raw, await observe(door, raw));
        });

        it(`GET /${door}/*: any spelling`, async () => {
            await fc.assert(fc.asyncProperty(rawPath, async (raw) => {
                holds(raw, await observe(door, raw));
            }), { numRuns: RUNS });
        });
    }
});
