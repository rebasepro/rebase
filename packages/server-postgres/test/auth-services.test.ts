import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { UserService, RefreshTokenService, PasswordResetTokenService, Role } from "../src/auth/services";
import { users, refreshTokens, passwordResetTokens, userIdentities } from "../src/schema/auth-schema";
import { UserData } from "@rebasepro/server";

// Mock the drizzle-orm functions
jest.mock("drizzle-orm", () => {
    const actual = jest.requireActual("drizzle-orm");
    return {
        ...actual,
        eq: jest.fn((field, value) => ({ field,
value,
type: "eq" })),
        sql: Object.assign(
            jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
                strings,
                values,
                type: "sql"
            })),
            {
                raw: jest.fn((val: string) => ({ val,
type: "sql-raw" })),
                join: jest.fn((parts: unknown[], separator: unknown) => ({ parts,
separator,
type: "sql-join" }))
            }
        ),
        relations: jest.fn(() => ({}))
    };
});

/**
 * Read a statement back out of the mocked `sql` tag above.
 *
 * The mock keeps the template's literal parts and its interpolations instead of
 * compiling a query, so what a service actually sends is only visible by
 * reassembling the two: `sql.raw` fragments are literal SQL and belong in the
 * text, everything else is a bound value and belongs in `values`. Asserting on
 * the pair is what distinguishes "a statement was executed" from "the right
 * table was updated, scoped to the right row".
 */
function readSql(query: unknown): { text: string; values: unknown[] } {
    const { strings = [], values = [] } = (query ?? {}) as {
        strings?: readonly string[];
        values?: unknown[];
    };
    const isRaw = (v: unknown): v is { val: string } =>
        typeof v === "object" && v !== null && (v as { type?: string }).type === "sql-raw";

    const text = strings
        .map((part, i) => {
            if (i >= values.length) return part;
            return part + (isRaw(values[i]) ? (values[i] as { val: string }).val : "?");
        })
        .join("")
        .replace(/\s+/g, " ")
        .trim();

    return { text,
        values: values.filter((v) => !isRaw(v)) };
}

function mockUserData(overrides: Partial<UserData>): UserData {
    return {
        id: "user-123",
        email: "test@example.com",
        passwordHash: null,
        displayName: null,
        photoUrl: null,
        emailVerified: false,
        emailVerificationToken: null,
        emailVerificationSentAt: null,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
        metadata: {},
        isAnonymous: false,
        ...overrides
    };
}

describe("Auth Services", () => {
    let db: jest.Mocked<NodePgDatabase<Record<string, unknown>>>;
    let mockInsertValues: jest.Mock;
    let mockInsertReturning: jest.Mock;
    let mockSelectFrom: jest.Mock;
    let mockSelectWhere: jest.Mock;
    let mockUpdateSet: jest.Mock;
    let mockUpdateWhere: jest.Mock;
    let mockUpdateReturning: jest.Mock;
    let mockDeleteWhere: jest.Mock;
    let mockExecute: jest.Mock;

    beforeEach(() => {
        // Create chainable mocks
        mockInsertReturning = jest.fn().mockResolvedValue([]);
        mockInsertValues = jest.fn().mockReturnValue({
            returning: mockInsertReturning,
            onConflictDoUpdate: jest.fn().mockReturnValue({ returning: mockInsertReturning }),
            onConflictDoNothing: jest.fn().mockReturnValue({ returning: mockInsertReturning })
        });

        mockSelectWhere = jest.fn().mockResolvedValue([]);
        mockSelectFrom = jest.fn();

        mockUpdateReturning = jest.fn().mockResolvedValue([]);
        mockUpdateWhere = jest.fn().mockReturnValue({ returning: mockUpdateReturning });
        mockUpdateSet = jest.fn().mockReturnValue({ where: mockUpdateWhere });

        mockDeleteWhere = jest.fn().mockResolvedValue(undefined);

        mockExecute = jest.fn().mockResolvedValue({ rows: [] });

        // Set up chainable mock for db.select()
        const mockChain: any = {};
        mockChain.from = jest.fn().mockImplementation((...args) => {
            const result = mockSelectFrom(...args);
            if (result && typeof result.then === "function") {
                return result; // If listUsers mocks selectFrom to return a promise, return it directly
            }
            return mockChain;
        });
        mockChain.innerJoin = jest.fn().mockReturnValue(mockChain);
        mockChain.where = jest.fn().mockImplementation((...args) => {
            mockChain.wherePromise = mockSelectWhere(...args);
            return mockChain;
        });
        mockChain.limit = jest.fn().mockReturnValue(mockChain);
        mockChain.offset = jest.fn().mockReturnValue(mockChain);
        mockChain.orderBy = jest.fn().mockReturnValue(mockChain);
        mockChain.then = jest.fn().mockImplementation(async (onFulfilled) => {
            let val;
            if (mockChain.wherePromise) {
                val = await mockChain.wherePromise;
                mockChain.wherePromise = null;
            } else if (mockSelectWhere.mock.calls.length > 0) {
                const result = mockSelectWhere.mock.results[mockSelectWhere.mock.results.length - 1];
                val = result.type === "return" ? result.value : undefined;
                if (val && typeof val.then === "function") {
                    val = await val;
                }
            } else {
                val = [];
            }
            return onFulfilled(val || []);
        });

        db = {
            insert: jest.fn().mockReturnValue({ values: mockInsertValues }),
            select: jest.fn().mockReturnValue(mockChain),
            update: jest.fn().mockReturnValue({ set: mockUpdateSet }),
            delete: jest.fn().mockReturnValue({ where: mockDeleteWhere }),
            execute: mockExecute,
            // Privileged writes run through withServerContext → db.transaction;
            // hand the callback the same mock so the builder assertions still apply.
            transaction: jest.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(db))
        } as unknown as jest.Mocked<NodePgDatabase<Record<string, unknown>>>;

        // Set default return value for mockSelectFrom to return mockChain (chainable)
        mockSelectFrom.mockReturnValue(mockChain);
    });

    describe("UserService", () => {
        let userService: UserService;

        beforeEach(() => {
            userService = new UserService(db);
        });

        describe("createUser", () => {
            it("should create a user and return it", async () => {
                const newUser = {
                    email: "test@example.com",
                    displayName: "Test User"
                };
                const dbReturnedUser = {
                    id: "user-123",
                    ...newUser,
                    createdAt: new Date(),
                    updatedAt: new Date()
                };
                mockInsertReturning.mockResolvedValueOnce([dbReturnedUser]);

                const result = await userService.createUser(newUser);

                expect(db.insert).toHaveBeenCalledWith(users);
                expect(mockInsertValues).toHaveBeenCalledWith({
                    ...newUser,
                    metadata: {}
                });
                expect(result).toEqual(mockUserData({ displayName: "Test User" }));
            });

            it("folds the email to lower case on write, not just on read", async () => {
                // The asymmetry this closes: getUserByEmail has always searched
                // `email.toLowerCase()`, while the write path stored whatever it
                // was handed. A row that arrived mixed-case was then invisible
                // to every lookup — the account exists, sign-in reports no such
                // user — and the byte-exact UNIQUE on the column would not stop
                // a second row differing only in case.
                mockInsertReturning.mockResolvedValueOnce([{ id: "user-123", email: "test@example.com" }]);

                await userService.createUser({ email: "  Test@Example.COM " });

                expect(mockInsertValues).toHaveBeenCalledWith(
                    expect.objectContaining({ email: "test@example.com" })
                );
            });

            /**
             * `POST /auth/register` reads `getUserByEmail` and answers 409
             * before inserting. The read cannot hold its answer still, so the
             * `email` UNIQUE and the `lower(email)` index behind it are what
             * actually enforce one account per address — and two clicks on a
             * signup button are enough to get both requests past the check.
             *
             * The loser's insert then raises 23505. Unmapped, that reaches the
             * person who clicked twice as a 500 "Internal Server Error", and
             * sends the operator looking for a fault that is not there.
             * `PersistService` has mapped 23505 to a conflict for collection
             * writes since the layer holding the SQLSTATE was made responsible
             * for saying whose fault a failure is; this is the auth writes
             * getting the same treatment.
             */
            it("answers a lost duplicate-email race with the 409 the pre-check gives", async () => {
                // Drizzle wraps the pg error, so the SQLSTATE sits on `cause`.
                const wrapped = Object.assign(new Error("insert failed"), {
                    cause: Object.assign(new Error("duplicate key value violates unique constraint"), {
                        code: "23505",
                        constraint: "users_email_lower_key"
                    })
                });
                mockInsertReturning.mockRejectedValueOnce(wrapped);

                await expect(userService.createUser({ email: "racer@example.com" })).rejects.toMatchObject({
                    statusCode: 409,
                    code: "EMAIL_EXISTS"
                });
            });

            it("lets every other database failure through unchanged", async () => {
                // A dropped connection is not the caller's fault and must not
                // be dressed up as one — 42501 is an RLS refusal, 08006 a
                // connection failure, and neither means "email taken".
                const wrapped = Object.assign(new Error("insert failed"), {
                    cause: Object.assign(new Error("connection terminated"), { code: "08006" })
                });
                mockInsertReturning.mockRejectedValueOnce(wrapped);

                await expect(userService.createUser({ email: "someone@example.com" }))
                    .rejects.toThrow(/insert failed/);
            });

            it("clears the RLS GUCs inside a transaction before the insert", async () => {
                mockInsertReturning.mockResolvedValueOnce([{ id: "user-123", email: "test@example.com" }]);

                await userService.createUser({ email: "test@example.com" });

                expect(db.transaction).toHaveBeenCalledTimes(1);
                // The set_config reset must run before the insert so a leaked
                // pooled-connection context can never scope the privileged write.
                const firstExecuteSql = mockExecute.mock.calls[0]?.[0] as { strings?: readonly string[] } | undefined;
                const sqlText = (firstExecuteSql?.strings ?? []).join("");
                expect(sqlText).toContain("set_config('app.uid', '', true)");
                // The pre-rename GUC must be cleared too: a policy written
                // against `app.user_id` would otherwise read a leaked value and
                // scope this privileged write.
                expect(sqlText).toContain("set_config('app.user_id', '', true)");
                expect(sqlText).toContain("set_config('app.user_roles', '', true)");
                expect(sqlText).toContain("set_config('app.jwt', '', true)");
                expect(db.insert).toHaveBeenCalledWith(users);
            });
        });

        describe("getUserById", () => {
            it("should return user when found", async () => {
                const mockUser = { id: "user-123",
email: "test@example.com" };
                mockSelectWhere.mockResolvedValueOnce([mockUser]);

                const result = await userService.getUserById("user-123");

                expect(db.select).toHaveBeenCalled();
                expect(result).toEqual(mockUserData({}));
            });

            it("should return null when user not found", async () => {
                mockSelectWhere.mockResolvedValueOnce([]);

                const result = await userService.getUserById("nonexistent");

                expect(result).toBeNull();
            });
        });

        describe("getUserByEmail", () => {
            it("should return user when found by email", async () => {
                const mockUser = { id: "user-123",
email: "test@example.com" };
                mockSelectWhere.mockResolvedValueOnce([mockUser]);

                const result = await userService.getUserByEmail("test@example.com");

                expect(result).toEqual(mockUserData({}));
            });

            it("should lowercase email for lookup", async () => {
                mockSelectWhere.mockResolvedValueOnce([]);

                await userService.getUserByEmail("  TEST@Example.COM ");

                // This is the only lookup every sign-in path has. The column is
                // byte-exact, so a comparison that keeps the caller's casing (or
                // its stray whitespace) misses a row that is right there and the
                // account reports as nonexistent.
                expect(mockSelectWhere).toHaveBeenCalledTimes(1);
                expect(mockSelectWhere).toHaveBeenCalledWith({
                    type: "eq",
                    field: users.email,
                    value: "test@example.com"
                });
            });
        });

        describe("getUserByIdentity", () => {
            it("should fetch user by identity", async () => {
                const mockUser = { id: "user-123",
email: "test@example.com" };
                mockSelectWhere.mockResolvedValueOnce([{ user: mockUser }]);

                const result = await userService.getUserByIdentity("google", "google-abc");

                expect(db.select).toHaveBeenCalled();
                expect(result).toEqual(expect.objectContaining({ id: "user-123",
email: "test@example.com" }));
            });
        });

        describe("getUserIdentities", () => {
            it("should fetch user identities", async () => {
                const createdAt = new Date("2026-01-01T00:00:00Z");
                const updatedAt = new Date("2026-01-02T00:00:00Z");
                mockExecute.mockResolvedValueOnce({
                    rows: [
                        {
                            id: "identity-1",
                            uid: "user-123",
                            provider: "google",
                            provider_id: "google-abc",
                            profile_data: { email: "test@test.com" },
                            created_at: createdAt,
                            updated_at: updatedAt
                        },
                        {
                            id: "identity-2",
                            uid: "user-123",
                            provider: "github",
                            provider_id: "gh-9",
                            profile_data: null,
                            created_at: createdAt,
                            updated_at: updatedAt
                        }
                    ]
                });

                const result = await userService.getUserIdentities("user-123");

                const { text, values } = readSql(mockExecute.mock.calls[0][0]);
                expect(text).toContain('FROM "rebase"."user_identities"');
                // Bound, and scoped to one user: this answers "which providers
                // can sign this account in", so an unscoped read would hand a
                // caller every account's identities.
                expect(text).toContain("WHERE uid = ?");
                expect(values).toEqual(["user-123"]);

                // The row is snake_case and the interface is camelCase. A column
                // left unmapped reads as `undefined` at every call site rather
                // than failing, which is how a linked provider becomes invisible.
                expect(result).toEqual([
                    {
                        id: "identity-1",
                        uid: "user-123",
                        provider: "google",
                        providerId: "google-abc",
                        profileData: { email: "test@test.com" },
                        createdAt,
                        updatedAt
                    },
                    {
                        id: "identity-2",
                        uid: "user-123",
                        provider: "github",
                        providerId: "gh-9",
                        profileData: null,
                        createdAt,
                        updatedAt
                    }
                ]);
            });
        });

        describe("linkUserIdentity", () => {
            it("should insert user identity", async () => {
                await userService.linkUserIdentity("user-123", "google", "123", { email: "test@test.com" });

                expect(db.insert).toHaveBeenCalledWith(userIdentities);
                expect(mockInsertValues).toHaveBeenCalledWith({
                    uid: "user-123",
                    provider: "google",
                    providerId: "123",
                    profileData: { email: "test@test.com" }
                });

                // Linking is reached again on every subsequent sign-in with the
                // same provider account, so the conflict target is what keeps
                // one identity one row instead of one row per sign-in.
                const insertChain = mockInsertValues.mock.results[0].value;
                expect(insertChain.onConflictDoNothing).toHaveBeenCalledWith({
                    target: [userIdentities.provider, userIdentities.providerId]
                });
            });

            it("stores a missing profile as null, not undefined", async () => {
                // `undefined` is dropped from the insert entirely, which leaves
                // the column to its default rather than recording that this
                // provider returned no profile.
                await userService.linkUserIdentity("user-123", "google", "123");

                expect(mockInsertValues).toHaveBeenCalledWith(
                    expect.objectContaining({ profileData: null })
                );
            });
        });

        describe("updateUser", () => {
            it("should update user and return updated record", async () => {
                const updatedUser = {
                    id: "user-123",
                    email: "test@example.com",
                    displayName: "Updated Name"
                };
                mockUpdateReturning.mockResolvedValueOnce([updatedUser]);

                const result = await userService.updateUser("user-123", { displayName: "Updated Name" });

                expect(db.update).toHaveBeenCalledWith(users);
                expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
                    displayName: "Updated Name",
                    updatedAt: expect.any(Date)
                }));
                expect(result).toEqual(mockUserData({ displayName: "Updated Name" }));
            });

            it("should return null when user not found", async () => {
                mockUpdateReturning.mockResolvedValueOnce([]);

                const result = await userService.updateUser("nonexistent", { displayName: "Test" });

                expect(result).toBeNull();
            });
        });

        describe("deleteUser", () => {
            it("should delete user by ID", async () => {
                await userService.deleteUser("user-123");

                expect(db.delete).toHaveBeenCalledWith(users);
                expect(mockDeleteWhere).toHaveBeenCalled();
            });
        });

        describe("listUsers", () => {
            it("should return all users", async () => {
                const mockUsers = [
                    { id: "user-1",
email: "user1@example.com" },
                    { id: "user-2",
email: "user2@example.com" }
                ];
                mockSelectFrom.mockReturnValueOnce(Promise.resolve(mockUsers));

                const result = await userService.listUsers();

                expect(db.select).toHaveBeenCalled();
                expect(result).toEqual([
                    mockUserData({ id: "user-1",
email: "user1@example.com" }),
                    mockUserData({ id: "user-2",
email: "user2@example.com" })
                ]);
            });
        });

        describe("updatePassword", () => {
            it("should update password hash", async () => {
                mockUpdateWhere.mockResolvedValueOnce(undefined);

                await userService.updatePassword("user-123", "new-hash");

                expect(db.update).toHaveBeenCalledWith(users);
                expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
                    passwordHash: "new-hash",
                    updatedAt: expect.any(Date)
                }));
            });
        });

        describe("setEmailVerified", () => {
            it("should set email verified and clear token", async () => {
                mockUpdateWhere.mockResolvedValueOnce(undefined);

                await userService.setEmailVerified("user-123", true);

                expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
                    emailVerified: true,
                    emailVerificationToken: null,
                    updatedAt: expect.any(Date)
                }));
            });
        });

        describe("setVerificationToken", () => {
            it("should set verification token", async () => {
                mockUpdateWhere.mockResolvedValueOnce(undefined);

                await userService.setVerificationToken("user-123", "token-abc");

                expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
                    emailVerificationToken: "token-abc",
                    emailVerificationSentAt: expect.any(Date),
                    updatedAt: expect.any(Date)
                }));
            });

            it("should clear verification token when null", async () => {
                mockUpdateWhere.mockResolvedValueOnce(undefined);

                await userService.setVerificationToken("user-123", null);

                expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
                    emailVerificationToken: null,
                    emailVerificationSentAt: null,
                    updatedAt: expect.any(Date)
                }));
            });
        });

        describe("getUserByVerificationToken", () => {
            it("should find user by verification token", async () => {
                const mockUser = { id: "user-123",
email: "test@example.com" };
                mockSelectWhere.mockResolvedValueOnce([mockUser]);

                const result = await userService.getUserByVerificationToken("token-abc");

                expect(result).toEqual(mockUserData({}));
            });
        });

        describe("getUserRoles", () => {
            it("should return roles for user", async () => {
                mockExecute.mockResolvedValueOnce({
                    rows: [{ roles: ["admin", "editor"] }]
                });

                const roles = await userService.getUserRoles("user-123");

                expect(roles).toHaveLength(2);
                expect(roles[0]).toEqual({
                    id: "admin",
                    name: "admin",
                    isAdmin: true,
                    defaultPermissions: null,
                    collectionPermissions: null
                });
            });
        });

        describe("getUserRoleIds", () => {
            it("should return role IDs for user", async () => {
                mockExecute.mockResolvedValueOnce({
                    rows: [{ roles: ["admin"] }]
                });

                const roleIds = await userService.getUserRoleIds("user-123");

                expect(roleIds).toEqual(["admin"]);
            });
        });

        describe("setUserRoles", () => {
            it("should replace the whole role array in one update", async () => {
                await userService.setUserRoles("user-123", ["admin", "editor"]);

                // Call 0 is the GUC reset withServerContext runs first; the
                // statement under test is the one inside the transaction.
                const { text, values } = readSql(mockExecute.mock.calls[1][0]);
                expect(text).toContain('UPDATE "rebase"."users"');
                expect(text).toContain("SET roles = ?::text[]");
                expect(text).toContain("WHERE id = ?");
                // The roles are handed to Postgres as one array literal, so the
                // exact spelling is the whole contract: a JSON array or a bare
                // comma list is either rejected or stored as a single junk role.
                expect(values).toEqual(["{admin,editor}", "user-123"]);
            });
        });

        describe("assignDefaultRole", () => {
            it("should assign default role to user", async () => {
                await userService.assignDefaultRole("user-123", "editor");

                const { text, values } = readSql(mockExecute.mock.calls[1][0]);
                expect(text).toContain('UPDATE "rebase"."users"');
                // Appends to whatever the user already has. An assignment would
                // silently strip the roles an admin granted before this ran.
                expect(text).toContain("SET roles = array_append(roles, ?)");
                expect(text).toContain("WHERE id = ?");
                expect(values.slice(0, 2)).toEqual(["editor", "user-123"]);
            });

            it("does not append a role the user already holds", async () => {
                await userService.assignDefaultRole("user-123", "editor");

                // Runs on every sign-up path and is retried on some, so without
                // the guard a role accumulates duplicates in the array — and
                // `roles` is what the RLS policies read.
                const { text, values } = readSql(mockExecute.mock.calls[1][0]);
                expect(text).toContain("NOT (? = ANY(roles))");
                expect(values).toEqual(["editor", "user-123", "editor"]);
            });
        });

        describe("getUserWithRoles", () => {
            it("should return user with roles", async () => {
                const mockUser = { id: "user-123",
email: "test@example.com" };
                mockSelectWhere.mockResolvedValueOnce([mockUser]);
                mockExecute.mockResolvedValueOnce({
                    rows: [{ roles: ["admin"] }]
                });

                const result = await userService.getUserWithRoles("user-123");

                expect(result).toEqual({
                    user: mockUserData({}),
                    roles: [{ id: "admin",
                        name: "admin",
                        isAdmin: true,
                        defaultPermissions: null,
                        collectionPermissions: null }]
                });
            });

            it("should return null when user not found", async () => {
                mockSelectWhere.mockResolvedValueOnce([]);

                const result = await userService.getUserWithRoles("nonexistent");

                expect(result).toBeNull();
            });
        });

        describe("listUsersPaginated", () => {
            it("should return paginated and filtered users list", async () => {
                mockExecute
                    .mockResolvedValueOnce({ rows: [{ total: 1 }] })
                    .mockResolvedValueOnce({ rows: [{ id: "user-123",
email: "test@example.com" }] });

                const result = await userService.listUsersPaginated({
                    limit: 10,
                    offset: 0,
                    search: "test",
                    orderBy: "email",
                    orderDir: "asc"
                });

                expect(mockExecute).toHaveBeenCalledTimes(2);
                expect(result).toEqual({
                    users: [mockUserData({ id: "user-123",
email: "test@example.com" })],
                    total: 1,
                    limit: 10,
                    offset: 0
                });
            });
        });
    });

    describe("RefreshTokenService", () => {
        let refreshTokenService: RefreshTokenService;

        beforeEach(() => {
            refreshTokenService = new RefreshTokenService(db);
        });

        describe("createToken", () => {
            it("should create a refresh token", async () => {
                const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

                await refreshTokenService.createToken("user-123", "token-hash", expiresAt);

                expect(db.insert).toHaveBeenCalledWith(refreshTokens);
                expect(mockInsertValues).toHaveBeenCalledWith({
                    uid: "user-123",
                    tokenHash: "token-hash",
                    expiresAt,
                    ipAddress: "",
                    userAgent: ""
                });
            });
        });

        describe("findByHash", () => {
            it("should find token by hash", async () => {
                const expiresAt = new Date();
                mockSelectWhere.mockResolvedValueOnce([{ uid: "user-123",
expiresAt }]);

                const result = await refreshTokenService.findByHash("token-hash");

                expect(result).toEqual({ uid: "user-123",
expiresAt });
            });

            it("should return null when token not found", async () => {
                mockSelectWhere.mockResolvedValueOnce([]);

                const result = await refreshTokenService.findByHash("nonexistent");

                expect(result).toBeNull();
            });
        });

        describe("deleteByHash", () => {
            it("should delete token by hash", async () => {
                await refreshTokenService.deleteByHash("token-hash");

                expect(db.delete).toHaveBeenCalledWith(refreshTokens);
            });
        });

        describe("deleteAllForUser", () => {
            it("should delete all tokens for user", async () => {
                await refreshTokenService.deleteAllForUser("user-123");

                expect(db.delete).toHaveBeenCalledWith(refreshTokens);
            });
        });
    });

    describe("PasswordResetTokenService", () => {
        let passwordResetTokenService: PasswordResetTokenService;

        beforeEach(() => {
            passwordResetTokenService = new PasswordResetTokenService(db);
        });

        describe("createToken", () => {
            it("should delete existing tokens and create new one", async () => {
                const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

                await passwordResetTokenService.createToken("user-123", "token-hash", expiresAt);

                // First deletes existing unused tokens
                const { text, values } = readSql(mockExecute.mock.calls[0][0]);
                expect(text).toContain('DELETE FROM "rebase"."password_reset_tokens"');
                // Both halves of the predicate carry weight: `uid` keeps one
                // user's reset request from invalidating everyone else's, and
                // `used_at IS NULL` keeps the record of tokens already spent —
                // which is what makes a replayed link detectable.
                expect(text).toContain("WHERE uid = ? AND used_at IS NULL");
                expect(values).toEqual(["user-123"]);

                // Then inserts new token
                expect(db.insert).toHaveBeenCalledWith(passwordResetTokens);
                expect(mockInsertValues).toHaveBeenCalledWith({
                    uid: "user-123",
                    tokenHash: "token-hash",
                    expiresAt
                });
            });
        });

        describe("findValidByHash", () => {
            it("should find valid token", async () => {
                const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
                mockSelectWhere.mockResolvedValueOnce([{ uid: "user-123",
expiresAt }]);
                mockExecute.mockResolvedValueOnce({
                    rows: [{ uid: "user-123",
expires_at: expiresAt }]
                });

                const result = await passwordResetTokenService.findValidByHash("token-hash");

                expect(result).toEqual({ uid: "user-123",
expiresAt });
            });

            it("should return null when token not found", async () => {
                mockSelectWhere.mockResolvedValueOnce([]);

                const result = await passwordResetTokenService.findValidByHash("nonexistent");

                expect(result).toBeNull();
            });

            it("should return null when token is expired or used", async () => {
                const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
                mockSelectWhere.mockResolvedValueOnce([{ uid: "user-123",
expiresAt }]);
                mockExecute.mockResolvedValueOnce({ rows: [] }); // No valid token found

                const result = await passwordResetTokenService.findValidByHash("token-hash");

                expect(result).toBeNull();
            });
        });

        describe("markAsUsed", () => {
            it("should mark token as used", async () => {
                await passwordResetTokenService.markAsUsed("token-hash");

                expect(db.update).toHaveBeenCalledWith(passwordResetTokens);
                expect(mockUpdateSet).toHaveBeenCalledWith({ usedAt: expect.any(Date) });
            });
        });

        describe("deleteAllForUser", () => {
            it("should delete all tokens for user", async () => {
                await passwordResetTokenService.deleteAllForUser("user-123");

                expect(db.delete).toHaveBeenCalledWith(passwordResetTokens);
            });
        });

        describe("deleteExpired", () => {
            it("should delete expired tokens", async () => {
                await passwordResetTokenService.deleteExpired();

                const { text, values } = readSql(mockExecute.mock.calls[0][0]);
                expect(text).toContain('DELETE FROM "rebase"."password_reset_tokens"');
                // This is housekeeping run unattended against live rows, so the
                // predicate is the only thing standing between it and every
                // valid reset link in flight.
                expect(text).toContain("WHERE expires_at < NOW()");
                expect(values).toEqual([]);
            });
        });
    });
});
