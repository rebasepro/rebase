import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import {
    MongoUserService,
    MongoRoleService,
    MongoTokenRepository,
    MongoAuthRepository
} from "../src/auth/services";
import { ensureAuthCollectionsExist } from "../src/auth/ensure-collections";

describe("MongoDB Auth Services", () => {
    let mongoServer: MongoMemoryServer;
    let client: MongoClient;
    let db: Db;

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        const uri = mongoServer.getUri();
        client = new MongoClient(uri);
        await client.connect();
        db = client.db("test_auth");
    });

    afterAll(async () => {
        await client.close();
        await mongoServer.stop();
    });

    beforeEach(async () => {
        const collections = await db.listCollections().toArray();
        for (const col of collections) {
            await db.dropCollection(col.name);
        }
        // The wiring, not a stand-in for it. These tests used to drive the
        // services against collections that had no indexes at all, so the
        // bootstrap could create unique indexes on field names nothing writes —
        // and a unique index whose key is always missing admits exactly one
        // document — without a single test noticing.
        await ensureAuthCollectionsExist(db);
    });

    describe("MongoUserService", () => {
        it("should create, retrieve, and delete a user", async () => {
            const service = new MongoUserService(db);
            const userData = {
                email: "USER@rebase.pro", // Should be lowercased
                passwordHash: "hash123",
                displayName: "Alice",
                photoUrl: "http://photo",
                emailVerified: true
            };

            const user = await service.createUser(userData);
            expect(user.id).toBeDefined();
            expect(user.email).toBe("user@rebase.pro");
            expect(user.displayName).toBe("Alice");
            expect(user.photoUrl).toBe("http://photo");
            expect(user.emailVerified).toBe(true);

            const fetched = await service.getUserById(user.id);
            expect(fetched).toEqual(user);

            const fetchedByEmail = await service.getUserByEmail("USER@rebase.pro");
            expect(fetchedByEmail).toEqual(user);

            await service.deleteUser(user.id);
            const deleted = await service.getUserById(user.id);
            expect(deleted).toBeNull();
        });

        it("should link and retrieve user identities", async () => {
            const service = new MongoUserService(db);
            const user = await service.createUser({ email: "user@rebase.pro" });

            await service.linkUserIdentity(user.id, "google", "google_123", { name: "Google User" });

            const identities = await service.getUserIdentities(user.id);
            expect(identities).toHaveLength(1);
            expect(identities[0].provider).toBe("google");
            expect(identities[0].providerId).toBe("google_123");
            expect(identities[0].profileData).toEqual({ name: "Google User" });

            const userByIdentity = await service.getUserByIdentity("google", "google_123");
            expect(userByIdentity?.id).toBe(user.id);
        });

        it("should list and paginate users with search and role filters", async () => {
            const userService = new MongoUserService(db);
            const roleService = new MongoRoleService(db);

            const user1 = await userService.createUser({ email: "alice@rebase.pro",
displayName: "Alice Smith" });
            const user2 = await userService.createUser({ email: "bob@rebase.pro",
displayName: "Bob Jones" });

            // Test search
            const searchResult = await userService.listUsersPaginated({ search: "alice" });
            expect(searchResult.total).toBe(1);
            expect(searchResult.users[0].id).toBe(user1.id);

            // Test roles mapping. A fresh id: the bootstrap seeds admin,
            // editor and viewer, so reusing one of those is a duplicate `_id`.
            await roleService.createRole({ id: "auditor",
name: "Auditor" });
            await userService.setUserRoles(user1.id, ["auditor"]);

            const rolesResult = await userService.listUsersPaginated({ roleId: "auditor" });
            expect(rolesResult.total).toBe(1);
            expect(rolesResult.users[0].id).toBe(user1.id);

            const userRoles = await userService.getUserRoles(user1.id);
            expect(userRoles).toHaveLength(1);
            expect(userRoles[0].id).toBe("auditor");

            const roleIds = await userService.getUserRoleIds(user1.id);
            expect(roleIds).toEqual(["auditor"]);
        });
    });

    describe("MongoRoleService", () => {
        it("should manage roles", async () => {
            const service = new MongoRoleService(db);
            const roleData = {
                id: "contributor",
                name: "Contributor",
                isAdmin: false,
                defaultPermissions: null,
                collectionPermissions: null
            };

            const role = await service.createRole(roleData);
            expect(role.id).toBe("contributor");
            expect(role.name).toBe("Contributor");

            const fetched = await service.getRoleById("contributor");
            expect(fetched?.id).toBe(role.id);
            expect(fetched?.name).toBe(role.name);

            const list = await service.listRoles();
            expect(list.map(r => r.id)).toContain(role.id);

            await service.updateRole("contributor", { name: "Super Contributor" });
            const updated = await service.getRoleById("contributor");
            expect(updated?.name).toBe("Super Contributor");

            await service.deleteRole("contributor");
            const deleted = await service.getRoleById("contributor");
            expect(deleted).toBeNull();
        });
    });

    describe("MongoTokenRepository", () => {
        it("should manage refresh tokens", async () => {
            const repo = new MongoTokenRepository(db);
            const expires = new Date(Date.now() + 3600 * 1000);

            await repo.createRefreshToken("user1", "hash_token", expires, "Mozilla", "127.0.0.1");

            const token = await repo.findRefreshTokenByHash("hash_token");
            expect(token).not.toBeNull();
            expect(token?.uid).toBe("user1");
            expect(token?.tokenHash).toBe("hash_token");
            expect(token?.userAgent).toBe("Mozilla");
            expect(token?.ipAddress).toBe("127.0.0.1");

            const list = await repo.listRefreshTokensForUser("user1");
            expect(list).toHaveLength(1);

            await repo.deleteRefreshToken("hash_token");
            const deleted = await repo.findRefreshTokenByHash("hash_token");
            expect(deleted).toBeNull();
        });

        it("should manage password reset tokens", async () => {
            const repo = new MongoTokenRepository(db);
            const expiresFuture = new Date(Date.now() + 3600 * 1000);
            const expiresPast = new Date(Date.now() - 3600 * 1000);

            await repo.createPasswordResetToken("user_valid", "reset_hash_valid", expiresFuture);
            await repo.createPasswordResetToken("user_expired", "reset_hash_expired", expiresPast);

            const validToken = await repo.findValidPasswordResetToken("reset_hash_valid");
            expect(validToken).not.toBeNull();
            expect(validToken?.uid).toBe("user_valid");

            const expiredToken = await repo.findValidPasswordResetToken("reset_hash_expired");
            expect(expiredToken).toBeNull();

            await repo.markPasswordResetTokenUsed("reset_hash_valid");
            const usedToken = await repo.findValidPasswordResetToken("reset_hash_valid");
            expect(usedToken).toBeNull();
        });
    });

    describe("MongoAuthRepository", () => {
        it("should implement aggregate auth operations", async () => {
            const repo = new MongoAuthRepository(db);
            const user = await repo.createUser({ email: "aggregate@rebase.pro" });
            expect(user.id).toBeDefined();

            const fetched = await repo.getUserById(user.id);
            expect(fetched?.email).toBe("aggregate@rebase.pro");
        });
    });

    describe("the indexes the bootstrap creates", () => {
        /**
         * MongoDB indexes an absent field as `null`. Every index below was
         * created on snake_case names (`token_hash`, `user_id`, `provider_id`)
         * while the services write camelCase, so each unique one admitted a
         * single document deployment-wide: the second login anywhere raised
         * `E11000`.
         */
        it("indexes the fields the services actually write", async () => {
            const keysOf = async (name: string) =>
                (await db.collection(name).indexes()).map(i => Object.keys(i.key).join("+"));

            expect(await keysOf("rebase_refresh_tokens")).toContain("tokenHash");
            expect(await keysOf("rebase_user_identities")).toContain("provider+providerId");
            expect(await keysOf("rebase_user_roles")).toContain("uid+roleId");
            expect(await keysOf("rebase_password_reset_tokens")).toContain("tokenHash");
        });

        it("admits a second refresh token — the second login on the deployment", async () => {
            const repo = new MongoTokenRepository(db);
            const expires = new Date(Date.now() + 3600 * 1000);

            await repo.createRefreshToken("user1", "hash_one", expires, "Firefox", "10.0.0.1");
            await repo.createRefreshToken("user2", "hash_two", expires, "Chrome", "10.0.0.2");

            expect(await db.collection("rebase_refresh_tokens").countDocuments()).toBe(2);
        });

        it("admits two sessions for one user from one browser and address", async () => {
            // The reverted Postgres constraint, expressed as a unique index:
            // evicting by (uid, userAgent, ipAddress) signed a second browser
            // profile out.
            const repo = new MongoTokenRepository(db);
            const expires = new Date(Date.now() + 3600 * 1000);

            await repo.createRefreshToken("user1", "hash_a", expires, "Chrome", "10.0.0.1");
            await repo.createRefreshToken("user1", "hash_b", expires, "Chrome", "10.0.0.1");

            expect(await repo.listRefreshTokensForUser("user1")).toHaveLength(2);
        });

        it("admits a second role assignment", async () => {
            const userService = new MongoUserService(db);
            // admin/editor/viewer are seeded by the bootstrap this suite runs.
            await userService.assignDefaultRole("user1", "editor");
            await userService.assignDefaultRole("user2", "viewer");

            expect(await userService.getUserRoleIds("user1")).toEqual(["editor"]);
            expect(await userService.getUserRoleIds("user2")).toEqual(["viewer"]);
        });

        it("admits a second outstanding password-reset token", async () => {
            const repo = new MongoTokenRepository(db);
            const expires = new Date(Date.now() + 3600 * 1000);

            await repo.createPasswordResetToken("user1", "reset_one", expires);
            await repo.createPasswordResetToken("user2", "reset_two", expires);

            expect(await repo.findValidPasswordResetToken("reset_one")).not.toBeNull();
            expect(await repo.findValidPasswordResetToken("reset_two")).not.toBeNull();
        });

        it("still rejects a duplicate token hash — the index has to bite", async () => {
            const repo = new MongoTokenRepository(db);
            const expires = new Date(Date.now() + 3600 * 1000);

            await repo.createRefreshToken("user1", "same_hash", expires);
            await expect(repo.createRefreshToken("user2", "same_hash", expires)).rejects.toThrow();
        });

        it("drops the stale snake_case indexes a 0.13 deployment already has", async () => {
            await db.collection("rebase_refresh_tokens").createIndex({ token_hash: 1 }, { unique: true });
            await db.collection("rebase_user_roles").createIndex({ user_id: 1,
role_id: 1 }, { unique: true });

            await ensureAuthCollectionsExist(db);

            const names = async (name: string) => (await db.collection(name).indexes()).map(i => i.name);
            expect(await names("rebase_refresh_tokens")).not.toContain("token_hash_1");
            expect(await names("rebase_user_roles")).not.toContain("user_id_1_role_id_1");
        });
    });
});
