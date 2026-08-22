import { describe, it, expect, jest } from "@jest/globals";
/**
 * Declarative storage access control.
 *
 * This is authorization code, so the tests are weighted towards the ways it
 * could wrongly say *yes*. The design bias is that a mistake denies rather than
 * grants — a pattern that fails to match refuses the request — and most of what
 * follows exists to hold that bias in place.
 *
 * The cases worth reading: `**` not swallowing a prefix boundary,
 * `authenticated` not being satisfied by an anonymous caller, a captured
 * segment not matching across a `/`, and the hook being unable to *narrow* what
 * a policy already granted.
 */
import type { StorageAuthorizeContext, StorageOperation } from "@rebasepro/types";
import {
    compileStoragePolicies,
    resolveStorageAccessControl,
    StoragePolicyError,
    type StoragePolicy
} from "../src/storage/policies";

const ctx = (over: Partial<StorageAuthorizeContext> = {}): StorageAuthorizeContext => ({
    key: "users/alice/avatar.png",
    bucket: "default",
    operation: "read" as StorageOperation,
    user: { uid: "alice" },
    ...over
});

const allows = (policies: StoragePolicy[], c: StorageAuthorizeContext) =>
    compileStoragePolicies(policies)(c);

describe("deny by default", () => {
    it("refuses a key no policy mentions", async () => {
        await expect(allows([{ path: "public/**", allow: "public" }], ctx({ key: "secrets/x" })))
            .resolves.toBe(false);
    });

    it("refuses everything when the list is empty", async () => {
        await expect(allows([], ctx())).resolves.toBe(false);
    });

    it("refuses an operation the matching policy does not name", async () => {
        const policies: StoragePolicy[] = [{ path: "public/**", operations: ["read"], allow: "public" }];
        await expect(allows(policies, ctx({ key: "public/a.png", operation: "delete" }))).resolves.toBe(false);
    });
});

describe("matching", () => {
    it("matches a literal path exactly", async () => {
        const p: StoragePolicy[] = [{ path: "logo.png", allow: "public" }];
        await expect(allows(p, ctx({ key: "logo.png" }))).resolves.toBe(true);
        await expect(allows(p, ctx({ key: "logo.png.bak" }))).resolves.toBe(false);
    });

    it("`*` matches exactly one segment, never two", async () => {
        const p: StoragePolicy[] = [{ path: "users/*/avatar.png", allow: "public" }];
        await expect(allows(p, ctx({ key: "users/alice/avatar.png" }))).resolves.toBe(true);
        await expect(allows(p, ctx({ key: "users/alice/extra/avatar.png" }))).resolves.toBe(false);
    });

    it("`**` matches the rest, including nothing", async () => {
        const p: StoragePolicy[] = [{ path: "public/**", allow: "public" }];
        await expect(allows(p, ctx({ key: "public/a.png" }))).resolves.toBe(true);
        await expect(allows(p, ctx({ key: "public/deep/deeper/a.png" }))).resolves.toBe(true);
        await expect(allows(p, ctx({ key: "public" }))).resolves.toBe(true);
    });

    it("`**` does not leak past its prefix — the boundary is a segment, not a substring", async () => {
        const p: StoragePolicy[] = [{ path: "public/**", allow: "public" }];
        // The classic bug: treating the pattern as a string prefix would let
        // `publicity/` through.
        await expect(allows(p, ctx({ key: "publicity/secret.png" }))).resolves.toBe(false);
    });

    it("captures a segment and hands it to the predicate", async () => {
        const p: StoragePolicy[] = [{
            path: "users/:uid/**",
            allow: ({ params, user }) => user?.uid === params.uid
        }];
        await expect(allows(p, ctx({ key: "users/alice/a.png", user: { uid: "alice" } }))).resolves.toBe(true);
        await expect(allows(p, ctx({ key: "users/bob/a.png", user: { uid: "alice" } }))).resolves.toBe(false);
    });

    it("a capture never spans a slash", async () => {
        const p: StoragePolicy[] = [{ path: "users/:uid", allow: ({ params }) => params.uid === "a/b" }];
        await expect(allows(p, ctx({ key: "users/a/b" }))).resolves.toBe(false);
    });

    it("ignores leading and doubled slashes rather than capturing empty segments", async () => {
        const p: StoragePolicy[] = [{ path: "users/:uid/x", allow: ({ params }) => params.uid === "alice" }];
        await expect(allows(p, ctx({ key: "/users/alice/x" }))).resolves.toBe(true);
        await expect(allows(p, ctx({ key: "users//alice/x" }))).resolves.toBe(true);
    });

    it("grants every operation when none are named", async () => {
        const p: StoragePolicy[] = [{ path: "any/**", allow: "public" }];
        for (const operation of ["read", "write", "delete", "list"] as StorageOperation[]) {
            await expect(allows(p, ctx({ key: "any/x", operation }))).resolves.toBe(true);
        }
    });
});

describe("allow modes", () => {
    it("`public` grants an unauthenticated caller", async () => {
        const p: StoragePolicy[] = [{ path: "public/**", allow: "public" }];
        await expect(allows(p, ctx({ key: "public/a", user: null }))).resolves.toBe(true);
    });

    it("`authenticated` refuses a caller with no uid", async () => {
        const p: StoragePolicy[] = [{ path: "files/**", allow: "authenticated" }];
        await expect(allows(p, ctx({ key: "files/a", user: null }))).resolves.toBe(false);
    });

    it("`authenticated` grants any signed-in caller", async () => {
        const p: StoragePolicy[] = [{ path: "files/**", allow: "authenticated" }];
        await expect(allows(p, ctx({ key: "files/a", user: { uid: "bob" } }))).resolves.toBe(true);
    });

    it("an unmatched `authenticated` policy keeps looking, so a later public one can grant", async () => {
        const p: StoragePolicy[] = [
            { path: "shared/**", allow: "authenticated" },
            { path: "shared/readme.txt", operations: ["read"], allow: "public" }
        ];
        await expect(allows(p, ctx({ key: "shared/readme.txt", user: null }))).resolves.toBe(true);
    });

    it("awaits an async predicate", async () => {
        const p: StoragePolicy[] = [{ path: "x/**", allow: async () => true }];
        await expect(allows(p, ctx({ key: "x/a" }))).resolves.toBe(true);
    });

    it("passes the whole context to the predicate, not only the params", async () => {
        const seen: unknown[] = [];
        const p: StoragePolicy[] = [{
            path: "x/:id",
            allow: (c) => { seen.push(c); return true; }
        }];
        await allows(p, ctx({ key: "x/7", bucket: "media", operation: "write", storageId: "s3" }));
        expect(seen[0]).toMatchObject({
            bucket: "media", operation: "write", storageId: "s3", params: { id: "7" }
        });
    });
});

describe("the hook as an escape hatch", () => {
    it("is consulted only when no policy matched", async () => {
        const hook = jest.fn(async () => true);
        const authorize = compileStoragePolicies(
            [{ path: "public/**", allow: "public" }],
            hook as never
        );

        await expect(authorize(ctx({ key: "public/a" }))).resolves.toBe(true);
        expect(hook).not.toHaveBeenCalled();

        await expect(authorize(ctx({ key: "rows/17" }))).resolves.toBe(true);
        expect(hook).toHaveBeenCalledTimes(1);
    });

    it("cannot narrow what a policy already granted", async () => {
        const authorize = compileStoragePolicies(
            [{ path: "public/**", allow: "public" }],
            (async () => false) as never
        );
        // Each side may only say yes, so "who allowed this?" stays answerable
        // by reading either one alone.
        await expect(authorize(ctx({ key: "public/a" }))).resolves.toBe(true);
    });

    it("denies when it also refuses", async () => {
        const authorize = compileStoragePolicies([], (async () => false) as never);
        await expect(authorize(ctx())).resolves.toBe(false);
    });
});

describe("malformed policies fail the boot", () => {
    const bad = (policy: unknown, fragment: string) => {
        expect(() => compileStoragePolicies([policy as StoragePolicy])).toThrow(StoragePolicyError);
        expect(() => compileStoragePolicies([policy as StoragePolicy])).toThrow(fragment);
    };

    it("an empty path", () => bad({ path: "", allow: "public" }, "non-empty string"));
    it("a path of only slashes", () => bad({ path: "///", allow: "public" }, "names no segments"));
    it("`**` in the middle", () => bad({ path: "a/**/b", allow: "public" }, "only allowed as the last segment"));
    it("an unnamed capture", () => bad({ path: "a/:", allow: "public" }, "has no name"));
    it("a duplicated capture", () => bad({ path: ":id/:id", allow: "public" }, "captures \":id\" twice"));
    it("an empty operations list", () => bad({ path: "a/**", operations: [], allow: "public" }, "grants nothing"));
    it("an unknown operation", () => bad({ path: "a/**", operations: ["rename"], allow: "public" }, "not a storage operation"));
    it("a missing allow", () => bad({ path: "a/**" }, "`allow` must be"));
    it("a nonsense allow", () => bad({ path: "a/**", allow: "everyone" }, "`allow` must be"));

    it("a non-array policy list", () => {
        expect(() => compileStoragePolicies(undefined as never)).toThrow("must be an array");
    });
});

describe("resolveStorageAccessControl", () => {
    it("is undefined when neither is configured", () => {
        expect(resolveStorageAccessControl({})).toBeUndefined();
    });

    it("is the hook alone when there are no policies", () => {
        const hook = (async () => true) as never;
        expect(resolveStorageAccessControl({ storageAuthorize: hook })).toBe(hook);
    });

    it("compiles policies, keeping the hook behind them", async () => {
        const resolved = resolveStorageAccessControl({
            storagePolicies: [{ path: "public/**", allow: "public" }],
            storageAuthorize: (async () => true) as never
        })!;
        await expect(resolved(ctx({ key: "public/a" }))).resolves.toBe(true);
        await expect(resolved(ctx({ key: "elsewhere/a" }))).resolves.toBe(true);
    });

    it("treats an empty policy list as no policies, not as deny-everything", () => {
        const hook = (async () => true) as never;
        expect(resolveStorageAccessControl({ storagePolicies: [], storageAuthorize: hook })).toBe(hook);
    });
});
