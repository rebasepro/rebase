/**
 * What `rebase dev` says as it stops.
 *
 * Ctrl+C printed nothing and left the managed database's daemon running,
 * silently. That it keeps running is the design — the database belongs to the
 * project, and `rebase db url`, `db push` and `console` in another terminal
 * reach the same one — but it was nowhere on screen, nor how to stop it.
 */
import { describe, expect, it } from "vitest";

import { devExitLines } from "./dev";

describe("devExitLines", () => {
    it("on the managed database, says it keeps running, for how long, and how to stop it", () => {
        const text = devExitLines("managed").join("\n");
        expect(text).toContain("keeps running");
        expect(text).toContain("30 minutes");
        expect(text).toContain("rebase db stop");
    });

    it("on Docker, says the container keeps running and how to stop it", () => {
        const text = devExitLines("docker").join("\n");
        expect(text).toContain("keeps running");
        expect(text).toContain("docker compose stop db");
    });

    it("says nothing about a database it did not start", () => {
        expect(devExitLines("external")).toEqual([]);
        expect(devExitLines(null)).toEqual([]);
    });
});
