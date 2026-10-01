/**
 * `security_invoker` is a boolean reloption, and Postgres accepts every
 * `parse_bool` spelling for it — `true`, `on`, `yes`, `1`, and any unique
 * prefix (`t`, `y`, …) — then stores what was written, verbatim.
 *
 * Only `true` and `on` were recognised, so `WITH (security_invoker = 1)` was
 * reported as a critical, certain `view-bypasses-rls` on a view that runs as
 * its caller and bypasses nothing.
 */
import { describe, expect, it } from "vitest";

import { parsePgBool, readViews, type Reader } from "./introspect";

const reader = (views: Record<string, unknown>[]): Reader => ({
    async query<R extends Record<string, unknown>>(what: string): Promise<R[]> {
        return (what === "views" ? views : []) as R[];
    }
});

const viewWith = async (reloptions: string[] | null, serverVersionNum = 160004) => {
    const [view] = await readViews(
        reader([{ schema: "public", name: "v", owner: "postgres", kind: "v", reloptions }]),
        ["public"],
        serverVersionNum
    );
    return view.securityInvoker;
};

describe("readViews: security_invoker", () => {
    it.each([
        "true", "on", "yes", "1", "t", "tr", "tru", "y", "ye", "TRUE", "On", "Yes", "T"
    ])("reads security_invoker=%s as on", async (value) => {
        expect(await viewWith([`security_invoker=${value}`])).toBe(true);
    });

    it.each([
        "false", "off", "no", "0", "f", "fa", "n", "of", "FALSE", "Off"
    ])("reads security_invoker=%s as off", async (value) => {
        expect(await viewWith([`security_invoker=${value}`])).toBe(false);
    });

    it("reads the option among others", async () => {
        expect(await viewWith(["security_barrier=true", "security_invoker=1"])).toBe(true);
        expect(await viewWith(["security_barrier=true"])).toBe(false);
    });

    it("does not read another option's value as this one's", async () => {
        expect(await viewWith(["not_security_invoker=true"])).toBe(false);
    });

    it("is off when the view has no options at all", async () => {
        expect(await viewWith(null)).toBe(false);
    });

    it("is not a question before PG 15, where the option does not exist", async () => {
        expect(await viewWith(["security_invoker=1"], 140010)).toBeNull();
    });
});

describe("parsePgBool", () => {
    it("refuses what Postgres refuses", () => {
        // `o` could be `on` or `off`; the rest are not booleans at all.
        for (const value of ["o", "", "maybe", "10", "truee", "nope", "2"]) {
            expect(parsePgBool(value), value).toBeNull();
        }
    });
});
