import type {
    AuthClient,
    DataDriver,
    RebaseCallbackClient,
    RebaseCallContext,
    RebaseSdkData,
    StorageSource,
    User
} from "@rebasepro/types";
import { buildSdkData } from "./buildRebaseData";

/**
 * Build the context a collection callback receives, for calling one directly —
 * from a unit test, a script, a REPL — without booting a driver.
 *
 * A callback is a plain function of one props object, so testing one is
 * calling it. The part that is hard to supply by hand is `props.context`,
 * whose type requires a client, a data plane and a storage source. This fills
 * in whatever you leave out:
 *
 * - A field you pass is used as it is.
 * - `client`, `data` and `storageSource` you do not pass are stand-ins that
 *   throw on first **use**, naming the field — "context.storageSource was not
 *   provided to createCallContext" — so a hook that touches something the test
 *   did not set up fails at that line, with that name. Building the context
 *   never throws, and neither does merely reading the field.
 * - `user` and `driver` are optional on the context itself, and stay absent
 *   unless you pass them: an absent `user` is how a callback sees a write with
 *   no signed-in caller, exactly as it does on the server.
 *
 * For a `data` plane backed by a real or in-memory driver, `buildSdkData(driver)`
 * from `@rebasepro/common` builds the same flat accessor the server hands a
 * callback.
 *
 * @example
 * ```ts
 * import { createCallContext } from "@rebasepro/server";
 * import type { User } from "@rebasepro/types";
 * import posts from "../config/collections/posts";
 *
 * const editor: User = { uid: "u1", displayName: null, email: null, photoURL: null,
 *     providerId: "password", isAnonymous: false, roles: ["editor"] };
 *
 * const values = await posts.callbacks!.beforeSave!({
 *     collection: posts, path: "posts", status: "new",
 *     values: { title: "Hello" },
 *     context: createCallContext({ user: editor })
 * });
 * ```
 *
 * @group Hooks and utilities
 */
export function createCallContext<USER extends User = User>(
    provided: Partial<RebaseCallContext<USER>> = {}
): RebaseCallContext<USER> {
    return {
        client: provided.client ?? missingClient(),
        data: provided.data ?? missingData(),
        storageSource: provided.storageSource ?? missingStorageSource("storageSource"),
        ...(provided.user !== undefined ? { user: provided.user } : {}),
        ...(provided.driver !== undefined ? { driver: provided.driver } : {})
    };
}

type ContextField = "client" | "data" | "storageSource";

/** The refusal a stand-in throws: which field, and how to supply it. */
function notProvided(field: ContextField, used: string): Error {
    const how = field === "data"
        ? "Pass one: `createCallContext({ data: buildSdkData(driver) })` builds it over a driver."
        : `Pass one: \`createCallContext({ ${field}: … })\`.`;
    return new Error(`context.${field} was not provided to createCallContext, and the callback used ${used}. ${how}`);
}

/** A member of a stand-in: answers nothing, throws the refusal when called. */
function refuse(field: ContextField, used: string): () => never {
    return () => {
        throw notProvided(field, used);
    };
}

/**
 * A driver every operation of which refuses. Wrapped by `buildSdkData`, it is
 * a complete data plane — `data.posts`, `data.collection("posts")`, any slug —
 * whose every read and write reaches one of these and throws, so the stand-in
 * needs no Proxy and no assertion of its own.
 */
function refusingDriver(field: ContextField): DataDriver {
    const used = `context.${field === "client" ? "client.dataAsAdmin" : field}`;
    const fail = refuse(field, used);
    return {
        fetchCollection: fail,
        listenCollection: fail,
        fetchOne: fail,
        listenOne: fail,
        save: fail,
        saveMany: fail,
        updateMany: fail,
        delete: fail,
        deleteAll: fail,
        deleteMany: fail,
        batchWrite: fail,
        updateRelationPivot: fail,
        checkUniqueField: fail,
        count: fail,
        restFetchService: {
            fetchCollectionForRest: fail,
            fetchOneForRest: fail,
            cursorFor: fail,
            aggregate: fail
        }
    };
}

function missingData(): RebaseSdkData {
    return buildSdkData(refusingDriver("data"));
}

function missingStorageSource(field: ContextField): StorageSource {
    const at = field === "client" ? "context.client.storage" : "context.storageSource";
    return {
        putObject: refuse(field, `${at}.putObject`),
        getSignedUrl: refuse(field, `${at}.getSignedUrl`),
        getObject: refuse(field, `${at}.getObject`),
        deleteObject: refuse(field, `${at}.deleteObject`),
        listObjects: refuse(field, `${at}.listObjects`)
    };
}

function missingAuth(): AuthClient {
    const fail = (method: string) => refuse("client", `context.client.auth.${method}`);
    return {
        getUser: fail("getUser"),
        getSession: fail("getSession"),
        signOut: fail("signOut"),
        onAuthStateChange: fail("onAuthStateChange"),
        refreshSession: fail("refreshSession")
    };
}

/**
 * The client stand-in. `auth` is the one member the type requires; the
 * capabilities a server-side callback reaches for — functions, email, storage,
 * the admin data plane, raw SQL, the admin APIs — are present too, so that
 * `context.client.email.send(…)` in a hook under test throws this refusal
 * rather than "cannot read properties of undefined".
 */
function missingClient(): RebaseCallbackClient {
    const fail = (member: string) => refuse("client", `context.client.${member}`);
    return {
        auth: missingAuth(),
        dataAsAdmin: buildSdkData(refusingDriver("client")),
        storage: missingStorageSource("client"),
        storageRegistry: {
            get: fail("storageRegistry.get"),
            getDefault: fail("storageRegistry.getDefault"),
            getOrDefault: fail("storageRegistry.getOrDefault"),
            has: fail("storageRegistry.has"),
            list: fail("storageRegistry.list")
        },
        bucket: fail("bucket"),
        createStorageSource: fail("createStorageSource"),
        fetchStorageSources: fail("fetchStorageSources"),
        email: {
            send: fail("email.send"),
            isConfigured: fail("email.isConfigured")
        },
        functions: {
            invoke: fail("functions.invoke")
        },
        admin: {
            listUsers: fail("admin.listUsers"),
            listUsersPaginated: fail("admin.listUsersPaginated"),
            getUser: fail("admin.getUser"),
            createUser: fail("admin.createUser"),
            updateUser: fail("admin.updateUser"),
            deleteUser: fail("admin.deleteUser"),
            resetPassword: fail("admin.resetPassword"),
            listRoles: fail("admin.listRoles"),
            bootstrap: fail("admin.bootstrap")
        },
        cron: {
            listJobs: fail("cron.listJobs"),
            getJob: fail("cron.getJob"),
            triggerJob: fail("cron.triggerJob"),
            getJobLogs: fail("cron.getJobLogs"),
            toggleJob: fail("cron.toggleJob")
        },
        backups: {
            list: fail("backups.list"),
            download: fail("backups.download"),
            downloadUrl: fail("backups.downloadUrl"),
            stream: fail("backups.stream")
        },
        apiKeys: {
            listKeys: fail("apiKeys.listKeys"),
            getKey: fail("apiKeys.getKey"),
            createKey: fail("apiKeys.createKey"),
            updateKey: fail("apiKeys.updateKey"),
            revokeKey: fail("apiKeys.revokeKey")
        },
        personalKeys: {
            listKeys: fail("personalKeys.listKeys"),
            createKey: fail("personalKeys.createKey"),
            revokeKey: fail("personalKeys.revokeKey"),
            listScopes: fail("personalKeys.listScopes")
        },
        call: fail("call"),
        sql: fail("sql")
    };
}
