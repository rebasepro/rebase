/**
 * Which organization an org-scoped `rebase cloud` command acts on.
 *
 * In order: `--org <id>`, then the active organization `rebase cloud use`
 * selected for this control plane, then the organization of the project this
 * directory is linked to. The last rung is what a linked checkout already
 * knows: `orgs members list` in a linked directory used to refuse with
 * `no_org`, asking for an id the link file had been holding all along.
 *
 * The linked project's organization is read off the project record, because a
 * project can move to another organization after the link was written; the
 * `orgId` the link file stores answers only when that read cannot. A link to
 * another control plane, or a direct link to a backend, says nothing about the
 * organizations on this one, so neither is used.
 */
import chalk from "chalk";
import { fail, getContextOrg, note, readLink, type CloudClient } from "./context";

/** Where an organization came from: the flag, `rebase cloud use`, or the linked project. */
export type OrgSource = "flag" | "active" | "linked_project";

export interface OrgScope {
    org: string;
    source: OrgSource;
    /** The linked project's slug (or name, or id), when `source` is `linked_project`. */
    project?: string;
}

/** The organization a project belongs to, or undefined when its row does not say. */
export async function projectOrganization(client: CloudClient, projectId: string): Promise<string | undefined> {
    try {
        const row = (await client.data.table("projects").findById(projectId)) as Record<string, unknown> | undefined;
        const raw = row?.organization ?? row?.organizationId ?? row?.organization_id;
        if (raw && typeof raw === "object" && "id" in raw) return String(raw.id);
        return raw == null || raw === "" ? undefined : String(raw);
    } catch {
        return undefined;
    }
}

/**
 * How to name an organization to a person: its name, else its slug, else the
 * id. A confirmation that said "in org c2926495-805c-…" asked the reader to
 * recognise a UUID. Never throws: a failed read names the id.
 */
export async function organizationLabel(client: CloudClient, org: string): Promise<string> {
    try {
        const row = (await client.data.table("organizations").findById(org)) as Record<string, unknown> | undefined;
        const name = typeof row?.name === "string" ? row.name.trim() : "";
        if (name) return name;
        const slug = typeof row?.slug === "string" ? row.slug.trim() : "";
        return slug || org;
    } catch {
        return org;
    }
}

/** Two control-plane addresses that name the same host, however they were spelled. */
function sameControlPlane(a: string, b: string): boolean {
    const norm = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();
    return norm(a) === norm(b);
}

/**
 * The organization of the project this directory is linked to on `url`, or
 * undefined when it is not linked to a project there.
 */
export async function linkedProjectOrg(
    client: CloudClient,
    url: string
): Promise<{ org: string; project: string } | undefined> {
    const link = readLink();
    if (!link || link.mode === "direct" || !link.projectId || !link.url) return undefined;
    if (!sameControlPlane(link.url, url)) return undefined;
    const org = (await projectOrganization(client, link.projectId)) ?? (link.orgId?.trim() || undefined);
    if (!org) return undefined;
    return { org, project: link.slug || link.projectName || link.projectId };
}

/** `--org`, else the active organization, else the linked project's — or undefined when none says. */
export async function resolveOrgScope(
    client: CloudClient,
    url: string,
    flag: string | undefined
): Promise<OrgScope | undefined> {
    const explicit = flag?.trim();
    if (explicit) return { org: explicit, source: "flag" };
    const active = getContextOrg(url);
    if (active) return { org: active, source: "active" };
    const linked = await linkedProjectOrg(client, url);
    return linked ? { org: linked.org, source: "linked_project", project: linked.project } : undefined;
}

/**
 * Say which organization a command is acting on when nobody named one: the
 * linked project's. On stderr, and only in human mode — the result itself
 * carries the id.
 */
export function announceOrgScope(scope: OrgScope): void {
    if (scope.source !== "linked_project") return;
    note(chalk.gray(
        `Using org ${scope.org}, the organization of the linked project ${scope.project}. `
            + "Pass --org <id> or run `rebase cloud use` for another."
    ));
}

/** The hint every `no_org` refusal gives. */
export const NO_ORG_HINT =
    `Pass ${chalk.bold("--org <id>")}, run ${chalk.bold("rebase cloud use")}, or run it in a directory linked with ${chalk.bold("rebase cloud link")}.`;

/**
 * The organization to act on, announced when it is the linked project's, or a
 * `no_org` refusal when nothing names one.
 */
export async function requireOrg(client: CloudClient, url: string, flag?: string): Promise<string> {
    const scope = await resolveOrgScope(client, url, flag);
    if (!scope) fail("No organization selected.", NO_ORG_HINT, "no_org");
    announceOrgScope(scope);
    return scope.org;
}
