/**
 * CLI commands: rebase storage ls | cp | rm | url | stat
 *
 * A running app's stored files, through its `/api/storage` routes and the
 * SDK's storage client — so the storage policies (`storageAuthorize`,
 * `storagePolicies`) decide, as they do for the app's own users. The same
 * target and credential every project command resolves.
 *
 * A remote object is written with a colon: `:avatars/me.png` in the default
 * storage source, `media:avatars/me.png` in the source keyed `media`. A local
 * path never starts with one, so `cp` reads its direction from which side has
 * it: `rebase storage cp ./me.png :avatars/me.png` uploads,
 * `rebase storage cp :avatars/me.png ./me.png` downloads.
 *
 * `orphans` and `move` (the whole-store maintenance in `storage.ts`) are the
 * other half of the group.
 */
import fs from "fs";
import path from "path";
import type arg from "arg";
import chalk from "chalk";

import { parseCommandArgs, UsageError } from "../utils/args";
import { PROJECT_TARGET_FLAGS, type ProjectTarget } from "../utils/project-target";
import {
    emit,
    fail,
    isJsonMode,
    isRecord,
    parsedLine,
    projectTarget,
    stringOf
} from "../utils/project-command";
import { cliUserAgent } from "../utils/version";
import { confirmDestructive, note, success } from "./cloud/context";

/** The subcommands this module answers, beside `orphans` and `move`. */
export const STORAGE_OBJECT_SUBCOMMANDS = ["ls", "cp", "rm", "url", "stat"] as const;

/** A remote object named on the line: the source key (empty: the default) and the object key. */
export interface RemoteObject {
    source: string;
    key: string;
}

/**
 * `:key` or `source:key` — or undefined for a local path. A Windows drive
 * (`C:\…`, `C:/…`) is local. Exported for its tests.
 */
export function remoteObjectOf(raw: string): RemoteObject | undefined {
    if (/^[a-zA-Z]:[\\/]/.test(raw)) return undefined;
    const match = /^([A-Za-z0-9_-]*):(.*)$/s.exec(raw);
    if (!match) return undefined;
    return { source: match[1], key: match[2].replace(/^\/+/, "") };
}

function describeRemote(object: RemoteObject): string {
    return `${object.source}:${object.key}`;
}

/** The SDK's storage source for a target and a source key. */
async function storageFor(target: ProjectTarget, source: string) {
    const { createRebaseClient } = await import("@rebasepro/client");
    const token = await target.bearer();
    const client = createRebaseClient({
        baseUrl: target.baseUrl,
        ...(token ? { token } : {}),
        realtime: false,
        headers: { "User-Agent": cliUserAgent() },
        auth: { persistSession: false, autoRefresh: false }
    });
    return source ? client.createStorageSource(source) : client.storage;
}

/** An SDK failure in this command's words: the server's code and message when it sent them. */
function reportStorageError(e: unknown, action: string): never {
    const status = isRecord(e) && typeof e.status === "number" ? e.status : undefined;
    const code = isRecord(e) && typeof e.code === "string" ? e.code : status === 404 ? "not_found" : "error";
    const message = e instanceof Error ? e.message : String(e);
    fail(`${action} — ${code}${status ? ` (${status})` : ""}: ${message}`, status === 501 ? "This server has no storage configured." : undefined, code);
}

/* ═══════════════════════════════════════════════════════════════
   ls
   ═══════════════════════════════════════════════════════════════ */

export const STORAGE_LS_FLAGS = {
    ...PROJECT_TARGET_FLAGS,
    "--limit": Number,
    "-n": "--limit",
    "--page-token": String
} satisfies arg.Spec;

export async function storageLs(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parsedLine(() => parseCommandArgs({
        spec: STORAGE_LS_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "storage ls",
        maxPositionals: 1
    }));
    const where = positionals[0] ? remoteObjectOf(positionals[0]) ?? { source: "", key: positionals[0] } : { source: "", key: "" };
    const target = await projectTarget(flags, { command: "storage ls" });
    const storage = await storageFor(target, where.source);
    let result: Awaited<ReturnType<typeof storage.listObjects>>;
    try {
        result = await storage.listObjects(where.key, {
            ...(flags["--limit"] ? { maxResults: flags["--limit"] } : {}),
            ...(flags["--page-token"] ? { pageToken: flags["--page-token"] } : {})
        });
    } catch (e) {
        reportStorageError(e, `Failed to list ${describeRemote(where)}`);
    }
    emit(() => {
        const prefixes = result.prefixes ?? [];
        const items = result.items ?? [];
        if (prefixes.length === 0 && items.length === 0) return note(`Nothing under ${describeRemote(where)}.`);
        for (const prefix of prefixes) console.log(`  ${chalk.blue(`${stringOf(prefix.fullPath) ?? stringOf(prefix.name) ?? "?"}/`)}`);
        for (const item of items) console.log(`  ${stringOf(item.fullPath) ?? stringOf(item.name) ?? "?"}`);
        if (result.nextPageToken) note(chalk.gray(`More: --page-token ${result.nextPageToken}`));
    }, result);
}

/* ═══════════════════════════════════════════════════════════════
   cp
   ═══════════════════════════════════════════════════════════════ */

export const STORAGE_CP_FLAGS = {
    ...PROJECT_TARGET_FLAGS,
    "--content-type": String,
    "--public": Boolean,
    "--force": Boolean,
    "-f": "--force"
} satisfies arg.Spec;

export async function storageCp(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parsedLine(() => parseCommandArgs({
        spec: STORAGE_CP_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "storage cp",
        maxPositionals: 2
    }));
    const { from, to } = parsedLine(() => {
        if (positionals.length !== 2) {
            throw new UsageError("rebase storage cp takes a source and a destination; a remote object starts with a colon: rebase storage cp ./me.png :avatars/me.png.");
        }
        const [a, b] = positionals;
        const remoteA = remoteObjectOf(a);
        const remoteB = remoteObjectOf(b);
        if (remoteA && remoteB) throw new UsageError("Both sides are remote objects; copying between sources is `rebase storage move`.");
        if (!remoteA && !remoteB) throw new UsageError("Neither side is a remote object: write the stored one with a colon, :key or <source>:key.");
        return { from: remoteA ?? a, to: remoteB ?? b };
    });
    const target = await projectTarget(flags, { command: "storage cp" });

    if (typeof from === "string" && typeof to !== "string") {
        // Upload.
        let bytes: Buffer;
        try {
            bytes = fs.readFileSync(from);
        } catch (e) {
            fail(`Cannot read ${from}: ${e instanceof Error ? e.message : String(e)}`, undefined, "usage");
        }
        const key = to.key.endsWith("/") || to.key === "" ? `${to.key}${path.basename(from)}` : to.key;
        const storage = await storageFor(target, to.source);
        const file = new File([new Uint8Array(bytes)], path.basename(from), flags["--content-type"] ? { type: flags["--content-type"] } : {});
        try {
            const result = await storage.putObject({ file, key, ...(flags["--public"] ? { public: true } : {}) });
            emit(() => success(`Uploaded ${from} to ${describeRemote({ source: to.source, key })} (${bytes.length} bytes).`), result);
        } catch (e) {
            reportStorageError(e, `Failed to upload ${from}`);
        }
        return;
    }

    if (typeof from !== "string" && typeof to === "string") {
        // Download.
        const storage = await storageFor(target, from.source);
        let file: File | null;
        try {
            file = await storage.getObject(from.key);
        } catch (e) {
            reportStorageError(e, `Failed to download ${describeRemote(from)}`);
        }
        if (!file) fail(`${describeRemote(from)} does not exist on ${target.label}.`, undefined, "not_found");
        const bytes = Buffer.from(await file.arrayBuffer());
        if (to === "-") {
            process.stdout.write(bytes);
            return;
        }
        const destination = fs.existsSync(to) && fs.statSync(to).isDirectory() ? path.join(to, path.basename(from.key)) : to;
        if (fs.existsSync(destination) && !flags["--force"]) {
            fail(`${destination} exists; pass --force to overwrite it.`, undefined, "exists");
        }
        fs.writeFileSync(destination, bytes);
        emit(() => success(`Downloaded ${describeRemote(from)} to ${destination} (${bytes.length} bytes).`), {
            object: describeRemote(from),
            path: destination,
            bytes: bytes.length
        });
    }
}

/* ═══════════════════════════════════════════════════════════════
   rm / url / stat
   ═══════════════════════════════════════════════════════════════ */

export const STORAGE_RM_FLAGS = { ...PROJECT_TARGET_FLAGS } satisfies arg.Spec;

export async function storageRm(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parsedLine(() => parseCommandArgs({
        spec: STORAGE_RM_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "storage rm",
        maxPositionals: 1
    }));
    const object = parsedLine(() => requireRemote(positionals[0], "storage rm"));
    const target = await projectTarget(flags, { command: "storage rm" });
    await confirmDestructive({ yes: flags["--yes"] === true, prompt: `Delete ${describeRemote(object)} on ${target.label}? A row that names it keeps a dangling path.` });
    const storage = await storageFor(target, object.source);
    try {
        await storage.deleteObject(object.key);
    } catch (e) {
        reportStorageError(e, `Failed to delete ${describeRemote(object)}`);
    }
    emit(() => success(`Deleted ${describeRemote(object)}.`), { object: describeRemote(object), deleted: true });
}

/** A remote object, or a refusal naming the colon syntax. Takes a bare key as the default source's. */
function requireRemote(raw: string | undefined, command: string): RemoteObject {
    if (!raw) throw new UsageError(`rebase ${command} needs a stored object: rebase ${command} :avatars/me.png (or <source>:key).`);
    return remoteObjectOf(raw) ?? { source: "", key: raw };
}

export const STORAGE_URL_FLAGS = { ...PROJECT_TARGET_FLAGS } satisfies arg.Spec;

/**
 * A download link for an object, signed by the server: whoever holds it can
 * read the object until it expires, with no credential of their own.
 */
export async function storageUrl(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parsedLine(() => parseCommandArgs({
        spec: STORAGE_URL_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "storage url",
        maxPositionals: 1
    }));
    const object = parsedLine(() => requireRemote(positionals[0], "storage url"));
    const target = await projectTarget(flags, { command: "storage url" });
    const storage = await storageFor(target, object.source);
    let config: Awaited<ReturnType<typeof storage.getSignedUrl>>;
    try {
        config = await storage.getSignedUrl(object.key);
    } catch (e) {
        reportStorageError(e, `Failed to sign a link to ${describeRemote(object)}`);
    }
    if (config.fileNotFound || !config.url) fail(`${describeRemote(object)} does not exist on ${target.label}.`, undefined, "not_found");
    const url = /^https?:\/\//.test(config.url) ? config.url : `${target.baseUrl}${config.url.startsWith("/") ? "" : "/"}${config.url}`;
    if (isJsonMode()) emit(() => undefined, { object: describeRemote(object), url });
    else process.stdout.write(`${url}\n`);
}

export const STORAGE_STAT_FLAGS = { ...PROJECT_TARGET_FLAGS } satisfies arg.Spec;

export async function storageStat(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parsedLine(() => parseCommandArgs({
        spec: STORAGE_STAT_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "storage stat",
        maxPositionals: 1
    }));
    const object = parsedLine(() => requireRemote(positionals[0], "storage stat"));
    const target = await projectTarget(flags, { command: "storage stat" });
    const storage = await storageFor(target, object.source);
    let config: Awaited<ReturnType<typeof storage.getSignedUrl>>;
    try {
        config = await storage.getSignedUrl(object.key);
    } catch (e) {
        reportStorageError(e, `Failed to read ${describeRemote(object)}`);
    }
    if (config.fileNotFound) fail(`${describeRemote(object)} does not exist on ${target.label}.`, undefined, "not_found");
    const metadata = isRecord(config.metadata) ? config.metadata : {};
    emit(() => {
        console.log(`  ${chalk.bold(describeRemote(object))}`);
        for (const [key, value] of Object.entries(metadata)) {
            if (value === undefined || value === null || typeof value === "object") continue;
            console.log(`    ${chalk.gray(key.padEnd(16))}${String(value)}`);
        }
    }, { object: describeRemote(object), metadata });
}
