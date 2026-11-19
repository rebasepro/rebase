/**
 * Which project one tool call acts on.
 *
 * The server keeps a machine-wide registry (`~/.rebase/projects.json`) with a
 * sticky `activeProject`. That stickiness is what let a session working in a
 * directory linked to one Rebase Cloud project read the status of another
 * customer's project: a server installed once for the whole machine (with
 * `REBASE_PROJECT_DIR` pointing at its own install directory) had been
 * switched to that other project in an earlier session, and every tool kept
 * acting on it, with no project argument anywhere to say otherwise. A
 * `delete_user`, an `env_set` or a deploy would have gone to the same place.
 *
 * So every project-scoped tool resolves its project per call, from three
 * inputs, and refuses rather than picks when they disagree:
 *
 * 1. The `project` argument, when the call names one.
 * 2. The link of the directory the session works in (`.rebase/cloud.json`
 *    under the project root of the client's first root, else this process's
 *    working directory), the place a person decided which Cloud project a
 *    checkout belongs to.
 * 3. The active project in the registry.
 *
 * This module holds the decision and no I/O beyond reading link files, so the
 * rules are tested directly.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

/** A directory's Rebase Cloud link, as the CLI writes it. */
export interface CloudLink {
    projectId: string;
    /** The project's subdomain, which people type into `--project`. */
    slug?: string;
    /** The control plane the project lives on. */
    url?: string;
    /** The project root the link file sits under. */
    root: string;
}

/** What the decision needs to know about a registry entry. */
export interface ScopeEntry {
    name: string;
    projectDir?: string;
    cloud?: { host: string; projectId: string };
}

/**
 * Walk up from `startDir` to the project root the way the CLI does
 * (`rebase.json`, or `backend/` beside `config/`). Stops below the home
 * directory: `~/.rebase` is the CLI's own configuration, not a project.
 */
export function findProjectRoot(startDir: string): string | null {
    let dir = resolve(startDir);
    const home = resolve(homedir());
    for (;;) {
        if (dir === home) return null;
        if (existsSync(join(dir, "rebase.json"))) return dir;
        if (existsSync(join(dir, "backend")) && existsSync(join(dir, "config"))) return dir;
        const parent = dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

/**
 * The Cloud project the directory is linked to, or `null`. A self-hosted
 * (`mode: "direct"`) link names no Cloud project and counts as none.
 */
export function readCloudLink(startDir: string): CloudLink | null {
    const root = findProjectRoot(startDir);
    if (!root) return null;
    try {
        const raw: unknown = JSON.parse(readFileSync(join(root, ".rebase", "cloud.json"), "utf-8"));
        if (typeof raw !== "object" || raw === null) return null;
        const link = raw as Record<string, unknown>;
        if (link.mode === "direct") return null;
        if (typeof link.projectId !== "string" || link.projectId === "") return null;
        return {
            projectId: link.projectId,
            slug: typeof link.slug === "string" ? link.slug : undefined,
            url: typeof link.url === "string" ? link.url : undefined,
            root
        };
    } catch {
        return null;
    }
}

export type ScopeDecision =
    /** Act on this registry entry. */
    | { kind: "entry"; name: string }
    /** Act on the project the caller's directory is linked to. */
    | { kind: "link"; link: CloudLink }
    /** The argument names a Cloud project the registry does not hold: look it up, then check it against the link. */
    | { kind: "lookup"; ref: string }
    | { kind: "refuse"; message: string };

export interface ScopeInput {
    tool: string;
    /** Whether the tool changes the target (a gated tool or a Cloud write). */
    isWrite: boolean;
    /** The call's `project` argument. */
    requested?: string;
    entries: Record<string, ScopeEntry>;
    activeName: string | null;
    /** Whether this server process selected the active project (switch, use_cloud, add), rather than reading it from disk. */
    activeChosenThisRun: boolean;
    /** The link of the directory the session works in. */
    callerLink: CloudLink | null;
    /** The project root of the directory the session works in. */
    callerRoot: string | null;
    /** A directory's link; injected so the rules are testable. */
    linkOf: (dir: string) => CloudLink | null;
}

function label(link: CloudLink): string {
    return link.slug ? `"${link.slug}" (${link.projectId})` : link.projectId;
}

/** The Cloud project an entry acts on: its own, or its directory's link. */
export function entryCloudProjectId(entry: ScopeEntry, linkOf: (dir: string) => CloudLink | null): string | undefined {
    return entry.cloud?.projectId ?? (entry.projectDir ? linkOf(entry.projectDir)?.projectId : undefined);
}

/** A registry entry the `project` argument names: by name, as `cloud:<ref>`, or by Cloud project id. */
export function matchEntry(requested: string, entries: Record<string, ScopeEntry>): string | null {
    const wanted = requested.trim();
    if (entries[wanted]) return wanted;
    if (entries[`cloud:${wanted}`]) return `cloud:${wanted}`;
    const lower = wanted.toLowerCase();
    for (const [name, entry] of Object.entries(entries)) {
        if (entry.cloud?.projectId === wanted) return name;
        if (name.toLowerCase() === `cloud:${lower}`) return name;
    }
    return null;
}

/** The refusal for a named project that is not the one the directory is linked to. */
export function mismatchRefusal(tool: string, named: string, link: CloudLink): string {
    return `Refusing to run "${tool}": it names the project "${named}", but this session works in ${link.root}, ` +
        `which is linked to the Rebase Cloud project ${label(link)}. Nothing was done. If the user really means ` +
        `"${named}", they have to say so from a directory linked to it; otherwise call again with project: ` +
        `"${link.slug ?? link.projectId}".`;
}

export function decideProjectScope(input: ScopeInput): ScopeDecision {
    const { tool, requested, entries, callerLink, linkOf } = input;

    if (requested !== undefined && requested.trim() !== "") {
        const name = matchEntry(requested, entries);
        if (name) {
            const id = entryCloudProjectId(entries[name], linkOf);
            if (callerLink && id && id !== callerLink.projectId) {
                return { kind: "refuse", message: mismatchRefusal(tool, requested, callerLink) };
            }
            return { kind: "entry", name };
        }
        if (callerLink && (requested === callerLink.projectId || requested.toLowerCase() === callerLink.slug?.toLowerCase())) {
            return { kind: "link", link: callerLink };
        }
        if (callerLink) return { kind: "refuse", message: mismatchRefusal(tool, requested, callerLink) };
        return { kind: "lookup", ref: requested };
    }

    const activeName = input.activeName && entries[input.activeName] ? input.activeName : null;
    const active = activeName ? entries[activeName] : undefined;
    if (!active || !activeName) {
        return callerLink
            ? { kind: "link", link: callerLink }
            : { kind: "refuse", message: "No active project configured. Use rebase_project_add to register one, or pass `project`." };
    }

    const activeId = entryCloudProjectId(active, linkOf);
    if (callerLink) {
        if (activeId && activeId !== callerLink.projectId) {
            return {
                kind: "refuse",
                message: `Refusing to run "${tool}": this session works in ${callerLink.root}, which is linked to the Rebase ` +
                    `Cloud project ${label(callerLink)}, but the tools are pointed at "${activeName}"` +
                    `${active.cloud ? ` (Cloud project ${active.cloud.projectId})` : ""}. Nothing was done. Call again ` +
                    `with project: "${callerLink.slug ?? callerLink.projectId}" to act on the linked project, or with ` +
                    `project: "${activeName}" only if the user asked for that one by name.`
            };
        }
        // A server started somewhere else (one install for the whole machine)
        // standing in for a session that works in a linked checkout: the link
        // is the only statement of which project this session is about.
        if (!activeId && !active.cloud && active.projectDir && input.callerRoot && resolve(active.projectDir) !== resolve(input.callerRoot)) {
            return { kind: "link", link: callerLink };
        }
        return { kind: "entry", name: activeName };
    }

    // No link to check against. A Cloud project remembered from an earlier
    // session is still a fine thing to read, but a write to it has to be
    // asked for by name, in this session.
    if (active.cloud && input.isWrite && !input.activeChosenThisRun) {
        return {
            kind: "refuse",
            message: `Refusing to run "${tool}": the tools point at "${activeName}" only because an earlier session ` +
                `selected it, and this session's directory is not linked to any Rebase Cloud project. Nothing was ` +
                `done. Call again with project: "${activeName}" if the user asked for that project by name.`
        };
    }
    return { kind: "entry", name: activeName };
}
