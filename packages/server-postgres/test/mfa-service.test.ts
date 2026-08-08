import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { MfaService } from "../src/auth/services";

// Mock the drizzle-orm functions — same pattern as auth-services.test.ts
jest.mock("drizzle-orm", () => {
    const actual = jest.requireActual("drizzle-orm");
    return {
        ...actual,
        eq: jest.fn((field, value) => ({ field, value, type: "eq" })),
        sql: Object.assign(
            jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
                strings,
                values,
                type: "sql"
            })),
            {
                raw: jest.fn((val: string) => ({ val, type: "sql-raw" })),
                join: jest.fn((parts: unknown[], separator: unknown) => ({
                    parts,
                    separator,
                    type: "sql-join"
                }))
            }
        ),
        relations: jest.fn(() => ({}))
    };
});

/**
 * The mocked `sql` tag keeps the template pieces and the interpolations, so
 * every statement this service builds is fully inspectable. Rendering it back
 * out is the difference between "a query ran" and "the RIGHT query ran" — most
 * of the statements below carry the uid scoping that stops one user from
 * deleting another user's MFA factor or burning their recovery codes, and a
 * bare `toHaveBeenCalledTimes(1)` cannot see that scoping disappear.
 *
 * An interpolated `sql.raw(...)` is spliced in literally (that is what raw
 * means); everything else is a bound parameter and is rendered as `$n`, so a
 * test can also tell binding apart from inlining.
 */
interface RenderedStatement {
    text: string;
    params: unknown[];
}

function renderStatement(statement: unknown): RenderedStatement {
    const s = statement as { strings: readonly string[]; values: unknown[] };
    const params: unknown[] = [];
    let text = "";
    s.strings.forEach((chunk, i) => {
        text += chunk;
        if (i < s.values.length) {
            const value = s.values[i] as { type?: string; val?: string } | null;
            if (value && typeof value === "object" && value.type === "sql-raw") {
                text += value.val;
            } else {
                params.push(s.values[i]);
                text += `$${params.length}`;
            }
        }
    });
    return { text: text.replace(/\s+/g, " ").trim(), params };
}

describe("MfaService", () => {
    let db: jest.Mocked<NodePgDatabase<Record<string, unknown>>>;
    let mockExecute: jest.Mock;
    let mfaService: MfaService;

    /** Render the nth statement handed to `db.execute`. */
    const statementAt = (index: number): RenderedStatement =>
        renderStatement(mockExecute.mock.calls[index][0]);

    beforeEach(() => {
        mockExecute = jest.fn().mockResolvedValue({ rows: [] });

        db = {
            insert: jest.fn(),
            select: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            execute: mockExecute
        } as unknown as jest.Mocked<NodePgDatabase<Record<string, unknown>>>;

        mfaService = new MfaService(db);
    });

    // =========================================================================
    // createMfaFactor
    // =========================================================================
    describe("createMfaFactor", () => {
        it("should insert and return factor with all mapped fields", async () => {
            const now = new Date().toISOString();
            mockExecute.mockResolvedValueOnce({
                rows: [
                    {
                        id: "factor-1",
                        uid: "user-123",
                        factor_type: "totp",
                        friendly_name: "My Authenticator",
                        verified: false,
                        created_at: now,
                        updated_at: now
                    }
                ]
            });

            const result = await mfaService.createMfaFactor(
                "user-123",
                "totp",
                "encrypted-secret",
                "My Authenticator"
            );

            expect(mockExecute).toHaveBeenCalledTimes(1);
            expect(result).toEqual({
                id: "factor-1",
                uid: "user-123",
                factorType: "totp",
                friendlyName: "My Authenticator",
                verified: false,
                createdAt: expect.any(Date),
                updatedAt: expect.any(Date)
            });
        });

        it("should map null friendly_name to undefined", async () => {
            const now = new Date().toISOString();
            mockExecute.mockResolvedValueOnce({
                rows: [
                    {
                        id: "factor-2",
                        uid: "user-123",
                        factor_type: "totp",
                        friendly_name: null,
                        verified: false,
                        created_at: now,
                        updated_at: now
                    }
                ]
            });

            const result = await mfaService.createMfaFactor(
                "user-123",
                "totp",
                "encrypted-secret"
            );

            expect(result.friendlyName).toBeUndefined();
        });
    });

    // =========================================================================
    // getMfaFactors
    // =========================================================================
    describe("getMfaFactors", () => {
        it("should return all factors for a user", async () => {
            const now = new Date().toISOString();
            mockExecute.mockResolvedValueOnce({
                rows: [
                    {
                        id: "factor-1",
                        uid: "user-123",
                        factor_type: "totp",
                        friendly_name: "App1",
                        verified: true,
                        created_at: now,
                        updated_at: now
                    },
                    {
                        id: "factor-2",
                        uid: "user-123",
                        factor_type: "totp",
                        friendly_name: null,
                        verified: false,
                        created_at: now,
                        updated_at: now
                    }
                ]
            });

            const result = await mfaService.getMfaFactors("user-123");

            expect(mockExecute).toHaveBeenCalledTimes(1);
            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({
                id: "factor-1",
                uid: "user-123",
                factorType: "totp",
                friendlyName: "App1",
                verified: true,
                createdAt: expect.any(Date),
                updatedAt: expect.any(Date)
            });
            expect(result[1].friendlyName).toBeUndefined();
        });

        it("should return empty array when user has no factors", async () => {
            mockExecute.mockResolvedValueOnce({ rows: [] });

            const result = await mfaService.getMfaFactors("user-no-factors");

            expect(result).toEqual([]);
        });
    });

    // =========================================================================
    // getMfaFactorById
    // =========================================================================
    describe("getMfaFactorById", () => {
        it("should return factor with secretEncrypted when found", async () => {
            const now = new Date().toISOString();
            mockExecute.mockResolvedValueOnce({
                rows: [
                    {
                        id: "factor-1",
                        uid: "user-123",
                        factor_type: "totp",
                        secret_encrypted: "enc-secret",
                        friendly_name: "My TOTP",
                        verified: true,
                        last_used_counter: null,
                        created_at: now,
                        updated_at: now
                    }
                ]
            });

            const result = await mfaService.getMfaFactorById("factor-1");

            expect(result).not.toBeNull();
            expect(result).toEqual({
                id: "factor-1",
                uid: "user-123",
                factorType: "totp",
                secretEncrypted: "enc-secret",
                friendlyName: "My TOTP",
                verified: true,
                lastUsedCounter: null,
                createdAt: expect.any(Date),
                updatedAt: expect.any(Date)
            });
        });

        it("reads last_used_counter back as a number", async () => {
            // BIGINT arrives from node-postgres as a string, and a string
            // compared against a number in the route would make every accepted
            // code look unspent — the replay check would pass on both halves.
            const now = new Date().toISOString();
            mockExecute.mockResolvedValueOnce({
                rows: [
                    {
                        id: "factor-1",
                        uid: "user-123",
                        factor_type: "totp",
                        secret_encrypted: "enc-secret",
                        friendly_name: null,
                        verified: true,
                        last_used_counter: "58000000",
                        created_at: now,
                        updated_at: now
                    }
                ]
            });

            const result = await mfaService.getMfaFactorById("factor-1");

            expect(result?.lastUsedCounter).toBe(58000000);
        });

        it("should return null when factor not found", async () => {
            mockExecute.mockResolvedValueOnce({ rows: [] });

            const result = await mfaService.getMfaFactorById("nonexistent");

            expect(result).toBeNull();
        });
    });

    // =========================================================================
    // verifyMfaFactor
    // =========================================================================
    describe("verifyMfaFactor", () => {
        it("should execute UPDATE setting verified=TRUE for exactly that factor", async () => {
            mockExecute.mockResolvedValueOnce({ rows: [] });

            await mfaService.verifyMfaFactor("factor-1");

            expect(mockExecute).toHaveBeenCalledTimes(1);
            const { text, params } = statementAt(0);
            // An UPDATE that lost its WHERE would mark every factor in the
            // table verified, which is exactly the shape a call-count
            // assertion cannot see.
            expect(text).toBe(
                'UPDATE "rebase"."mfa_factors" SET verified = TRUE, updated_at = NOW() WHERE id = $1'
            );
            expect(params).toEqual(["factor-1"]);
        });
    });

    // =========================================================================
    // deleteMfaFactor
    // =========================================================================
    describe("deleteMfaFactor", () => {
        it("should execute DELETE matching factorId AND uid", async () => {
            mockExecute.mockResolvedValueOnce({ rows: [] });

            await mfaService.deleteMfaFactor("factor-1", "user-123");

            expect(mockExecute).toHaveBeenCalledTimes(1);
            const { text, params } = statementAt(0);
            // The uid term IS the security property: factor ids are the only
            // thing the caller supplies, so a DELETE keyed on id alone lets any
            // signed-in user strip MFA off any account they can name a factor
            // for. Both terms are asserted, and so is the order of the bound
            // values, so dropping either half fails here.
            expect(text).toBe(
                'DELETE FROM "rebase"."mfa_factors" WHERE id = $1 AND uid = $2'
            );
            expect(params).toEqual(["factor-1", "user-123"]);
        });
    });

    // =========================================================================
    // createMfaChallenge
    // =========================================================================
    describe("createMfaChallenge", () => {
        it("should create a challenge and return mapped fields", async () => {
            const now = new Date().toISOString();
            mockExecute.mockResolvedValueOnce({
                rows: [
                    {
                        id: "challenge-1",
                        factor_id: "factor-1",
                        created_at: now,
                        verified_at: null,
                        ip_address: "192.168.1.1"
                    }
                ]
            });

            const result = await mfaService.createMfaChallenge(
                "factor-1",
                "192.168.1.1"
            );

            expect(mockExecute).toHaveBeenCalledTimes(1);
            expect(result).toEqual({
                id: "challenge-1",
                factorId: "factor-1",
                createdAt: expect.any(Date),
                verifiedAt: undefined,
                ipAddress: "192.168.1.1"
            });
        });

        it("should pass 5-minute expiration to the SQL query", async () => {
            const frozenTime = 1700000000000;
            jest.spyOn(Date, "now").mockReturnValue(frozenTime);

            const nowIso = new Date(frozenTime).toISOString();
            mockExecute.mockResolvedValueOnce({
                rows: [
                    {
                        id: "challenge-2",
                        factor_id: "factor-1",
                        created_at: nowIso,
                        verified_at: null,
                        ip_address: null
                    }
                ]
            });

            await mfaService.createMfaChallenge("factor-1");

            // The sql tagged template mock receives interpolated values.
            // Find the Date argument passed — it should be exactly 5 min after frozenTime.
            const executeArg = mockExecute.mock.calls[0][0];
            const fiveMinMs = 5 * 60 * 1000;
            const expectedExpiry = new Date(frozenTime + fiveMinMs);

            // The values array from the mocked sql`` call contains the interpolated params.
            // Values order: [factorId, ipAddress, expiresAt]
            const allValues: unknown[] = executeArg.values ?? [];
            const dateValues = allValues.filter(
                (v: unknown): v is Date => v instanceof Date
            );
            expect(dateValues).toHaveLength(1);
            expect(dateValues[0].getTime()).toBe(expectedExpiry.getTime());

            jest.restoreAllMocks();
        });

        it("should handle missing ipAddress by passing null", async () => {
            const now = new Date().toISOString();
            mockExecute.mockResolvedValueOnce({
                rows: [
                    {
                        id: "challenge-3",
                        factor_id: "factor-1",
                        created_at: now,
                        verified_at: null,
                        ip_address: null
                    }
                ]
            });

            const result = await mfaService.createMfaChallenge("factor-1");

            expect(result.ipAddress).toBeUndefined();
        });
    });

    // =========================================================================
    // getMfaChallengeById
    // =========================================================================
    describe("getMfaChallengeById", () => {
        it("should return challenge when found", async () => {
            const now = new Date().toISOString();
            mockExecute.mockResolvedValueOnce({
                rows: [
                    {
                        id: "challenge-1",
                        factor_id: "factor-1",
                        created_at: now,
                        verified_at: null,
                        ip_address: "10.0.0.1"
                    }
                ]
            });

            const result = await mfaService.getMfaChallengeById("challenge-1");

            expect(result).toEqual({
                id: "challenge-1",
                factorId: "factor-1",
                createdAt: expect.any(Date),
                verifiedAt: undefined,
                ipAddress: "10.0.0.1",
                attempts: 0
            });
        });

        it("should return null when challenge not found (expired or verified)", async () => {
            mockExecute.mockResolvedValueOnce({ rows: [] });

            const result = await mfaService.getMfaChallengeById("nonexistent");

            expect(result).toBeNull();
        });

        it("should map verified_at when present", async () => {
            const now = new Date().toISOString();
            mockExecute.mockResolvedValueOnce({
                rows: [
                    {
                        id: "challenge-1",
                        factor_id: "factor-1",
                        created_at: now,
                        verified_at: now,
                        ip_address: null
                    }
                ]
            });

            const result = await mfaService.getMfaChallengeById("challenge-1");

            expect(result).not.toBeNull();
            expect(result!.verifiedAt).toEqual(expect.any(Date));
        });
    });

    // =========================================================================
    // verifyMfaChallenge
    // =========================================================================
    describe("verifyMfaChallenge", () => {
        it("should execute UPDATE setting verified_at=NOW() for exactly that challenge", async () => {
            mockExecute.mockResolvedValueOnce({ rows: [] });

            await mfaService.verifyMfaChallenge("challenge-1");

            expect(mockExecute).toHaveBeenCalledTimes(1);
            const { text, params } = statementAt(0);
            // Marking a challenge verified is what lets a login proceed, so an
            // unscoped UPDATE here would satisfy every outstanding challenge in
            // the table at once.
            expect(text).toBe(
                'UPDATE "rebase"."mfa_challenges" SET verified_at = NOW() WHERE id = $1'
            );
            expect(params).toEqual(["challenge-1"]);
        });
    });

    // =========================================================================
    // createRecoveryCodes
    // =========================================================================
    describe("createRecoveryCodes", () => {
        it("should delete existing codes before inserting new ones", async () => {
            // First call: DELETE existing codes
            // Then one INSERT per code hash
            mockExecute
                .mockResolvedValueOnce({ rows: [] })  // DELETE
                .mockResolvedValueOnce({ rows: [] })  // INSERT code 1
                .mockResolvedValueOnce({ rows: [] })  // INSERT code 2
                .mockResolvedValueOnce({ rows: [] }); // INSERT code 3

            await mfaService.createRecoveryCodes("user-123", [
                "hash-1",
                "hash-2",
                "hash-3"
            ]);

            // 1 DELETE + 3 INSERTs = 4 execute calls
            expect(mockExecute).toHaveBeenCalledTimes(4);

            // The ORDER is the whole point of the test: run the DELETE after
            // the inserts and the user is left with no recovery codes at all,
            // yet the call count is identical either way.
            const delete0 = statementAt(0);
            expect(delete0.text).toBe('DELETE FROM "rebase"."recovery_codes" WHERE uid = $1');
            expect(delete0.params).toEqual(["user-123"]);

            expect([1, 2, 3].map(i => statementAt(i))).toEqual(
                ["hash-1", "hash-2", "hash-3"].map(hash => ({
                    text: 'INSERT INTO "rebase"."recovery_codes" (uid, code_hash) VALUES ($1, $2)',
                    params: ["user-123", hash]
                }))
            );
        });

        it("should handle empty code array (just delete)", async () => {
            mockExecute.mockResolvedValueOnce({ rows: [] }); // DELETE only

            await mfaService.createRecoveryCodes("user-123", []);

            expect(mockExecute).toHaveBeenCalledTimes(1);
            expect(statementAt(0).text).toBe(
                'DELETE FROM "rebase"."recovery_codes" WHERE uid = $1'
            );
        });
    });

    // =========================================================================
    // useRecoveryCode
    // =========================================================================
    describe("useRecoveryCode", () => {
        it("should return true when a matching unused code is found and updated", async () => {
            mockExecute.mockResolvedValueOnce({
                rows: [{ id: "code-1" }]
            });

            const result = await mfaService.useRecoveryCode("user-123", "hash-abc");

            expect(result).toBe(true);
            const { text, params } = statementAt(0);
            // Three predicates, three separate failure modes: without `uid` a
            // recovery code redeems against whichever account happens to share
            // the hash, and without `used_at IS NULL` a single code is reusable
            // forever. The boolean return is identical in all three cases.
            expect(text).toBe(
                'UPDATE "rebase"."recovery_codes" SET used_at = NOW() '
                + "WHERE uid = $1 AND code_hash = $2 AND used_at IS NULL RETURNING id"
            );
            expect(params).toEqual(["user-123", "hash-abc"]);
        });

        it("should return false when no matching unused code exists", async () => {
            mockExecute.mockResolvedValueOnce({ rows: [] });

            const result = await mfaService.useRecoveryCode("user-123", "wrong-hash");

            expect(result).toBe(false);
        });
    });

    // =========================================================================
    // claimMfaFactorCounter
    // =========================================================================
    describe("claimMfaFactorCounter", () => {
        it("claims a TOTP step in one statement, guarded on the stored counter", async () => {
            mockExecute.mockResolvedValueOnce({ rows: [{ id: "factor-1" }] });

            const result = await mfaService.claimMfaFactorCounter("factor-1", 58000000);

            expect(result).toBe(true);
            const { text, params } = statementAt(0);
            // The guard IS the replay protection, and it has to live in the
            // WHERE: reading the counter and then writing it lets two requests
            // carrying the same six digits both pass before either writes,
            // which is exactly the replay this exists to stop. The boolean
            // return looks identical either way.
            expect(text).toBe(
                'UPDATE "rebase"."mfa_factors" SET last_used_counter = $1, updated_at = NOW() '
                + "WHERE id = $2 AND (last_used_counter IS NULL OR last_used_counter < $3) RETURNING id"
            );
            expect(params).toEqual([58000000, "factor-1", 58000000]);
        });

        it("reports a step that was already spent", async () => {
            mockExecute.mockResolvedValueOnce({ rows: [] });

            expect(await mfaService.claimMfaFactorCounter("factor-1", 58000000)).toBe(false);
        });
    });

    // =========================================================================
    // recordMfaChallengeAttempt
    // =========================================================================
    describe("recordMfaChallengeAttempt", () => {
        it("increments in the database and returns the new total", async () => {
            mockExecute.mockResolvedValueOnce({ rows: [{ attempts: 3 }] });

            const result = await mfaService.recordMfaChallengeAttempt("challenge-1");

            expect(result).toBe(3);
            const { text, params } = statementAt(0);
            // `attempts + 1` in SQL, not a value the caller computed: guesses
            // arriving in parallel — the shape any real brute force takes —
            // would otherwise share one increment and the cap would never bite.
            expect(text).toBe(
                'UPDATE "rebase"."mfa_challenges" SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts'
            );
            expect(params).toEqual(["challenge-1"]);
        });

        it("returns 0 when the challenge is gone", async () => {
            mockExecute.mockResolvedValueOnce({ rows: [] });

            expect(await mfaService.recordMfaChallengeAttempt("challenge-1")).toBe(0);
        });
    });

    // =========================================================================
    // getUnusedRecoveryCodeCount
    // =========================================================================
    describe("getUnusedRecoveryCodeCount", () => {
        it("should return the count of unused codes", async () => {
            mockExecute.mockResolvedValueOnce({
                rows: [{ count: 5 }]
            });

            const result = await mfaService.getUnusedRecoveryCodeCount("user-123");

            expect(result).toBe(5);
        });

        it("should return 0 when no unused codes exist", async () => {
            mockExecute.mockResolvedValueOnce({
                rows: [{ count: 0 }]
            });

            const result = await mfaService.getUnusedRecoveryCodeCount("user-123");

            expect(result).toBe(0);
        });
    });

    // =========================================================================
    // deleteAllRecoveryCodes
    // =========================================================================
    describe("deleteAllRecoveryCodes", () => {
        it("should execute DELETE scoped to the user's recovery codes", async () => {
            mockExecute.mockResolvedValueOnce({ rows: [] });

            await mfaService.deleteAllRecoveryCodes("user-123");

            expect(mockExecute).toHaveBeenCalledTimes(1);
            const { text, params } = statementAt(0);
            // "delete ALL recovery codes" means all of ONE user's — without the
            // uid predicate this truncates the table for every account.
            expect(text).toBe('DELETE FROM "rebase"."recovery_codes" WHERE uid = $1');
            expect(params).toEqual(["user-123"]);
        });
    });

    // =========================================================================
    // hasVerifiedMfaFactors
    // =========================================================================
    describe("hasVerifiedMfaFactors", () => {
        it("should return true when user has verified factors", async () => {
            mockExecute.mockResolvedValueOnce({
                rows: [{ count: 2 }]
            });

            const result = await mfaService.hasVerifiedMfaFactors("user-123");

            expect(result).toBe(true);
        });

        it("should return false when user has no verified factors", async () => {
            mockExecute.mockResolvedValueOnce({
                rows: [{ count: 0 }]
            });

            const result = await mfaService.hasVerifiedMfaFactors("user-no-mfa");

            expect(result).toBe(false);
        });

        it("should return true when count is exactly 1", async () => {
            mockExecute.mockResolvedValueOnce({
                rows: [{ count: 1 }]
            });

            const result = await mfaService.hasVerifiedMfaFactors("user-123");

            expect(result).toBe(true);
        });
    });

    // =========================================================================
    // Custom schema name
    // =========================================================================
    describe("custom schema name", () => {
        it("should use custom schema name in qualified table names", async () => {
            const customService = new MfaService(db, "custom_schema");
            mockExecute.mockResolvedValueOnce({ rows: [{ count: 0 }] });

            await customService.hasVerifiedMfaFactors("user-123");

            expect(mockExecute).toHaveBeenCalledTimes(1);
            const { text } = statementAt(0);
            // A constructor argument that never reaches the SQL sends every
            // statement to the default "rebase" schema instead — which on a
            // multi-schema deployment reads someone else's factors, or none.
            expect(text).toContain('"custom_schema"."mfa_factors"');
            expect(text).not.toContain('"rebase".');
        });
    });
});
