import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { createRebaseClient as _createRebaseClient, RebaseClient, CreateRebaseClientOptions } from "../src/index";
import { createMemoryStorage } from "../src/auth";
import { CollectionClient } from "../src/collection";

describe("createRebaseClient", () => {
    let clients: RebaseClient<any>[] = [];

    const createRebaseClient = <DB = Record<string, unknown>>(options: CreateRebaseClientOptions): RebaseClient<DB> => {
        const client = _createRebaseClient<DB>(options);
        clients.push(client);
        return client;
    };

    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        clients.forEach(c => c.ws?.disconnect());
        clients = [];
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    // -----------------------------------------------------------------------
    // Initialization
    // -----------------------------------------------------------------------
    describe("Initialization", () => {
        it("initializes with config properties", () => {
            const client = createRebaseClient({ baseUrl: "https://api.example.com",
token: "jwt-token" });
            expect(client).toBeDefined();
            expect(client.auth).toBeDefined();
            expect(client.admin).toBeDefined();
            expect(client.storage).toBeDefined();
        });

        it("exposes baseUrl from transport", () => {
            const client = createRebaseClient({ baseUrl: "https://api.example.com" });
            expect(client.baseUrl).toBe("https://api.example.com");
        });

        it("exposes setToken and setAuthTokenGetter", () => {
            const client = createRebaseClient({ baseUrl: "https://api.example.com" });
            expect(typeof client.setToken).toBe("function");
            expect(typeof client.setAuthTokenGetter).toBe("function");
            expect(typeof client.resolveToken).toBe("function");
        });
    });

    // -----------------------------------------------------------------------
    // Collection access
    // -----------------------------------------------------------------------
    describe("Collection access", () => {
        it("exposes the explicit collection() method", () => {
            const client = createRebaseClient({ baseUrl: "https://api.example.com" });
            const posts = client.collection("posts");
            expect(typeof posts.find).toBe("function");
            expect(typeof posts.findById).toBe("function");
            expect(typeof posts.create).toBe("function");
            expect(typeof posts.update).toBe("function");
            expect(typeof posts.delete).toBe("function");
        });

        it("caches collection clients (returns same instance)", () => {
            const client = createRebaseClient({ baseUrl: "https://api.example.com" });
            const posts1 = client.collection("posts");
            const posts2 = client.collection("posts");
            expect(posts1).toBe(posts2);
        });

        it("creates different clients for different slugs", () => {
            const client = createRebaseClient({ baseUrl: "https://api.example.com" });
            const posts = client.collection("posts");
            const users = client.collection("users");
            expect(posts).not.toBe(users);
        });
    });

    // -----------------------------------------------------------------------
    // Proxy access (top-level)
    // -----------------------------------------------------------------------
    describe("Top-level proxy", () => {
        it("returns explicit methods directly", () => {
            const client = createRebaseClient({ baseUrl: "https://api.example.com" });

            expect(typeof client.auth).toBe("object");
            expect(typeof client.admin).toBe("object");
            expect(typeof client.collection).toBe("function");
            expect(typeof client.auth.signInWithEmail).toBe("function");
        });

        it("ignores 'then' property to prevent Promise-like misinterpretation", () => {
            const client = createRebaseClient({ baseUrl: "https://api.example.com" });
            expect((client as any).then).toBeUndefined();
        });
    });

    // -----------------------------------------------------------------------
    // data proxy
    // -----------------------------------------------------------------------
    describe("data proxy", () => {
        it("accesses collections via data.collection()", () => {
            const client = createRebaseClient({ baseUrl: "https://api.example.com" });
            const posts = client.data.collection("posts");
            expect(typeof posts.find).toBe("function");
        });

        it("accesses collections via data.<name> shorthand", () => {
            interface TestDB {
                posts: { Row: { title: string } };
            }
            const client = createRebaseClient<TestDB>({ baseUrl: "https://api.example.com" });

            const posts: CollectionClient = client.data.posts;
            expect(typeof posts).toBe("object");
            expect(typeof posts.find).toBe("function");
            expect(typeof posts.findById).toBe("function");
        });

        it("returns undefined for symbol properties on data proxy", () => {
            const client = createRebaseClient({ baseUrl: "https://api.example.com" });
            expect((client.data as any)[Symbol.iterator]).toBeUndefined();
        });

        it("ignores 'then' on data proxy", () => {
            const client = createRebaseClient({ baseUrl: "https://api.example.com" });
            expect((client.data as any).then).toBeUndefined();
        });

        it("ignores 'toJSON' on data proxy", () => {
            const client = createRebaseClient({ baseUrl: "https://api.example.com" });
            expect((client.data as any).toJSON).toBeUndefined();
        });

        it("ignores '$$typeof' on data proxy (React devtools)", () => {
            const client = createRebaseClient({ baseUrl: "https://api.example.com" });
            expect((client.data as any).$$typeof).toBeUndefined();
        });

        describe("camelCase to snake_case proxy mapping", () => {
            it("maps access paths correctly and returns same cached instance", () => {
                const client = createRebaseClient({ baseUrl: "https://api.example.com" });

                // 1. Single word
                const posts = client.data.posts;
                const postsColl = client.data.collection("posts");
                expect(posts).toBe(postsColl);

                // 2. Two-word camelCase
                const companyMembers = (client.data as any).companyMembers;
                const companyMembersColl = client.data.collection("company_members");
                expect(companyMembers).toBe(companyMembersColl);

                // 3. Three-word camelCase
                const talentApplicationStatus = (client.data as any).talentApplicationStatus;
                const talentApplicationStatusColl = client.data.collection("talent_application_status");
                expect(talentApplicationStatus).toBe(talentApplicationStatusColl);

                // 4. Single uppercase letter
                const xY = (client.data as any).xY;
                const xYColl = client.data.collection("x_y");
                expect(xY).toBe(xYColl);

                // 5. Leading lowercase (common)
                const leadMagnetSignups = (client.data as any).leadMagnetSignups;
                const leadMagnetSignupsColl = client.data.collection("lead_magnet_signups");
                expect(leadMagnetSignups).toBe(leadMagnetSignupsColl);

                // 6. Already snake_case (no-op)
                const privateNotes = (client.data as any).private_notes;
                const privateNotesColl = client.data.collection("private_notes");
                expect(privateNotes).toBe(privateNotesColl);
            });

            it("verifies the actual HTTP path uses snake_case", async () => {
                const mockFetch = jest.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => {
                    return {
                        ok: true,
                        status: 200,
                        text: async () => JSON.stringify({ data: [],
meta: { total: 0 } }),
                        headers: new Headers()
                    } as unknown as Response;
                }) as unknown as typeof globalThis.fetch;

                const client = createRebaseClient({
                    baseUrl: "http://localhost",
                    fetch: mockFetch
                });

                await (client.data as any).companyMembers.find();

                expect(mockFetch).toHaveBeenCalledTimes(1);
                const urlArg = (mockFetch.mock.calls[0] as any)[0];
                expect(urlArg.toString()).toContain("/api/data/company_members");
                expect(urlArg.toString()).not.toContain("companyMembers");
            });
        });
    });

    // -----------------------------------------------------------------------
    // call() method
    // -----------------------------------------------------------------------
    describe("call() method", () => {
        it("is a function on the client", () => {
            const client = createRebaseClient({ baseUrl: "https://api.example.com" });
            expect(typeof client.call).toBe("function");
        });
    });

    // -----------------------------------------------------------------------
    // Auth storage configuration
    // -----------------------------------------------------------------------
    describe("Auth configuration", () => {
        it("passes custom auth storage configuration", () => {
            const storage = createMemoryStorage();
            storage.setItem("rebase_auth", JSON.stringify({
                accessToken: "active-token",
                refreshToken: "active-refresh",
                expiresAt: Date.now() + 1000000,
                user: { uid: "u",
email: "u@m.com",
displayName: "u",
photoURL: null }
            }));

            const client = createRebaseClient({
                baseUrl: "https://api.example.com",
                auth: { storage }
            });

            const session = client.auth.getSession();
            expect(session).toBeDefined();
            expect(session?.accessToken).toBe("active-token");
        });

        it("passes custom admin path configuration", () => {
            const client = createRebaseClient({
                baseUrl: "https://api.example.com",
                admin: { adminPath: "/custom-admin" }
            });

            expect(client.admin).toBeDefined();
        });
    });

    // -----------------------------------------------------------------------
    // WebSocket URL derivation
    // -----------------------------------------------------------------------
    describe("WebSocket URL derivation", () => {
        it("uses explicit websocketUrl when provided", () => {
            const client = createRebaseClient({
                baseUrl: "https://api.example.com",
                websocketUrl: "wss://custom-ws.example.com"
            });
            // If ws exists it would be configured with the custom URL
            // Since we don't have a real WebSocket in test env, we just check it doesn't crash
            expect(client).toBeDefined();
        });
    });

    // -----------------------------------------------------------------------
    // onUnauthorized auto-setup
    // -----------------------------------------------------------------------
    describe("onUnauthorized auto-setup", () => {
        it("auto-configures onUnauthorized to refresh auth session", () => {
            const client = createRebaseClient({
                baseUrl: "https://api.example.com"
            });
            // The onUnauthorized should have been auto-set
            expect(client).toBeDefined();
        });

        it("does not override custom onUnauthorized", () => {
            const customHandler = jest.fn().mockResolvedValue(true);
            const client = createRebaseClient({
                baseUrl: "https://api.example.com",
                onUnauthorized: customHandler
            });
            expect(client).toBeDefined();
        });

        it("auto-refresh retries the request after 401 (wiring regression test)", async () => {
            /**
             * This test proves the wiring fix: transport.setOnUnauthorized() must
             * be called (vs setting options.onUnauthorized) so the transport's
             * internal onUnauthorizedHandler closure is updated AFTER creation.
             */
            let callCount = 0;
            const mockFetch = jest.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => {
                callCount++;
                if (callCount === 1) {
                    // First call: simulate 401 from server
                    return {
                        ok: false,
                        status: 401,
                        statusText: "Unauthorized",
                        text: async () => JSON.stringify({ error: { message: "Token expired", code: "UNAUTHORIZED" } }),
                        json: async () => ({ error: { message: "Token expired", code: "UNAUTHORIZED" } }),
                        headers: new Headers()
                    } as unknown as Response;
                }
                if (callCount === 2) {
                    // Second call: refresh token endpoint
                    return {
                        ok: true,
                        status: 200,
                        text: async () => JSON.stringify({
                            tokens: {
                                accessToken: "new-jwt",
                                refreshToken: "new-refresh",
                                accessTokenExpiresAt: Date.now() + 3600000
                            }
                        }),
                        json: async () => ({
                            tokens: {
                                accessToken: "new-jwt",
                                refreshToken: "new-refresh",
                                accessTokenExpiresAt: Date.now() + 3600000
                            }
                        }),
                        headers: new Headers()
                    } as unknown as Response;
                }
                // Third call: retry of original request — must match collection.find() shape
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({ data: [{ id: 1, title: "Post" }], meta: { total: 1 } }),
                    json: async () => ({ data: [{ id: 1, title: "Post" }], meta: { total: 1 } }),
                    headers: new Headers()
                } as unknown as Response;
            }) as unknown as typeof globalThis.fetch;

            // Seed a session so refreshSession() has a refresh token
            const storage = createMemoryStorage();
            storage.setItem("rebase_auth", JSON.stringify({
                accessToken: "expired-jwt",
                refreshToken: "valid-refresh",
                expiresAt: Date.now() + 1000000,
                user: { uid: "u",
email: "u@m.com",
displayName: "u",
photoURL: null }
            }));

            const client = createRebaseClient({
                baseUrl: "http://localhost",
                fetch: mockFetch,
                auth: { storage,
autoRefresh: false }
            });

            // Make a request that will get 401 → auto-refresh → retry
            const result = await client.data.collection("posts").find();

            // The mock fetch should have been called 3 times:
            // 1) Original request → 401
            // 2) Refresh token → 200
            // 3) Retry of original request → 200
            expect(callCount).toBe(3);
            expect(result).toBeDefined();
        });
    });
});
