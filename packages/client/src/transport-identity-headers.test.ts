import { describe, it, expect } from "@jest/globals";
import { SCHEMA_VERSION_HEADER } from "@rebasepro/types";
import { createTransport } from "./transport";

/**
 * The two headers that say *who is calling*.
 *
 * The compatibility matrix has described `x-rebase-schema` as "sent by the SDK"
 * since it was written. It was not: the constant existed in `@rebasepro/types`,
 * the server echoed it back on two routes, and no client ever put it on a
 * request — a documented signal with a receiver and no sender. The same gap
 * cost the control plane the ability to refuse an old CLI by name, because
 * nothing in a `rebase cloud` request said which CLI it was.
 *
 * Both are advisory. Neither can ever displace `Authorization`, which is the
 * one thing a caller-supplied default header set must not be able to do — so
 * that ordering is pinned here rather than left to the spread order surviving
 * the next edit.
 */
describe("transport identity headers", () => {
    it("sends the schema version it was generated against", () => {
        const headers = createTransport({ schemaVersion: "v1:deadbeefdeadbeef" }).getHeaders();
        expect(headers[SCHEMA_VERSION_HEADER]).toBe("v1:deadbeefdeadbeef");
    });

    it("sends nothing when no schema version is configured", () => {
        expect(createTransport({}).getHeaders()).not.toHaveProperty(SCHEMA_VERSION_HEADER);
    });

    it("sends caller-supplied defaults on every request — the CLI's User-Agent", () => {
        const headers = createTransport({
            headers: { "User-Agent": "rebase-cli/0.17.3" }
        }).getHeaders();
        expect(headers["User-Agent"]).toBe("rebase-cli/0.17.3");
    });

    it("refuses to let a default header displace the token", () => {
        const headers = createTransport({
            token: "real-token",
            headers: { Authorization: "Bearer smuggled" }
        }).getHeaders();
        expect(headers.Authorization).toBe("Bearer real-token");
    });

    it("still lets a per-request header win, which is what overrides are for", () => {
        const headers = createTransport({
            schemaVersion: "v1:aaaaaaaaaaaaaaaa"
        }).getHeaders({ headers: { [SCHEMA_VERSION_HEADER]: "v1:bbbbbbbbbbbbbbbb" } });
        expect(headers[SCHEMA_VERSION_HEADER]).toBe("v1:bbbbbbbbbbbbbbbb");
    });
});
