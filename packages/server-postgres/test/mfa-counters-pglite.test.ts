/**
 * The MFA brute-force and replay counters, asked of a real Postgres (PGlite).
 *
 * `mfa-service.test.ts` mocks drizzle wholesale, and `mfa-enforcement.test.ts`
 * drives the routes over an in-memory store, so the SQL these two limits rest
 * on had never run against a database:
 *
 * - `recordMfaChallengeAttempt`: the five-guess cap on a challenge is decided
 *   on the total it returns. Guesses arriving together — the shape any real
 *   brute force takes — must each get their own increment. A read-then-write
 *   would hand several of them the same total, and the cap would admit more
 *   guesses than it counts.
 * - `claimMfaFactorCounter`: a TOTP time step is spent once. Two requests
 *   carrying the same six digits must not both pass.
 *
 * The tables come from `ensureAuthTablesExist`, the DDL every deployment runs.
 */
import { describe, expect, it, beforeAll, afterAll } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ensureAuthTablesExist } from "../src/auth/ensure-tables";
import { MfaService } from "../src/auth/services";

let pglite: PGlite;
let mfa: MfaService;
let factorId: string;

beforeAll(async () => {
    pglite = new PGlite();
    await pglite.waitReady;
    const db = drizzle(pglite) as unknown as NodePgDatabase;
    await ensureAuthTablesExist(db);
    mfa = new MfaService(db);

    const { rows } = await pglite.query<{ id: string }>(
        "INSERT INTO rebase.users (email) VALUES ('mfa@example.test') RETURNING id"
    );
    const factor = await mfa.createMfaFactor(String(rows[0].id), "totp", "sealed-secret");
    factorId = factor.id;
}, 60_000);

afterAll(async () => {
    await pglite.close();
});

describe("recordMfaChallengeAttempt, on a real database", () => {
    it("counts each guess once, in order", async () => {
        const challenge = await mfa.createMfaChallenge(factorId);

        expect(await mfa.recordMfaChallengeAttempt(challenge.id)).toBe(1);
        expect(await mfa.recordMfaChallengeAttempt(challenge.id)).toBe(2);
        expect(await mfa.recordMfaChallengeAttempt(challenge.id)).toBe(3);
        expect((await mfa.getMfaChallengeById(challenge.id))?.attempts).toBe(3);
    });

    it("gives guesses that arrive together a distinct total each", async () => {
        const challenge = await mfa.createMfaChallenge(factorId);

        const totals = await Promise.all(
            Array.from({ length: 10 }, () => mfa.recordMfaChallengeAttempt(challenge.id))
        );

        // Ten increments, ten different totals: no two guesses shared one, so a
        // cap of five admits exactly five of them.
        expect([...totals].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        expect((await mfa.getMfaChallengeById(challenge.id))?.attempts).toBe(10);
    });

    it("reports 0 for a challenge that does not exist", async () => {
        expect(await mfa.recordMfaChallengeAttempt("no-such-challenge")).toBe(0);
    });
});

describe("claimMfaFactorCounter, on a real database", () => {
    it("spends a time step once, and refuses an older one", async () => {
        expect(await mfa.claimMfaFactorCounter(factorId, 1_000)).toBe(true);
        expect(await mfa.claimMfaFactorCounter(factorId, 1_000)).toBe(false);
        expect(await mfa.claimMfaFactorCounter(factorId, 999)).toBe(false);
        expect(await mfa.claimMfaFactorCounter(factorId, 1_001)).toBe(true);
    });

    it("lets exactly one of several concurrent replays of the same code through", async () => {
        const results = await Promise.all(
            Array.from({ length: 5 }, () => mfa.claimMfaFactorCounter(factorId, 2_000))
        );

        expect(results.filter(Boolean)).toHaveLength(1);
    });
});
