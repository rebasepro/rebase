/**
 * Complete typed fakes for the app's tests.
 *
 * A test that needs a client, a storage source or an accessor wants a handful
 * of its members, and used to build those and cast the rest away. These build
 * the whole interface: what a test overrides behaves as written, and every
 * other member is the stub the real client installs for what its transport
 * cannot do — `unsupportedMethod`, which throws, naming itself, if called.
 */
import {
    type AuthClient,
    type AuthConfigDocument,
    type CollectionAccessor,
    type Entity,
    type FindResponse,
    type RebaseClient,
    type RebaseData,
    type RebaseSdkData,
    type RebaseSession,
    type SDKCollectionClient,
    type StorageSource,
    type TrashClient,
    type User,
    unsupportedMethod
} from "@rebasepro/types";
import type { AuthController } from "@rebasepro/cms-types";
import type { ClientAuth } from "../../src/auth/types";

/** A member the test did not stub: calling it fails the test, saying which. */
function notStubbed(name: string): () => never {
    return unsupportedMethod<() => never>(`${name} is not stubbed in this test`);
}

/**
 * The `Database` of a project that generated no tables.
 *
 * A client typed against it has a `data` of `collection(slug)` alone, without
 * the untyped client's `[slug]` index signature, which no object literal can
 * satisfy. `<Rebase client>` is generic over the database, so it takes one.
 */
export type NoTables = Record<never, never>;

/** A user as an auth provider reports one; `uid` and `roles` are what tests usually vary. */
export function fakeUser(overrides: Partial<User> = {}): User {
    return {
        uid: "user-1",
        displayName: null,
        email: null,
        photoURL: null,
        providerId: "test",
        isAnonymous: false,
        roles: [],
        ...overrides
    };
}

/** A settled, signed-out `AuthController` unless `overrides` says otherwise. */
export function fakeAuthController(overrides: Partial<AuthController> = {}): AuthController {
    return {
        user: null,
        initialLoading: false,
        authLoading: false,
        signOut: async () => undefined,
        getAuthToken: async () => "token",
        loginSkipped: false,
        extra: undefined,
        setExtra: () => undefined,
        ...overrides
    };
}

/** An `AuthClient` with no session that never changes. */
export function fakeAuthClient(overrides: Partial<AuthClient> = {}): AuthClient {
    return {
        getUser: async () => null,
        getSession: () => null,
        signOut: async () => undefined,
        onAuthStateChange: () => () => undefined,
        refreshSession: notStubbed("auth.refreshSession"),
        ...overrides
    };
}

/** A session for `user` (by default `fakeUser()`), valid for an hour. */
export function fakeSession(overrides: Partial<RebaseSession> = {}): RebaseSession {
    return {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresAt: Date.now() + 60 * 60 * 1000,
        user: fakeUser(),
        ...overrides
    };
}

/** What `GET /auth/config` answers for a backend with built-in email and password auth. */
export function fakeAuthConfig(overrides: Partial<AuthConfigDocument> = {}): AuthConfigDocument {
    return {
        hasBuiltInAuthRoutes: true,
        emailPasswordLogin: true,
        registrationEnabled: true,
        passwordReset: true,
        adminPasswordReset: false,
        sessionManagement: true,
        profileUpdate: true,
        emailVerification: false,
        magicLink: false,
        anonymousLogin: false,
        enabledProviders: [],
        ...overrides
    };
}

/**
 * The auth client `useRebaseAuthController` drives: initialised, signed out,
 * with the config above. Every sign-in method throws unless stubbed.
 */
export function fakeClientAuth(overrides: Partial<ClientAuth> = {}): ClientAuth {
    return {
        getSession: () => null,
        onAuthStateChange: () => () => undefined,
        isInitialized: async () => undefined,
        getAuthConfig: async () => fakeAuthConfig(),
        signInWithEmail: notStubbed("auth.signInWithEmail"),
        signOut: async () => undefined,
        refreshSession: notStubbed("auth.refreshSession"),
        signUp: notStubbed("auth.signUp"),
        signInWithGoogle: notStubbed("auth.signInWithGoogle"),
        signInWithOAuth: notStubbed("auth.signInWithOAuth"),
        resetPasswordForEmail: notStubbed("auth.resetPasswordForEmail"),
        resetPassword: notStubbed("auth.resetPassword"),
        changePassword: notStubbed("auth.changePassword"),
        updateUser: notStubbed("auth.updateUser"),
        getSessions: notStubbed("auth.getSessions"),
        revokeSession: notStubbed("auth.revokeSession"),
        revokeAllSessions: notStubbed("auth.revokeAllSessions"),
        ...overrides
    };
}

/** A storage source for a test that uploads nothing. */
export function fakeStorageSource(overrides: Partial<StorageSource> = {}): StorageSource {
    return {
        putObject: notStubbed("storage.putObject"),
        getSignedUrl: notStubbed("storage.getSignedUrl"),
        getObject: notStubbed("storage.getObject"),
        deleteObject: notStubbed("storage.deleteObject"),
        listObjects: notStubbed("storage.listObjects"),
        ...overrides
    };
}

/**
 * `RebaseSdkData` over `accessorFor`, built the way the panel builds its own
 * (`sdkDataOf` in `rowWrites.ts`): a Proxy answers `collection(slug)` and
 * every `data.<slug>`.
 */
export function sdkDataOver(accessorFor: (slug: string) => SDKCollectionClient): RebaseSdkData {
    const target = { collection: accessorFor };
    // The one assertion: the Proxy answers every slug, which is the index
    // signature the compiler cannot see on `target`.
    return new Proxy(target, {
        get(_target, prop: string | symbol) {
            if (prop === "collection") return accessorFor;
            if (typeof prop === "symbol" || prop === "then" || prop === "toJSON" || prop === "$$typeof") return undefined;
            return accessorFor(prop);
        }
    }) as RebaseSdkData;
}

/**
 * The entity-level `RebaseData` over `accessorFor`, built as `sdkDataOver` is:
 * `collection(slug)` and every `data.<slug>`.
 */
export function rebaseDataOver(accessorFor: (slug: string) => CollectionAccessor): RebaseData {
    const target = { collection: accessorFor };
    // The one assertion, as in `sdkDataOver`: the Proxy answers every slug.
    return new Proxy(target, {
        get(_target, prop: string | symbol) {
            if (prop === "collection") return accessorFor;
            if (typeof prop === "symbol" || prop === "then" || prop === "toJSON" || prop === "$$typeof") return undefined;
            return accessorFor(prop);
        }
    }) as RebaseData;
}

/** A client whose `data` serves `accessorFor(slug)` for every collection. */
export function clientOver(
    accessorFor: (slug: string) => SDKCollectionClient,
    overrides: Partial<RebaseClient> = {}
): RebaseClient {
    return {
        data: sdkDataOver(accessorFor),
        auth: fakeAuthClient(),
        ...overrides
    };
}

/** A client whose collections are not read unless `overrides.data` says how. */
export function fakeClient(overrides: Partial<RebaseClient<NoTables>> = {}): RebaseClient<NoTables> {
    return {
        data: {
            collection: <M extends Record<string, unknown>>(slug: string) => fakeSdkCollection<M>(slug),
            batch: notStubbed("data.batch")
        },
        auth: fakeAuthClient(),
        ...overrides
    };
}

/** A trash whose every call throws unless stubbed. */
export function fakeSdkTrash<M extends Record<string, unknown> = Record<string, unknown>>(
    slug: string,
    overrides: Partial<TrashClient<M>> = {}
): TrashClient<M> {
    return {
        find: notStubbed(`${slug}.trash.find`),
        count: notStubbed(`${slug}.trash.count`),
        restore: notStubbed(`${slug}.trash.restore`),
        restoreMany: notStubbed(`${slug}.trash.restoreMany`),
        purge: notStubbed(`${slug}.trash.purge`),
        purgeMany: notStubbed(`${slug}.trash.purgeMany`),
        ...overrides
    };
}

/** An SDK collection client: `overrides` as written, every other member throws. */
export function fakeSdkCollection<M extends Record<string, unknown> = Record<string, unknown>>(
    slug: string,
    overrides: Partial<SDKCollectionClient<M>> = {}
): SDKCollectionClient<M> {
    return {
        find: notStubbed(`${slug}.find`),
        iterate: notStubbed(`${slug}.iterate`),
        findAll: notStubbed(`${slug}.findAll`),
        findById: notStubbed(`${slug}.findById`),
        get: notStubbed(`${slug}.get`),
        create: notStubbed(`${slug}.create`),
        createMany: notStubbed(`${slug}.createMany`),
        update: notStubbed(`${slug}.update`),
        upsert: notStubbed(`${slug}.upsert`),
        updateMany: notStubbed(`${slug}.updateMany`),
        delete: notStubbed(`${slug}.delete`),
        deleteMany: notStubbed(`${slug}.deleteMany`),
        updateWhere: notStubbed(`${slug}.updateWhere`),
        deleteWhere: notStubbed(`${slug}.deleteWhere`),
        listen: notStubbed(`${slug}.listen`),
        listenById: notStubbed(`${slug}.listenById`),
        listenCount: notStubbed(`${slug}.listenCount`),
        trash: fakeSdkTrash<M>(slug),
        count: notStubbed(`${slug}.count`),
        aggregate: notStubbed(`${slug}.aggregate`),
        refresh: notStubbed(`${slug}.refresh`),
        where: notStubbed(`${slug}.where`),
        orderBy: notStubbed(`${slug}.orderBy`),
        limit: notStubbed(`${slug}.limit`),
        offset: notStubbed(`${slug}.offset`),
        search: notStubbed(`${slug}.search`),
        vectorSearch: notStubbed(`${slug}.vectorSearch`),
        include: notStubbed(`${slug}.include`),
        fields: notStubbed(`${slug}.fields`),
        distinct: notStubbed(`${slug}.distinct`),
        after: notStubbed(`${slug}.after`),
        ...overrides
    };
}

/**
 * An entity-level collection accessor: `overrides` as written, every other
 * required member throws. The optional members (`createMany`, `listen`,
 * `trash`, …) stay absent unless given, as on a driver that lacks them.
 */
export function fakeCollectionAccessor<M extends Record<string, unknown> = Record<string, unknown>>(
    slug: string,
    overrides: Partial<CollectionAccessor<M>> = {}
): CollectionAccessor<M> {
    return {
        find: notStubbed(`${slug}.find`),
        findById: notStubbed(`${slug}.findById`),
        create: notStubbed(`${slug}.create`),
        update: notStubbed(`${slug}.update`),
        delete: notStubbed(`${slug}.delete`),
        where: notStubbed(`${slug}.where`),
        orderBy: notStubbed(`${slug}.orderBy`),
        limit: notStubbed(`${slug}.limit`),
        offset: notStubbed(`${slug}.offset`),
        search: notStubbed(`${slug}.search`),
        vectorSearch: notStubbed(`${slug}.vectorSearch`),
        include: notStubbed(`${slug}.include`),
        ...overrides
    };
}


/** A one-page `find` answer over `data`. */
export function findResponse<M extends Record<string, unknown>>(data: Entity<M>[], hasMore = false): FindResponse<M> {
    return { data, meta: { total: data.length, limit: Math.max(data.length, 1), offset: 0, hasMore } };
}

/**
 * What a hook reads off `useData()`: `collection(slug)`. A test that mocks
 * `useData` hands back one of these.
 */
export interface DataCollections {
    collection(slug: string): CollectionAccessor;
}
