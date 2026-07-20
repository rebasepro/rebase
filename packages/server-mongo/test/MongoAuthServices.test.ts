import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import {
    MongoUserService,
    MongoRoleService,
    MongoTokenRepository,
    MongoAuthRepository
} from "../src/auth/services";

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

            // Test roles mapping
            await roleService.createRole({ id: "admin",
name: "Administrator" });
            await userService.setUserRoles(user1.id, ["admin"]);

            const rolesResult = await userService.listUsersPaginated({ roleId: "admin" });
            expect(rolesResult.total).toBe(1);
            expect(rolesResult.users[0].id).toBe(user1.id);

            const userRoles = await userService.getUserRoles(user1.id);
            expect(userRoles).toHaveLength(1);
            expect(userRoles[0].id).toBe("admin");

            const roleIds = await userService.getUserRoleIds(user1.id);
            expect(roleIds).toEqual(["admin"]);
        });
    });

    describe("MongoRoleService", () => {
        it("should manage roles", async () => {
            const service = new MongoRoleService(db);
            const roleData = {
                id: "editor",
                name: "Editor",
                isAdmin: false,
                defaultPermissions: null,
                collectionPermissions: null
            };

            const role = await service.createRole(roleData);
            expect(role.id).toBe("editor");
            expect(role.name).toBe("Editor");

            const fetched = await service.getRoleById("editor");
            expect(fetched?.id).toBe(role.id);
            expect(fetched?.name).toBe(role.name);

            const list = await service.listRoles();
            expect(list.map(r => r.id)).toContain(role.id);

            await service.updateRole("editor", { name: "Super Editor" });
            const updated = await service.getRoleById("editor");
            expect(updated?.name).toBe("Super Editor");

            await service.deleteRole("editor");
            const deleted = await service.getRoleById("editor");
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
});
