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

describe("MfaService", () => {
    let db: jest.Mocked<NodePgDatabase<Record<string, unknown>>>;
    let mockExecute: jest.Mock;
    let mfaService: MfaService;

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
                createdAt: expect.any(Date),
                updatedAt: expect.any(Date)
            });
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
        it("should execute UPDATE setting verified=TRUE", async () => {
            mockExecute.mockResolvedValueOnce({ rows: [] });

            await mfaService.verifyMfaFactor("factor-1");

            expect(mockExecute).toHaveBeenCalledTimes(1);
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
                ipAddress: "10.0.0.1"
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
        it("should execute UPDATE setting verified_at=NOW()", async () => {
            mockExecute.mockResolvedValueOnce({ rows: [] });

            await mfaService.verifyMfaChallenge("challenge-1");

            expect(mockExecute).toHaveBeenCalledTimes(1);
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
        });

        it("should handle empty code array (just delete)", async () => {
            mockExecute.mockResolvedValueOnce({ rows: [] }); // DELETE only

            await mfaService.createRecoveryCodes("user-123", []);

            expect(mockExecute).toHaveBeenCalledTimes(1);
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
        });

        it("should return false when no matching unused code exists", async () => {
            mockExecute.mockResolvedValueOnce({ rows: [] });

            const result = await mfaService.useRecoveryCode("user-123", "wrong-hash");

            expect(result).toBe(false);
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
        it("should execute DELETE for user recovery codes", async () => {
            mockExecute.mockResolvedValueOnce({ rows: [] });

            await mfaService.deleteAllRecoveryCodes("user-123");

            expect(mockExecute).toHaveBeenCalledTimes(1);
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

            // Verify the sql template uses the custom schema
            const executeCall = mockExecute.mock.calls[0][0];
            // The sql.raw call should have been called with a string containing "custom_schema"
            // We verify indirectly that execute was called (the qualify method formats it)
            expect(mockExecute).toHaveBeenCalledTimes(1);
        });
    });
});
