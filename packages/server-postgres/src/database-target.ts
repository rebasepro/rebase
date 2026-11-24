/**
 * Which of the project's databases a `rebase db push | generate | migrate`
 * acts on.
 *
 * A project may declare several Postgres databases (`database("analytics")` in
 * `backend/resources.ts`) and route each table to one of them
 * (`defineTable("events", { database: analytics, … })`). The server provisions
 * each database with its own tables; the schema commands have to do the same,
 * or a push to the default database creates the analytics tables inside it —
 * where nothing ever reads them — and the analytics database stays empty.
 *
 * So each of these commands acts on exactly one database per run: the default
 * one unless `--database <key>` names another. The target carries everything
 * that differs between databases — the connection string, the migration
 * directory, the tables — and {@link withDatabaseTarget} makes it the scope of
 * the run, so the table loader and Atlas read it from one place instead of
 * every step being handed it (a step that missed it would plan the default's
 * tables against the analytics database).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import path from "path";
import {
    DEFAULT_RESOURCE_KEY,
    declaredResources,
    resourceEnvSuffix,
    type TableDescriptor
} from "@rebasepro/types";

/** The default database's migration directory, relative to the backend. POSIX: it is also a URL path. */
export const DEFAULT_MIGRATIONS_DIR = "drizzle/migrations";

/**
 * One database a schema command acts on.
 *
 * @group Schema
 */
export interface DatabaseTarget {
    /** The declared key — {@link DEFAULT_RESOURCE_KEY} for the default database. */
    key: string;
    /** Whether this is the default database: the one that holds auth, the schema stamp and `DATABASE_URL`. */
    isDefault: boolean;
    /** The connection string, or undefined when nothing binds it. */
    url: string | undefined;
    /** Where {@link url} was read from, for a message that names it: `DATABASE_URL__ANALYTICS`, `--database-url`. */
    urlSource: string;
    /**
     * The migration directory, relative to the working directory (the backend)
     * and POSIX, or absolute when the declaration named an absolute path.
     *
     * Each database keeps its own history: Atlas records the applied versions
     * in the database it migrates, and a directory shared by two databases
     * would hand each the other's `CREATE TABLE`s.
     */
    migrationsDir: string;
    /** What a printed `rebase db …` command needs to reach this database again: `""`, or ` --database analytics`. */
    commandSuffix: string;
}

/**
 * `--database <key>` named a database the project does not declare.
 *
 * @group Schema
 */
export class UnknownDatabaseTargetError extends Error {
    constructor(public readonly key: string, public readonly declared: readonly string[]) {
        super(
            `No database "${key}" is declared. Declared: ${declared.map(k => `"${k}"`).join(", ")}. ` +
            `Declare it in backend/resources.ts — export const ${safeIdentifier(key)} = database("${key}") — ` +
            "or pass one of the declared keys. Nothing was run."
        );
        this.name = "UnknownDatabaseTargetError";
    }
}

/** A JavaScript identifier for the example in a message: `media-files` → `mediaFiles`. */
function safeIdentifier(key: string): string {
    const camel = key.replace(/[^A-Za-z0-9]+([A-Za-z0-9])/g, (_, c: string) => c.toUpperCase()).replace(/[^A-Za-z0-9]/g, "");
    return /^[A-Za-z_]/.test(camel) ? camel : `db${camel}`;
}

/**
 * The databases the project declares, the default first, then the others in
 * declaration order. The default is always there: a project that declared
 * nothing has one database, configured through `DATABASE_URL`.
 */
export function declaredDatabaseKeys(): string[] {
    const named = declaredResources("database")
        .filter(declaration => declaration.transport === "server" && declaration.key !== DEFAULT_RESOURCE_KEY)
        .map(declaration => declaration.key);
    return [DEFAULT_RESOURCE_KEY, ...new Set(named)];
}

/** The `migrations` option a database declaration gave, when it gave a usable one. */
function declaredMigrationsOption(key: string): string | undefined {
    const declaration = declaredResources("database").find(d => d.key === key);
    const migrations = declaration?.options.migrations;
    return typeof migrations === "string" && migrations.trim() ? migrations.trim() : undefined;
}

/**
 * The migration directory a database uses.
 *
 * The default database keeps `drizzle/migrations`, where every project's
 * history already is. A named one gets `drizzle/migrations/<key>`, under it:
 * Atlas reads only the `*.sql` files directly in the directory it is given, so
 * the default's history never sees the subdirectory, and the two cannot mix.
 * `database("analytics", { migrations: "db/analytics" })` names another
 * directory, relative to the directory `resources.ts` lives in.
 *
 * @param configDir the directory `resources.ts` lives in (the backend).
 * @param cwd the directory the command runs in, which Atlas resolves `file://` URLs against.
 */
export function migrationsDirFor(key: string, configDir: string, cwd: string = process.cwd()): string {
    const declared = declaredMigrationsOption(key);
    if (declared) {
        if (path.isAbsolute(declared)) return declared;
        const relative = path.relative(cwd, path.resolve(configDir, declared));
        return relative.split(path.sep).join("/") || ".";
    }
    if (key === DEFAULT_RESOURCE_KEY) return DEFAULT_MIGRATIONS_DIR;
    return `${DEFAULT_MIGRATIONS_DIR}/${key}`;
}

/** A migration directory as Atlas's `--dir` takes it. */
export function migrationsDirUrl(dir: string): string {
    return `file://${dir}`;
}

/**
 * Resolve the database a schema command acts on.
 *
 * - No `--database`, or `--database (default)`: the default database, at
 *   `--database-url` or `DATABASE_URL` — exactly what these commands did with
 *   one database.
 * - `--database <key>`: that declared database, at `--database-url` when it
 *   was given and `DATABASE_URL__<KEY>` otherwise.
 *
 * Reads the declarations from the resource registry, so the project's
 * `resources.ts` must have been evaluated first (`loadDeclaredResources`).
 *
 * @throws UnknownDatabaseTargetError when `requested` names no declared database.
 */
export function resolveDatabaseTarget(input: {
    /** `--database <key>`, or undefined. */
    requested?: string;
    /** `--database-url <url>`, or undefined. */
    databaseUrlFlag?: string;
    /** Where the bindings are read from. */
    env: Readonly<Record<string, string | undefined>>;
    /** The directory `resources.ts` lives in — what a declared `migrations` path is relative to. */
    configDir: string;
    cwd?: string;
}): DatabaseTarget {
    const key = input.requested?.trim() || DEFAULT_RESOURCE_KEY;
    const declared = declaredDatabaseKeys();
    if (!declared.includes(key)) throw new UnknownDatabaseTargetError(key, declared);

    const isDefault = key === DEFAULT_RESOURCE_KEY;
    const variable = `DATABASE_URL${resourceEnvSuffix(key)}`;
    const flagUrl = input.databaseUrlFlag?.trim() || undefined;
    const envUrl = input.env[variable]?.trim() || undefined;
    return {
        key,
        isDefault,
        url: flagUrl ?? envUrl,
        urlSource: flagUrl ? "--database-url" : variable,
        migrationsDir: migrationsDirFor(key, input.configDir, input.cwd),
        commandSuffix: isDefault ? "" : ` --database ${key}`
    };
}

/** The tables a database stores: those whose `database` names it, and the default's those that name none. */
export function storedByDatabase<T extends { database?: string }>(descriptors: readonly T[], key: string): T[] {
    return descriptors.filter(descriptor => (descriptor.database || DEFAULT_RESOURCE_KEY) === key);
}

/** {@link storedByDatabase} for compiled tables, which carry their descriptor. */
export function tablesStoredByDatabase<T extends { descriptor: TableDescriptor }>(tables: readonly T[], key: string): T[] {
    return tables.filter(table => (table.descriptor.database || DEFAULT_RESOURCE_KEY) === key);
}

const currentTarget = new AsyncLocalStorage<DatabaseTarget>();

/**
 * Run `command` with `target` as the database every step acts on: the table
 * loader returns only its tables, Atlas connects to its URL, and the migration
 * steps read its directory.
 */
export function withDatabaseTarget<T>(target: DatabaseTarget, command: () => Promise<T>): Promise<T> {
    return currentTarget.run(target, command);
}

/**
 * The database the running command acts on, or undefined outside
 * {@link withDatabaseTarget} — `schema generate`, the doctor and `console` read
 * every table, whatever database stores it.
 */
export function scopedDatabaseTarget(): DatabaseTarget | undefined {
    return currentTarget.getStore();
}
