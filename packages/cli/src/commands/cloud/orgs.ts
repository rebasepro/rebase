/**
 * `rebase cloud orgs` — list / create / rename / delete / members / invites.
 *
 * Members: list, invite by email, remove, change a role. Inviting goes through
 * the control plane's `invites` function, which always opens an invitation —
 * nobody joins an organization until they accept, an existing account
 * included: a link, valid 7 days, that only an account which has verified that
 * address can accept. Nobody is invited as owner; an owner promotes them once
 * they have joined. The link is printed, because the control plane may send no email;
 * the output says whether it did. Inviting takes a `rebase cloud login`
 * session — a token cannot hand out access to an organization.
 */
import chalk from "chalk";
import inquirer from "inquirer";
import {
    requireClient,
    parseCloudArgs,
    getContextOrg,
    setContextOrg,
    colorStatus,
    success,
    fail,
    reportError,
    emit,
    printGroupHelp,
    note,
    requireInteractive,
    cloudRows,
    cloudRow,
    requireCloudRow,
    requireSessionClient,
    confirmDestructive,
    warn,
    type CloudClient
} from "./context";
import { reportCallError, type Unserved } from "./not-served";

/** What the invitation commands say on a control plane that has no `invites` function yet. */
const INVITES_UNSERVED: Unserved = {
    what: "invitations",
    hint: "Nothing was sent or changed. `rebase cloud orgs members` still lists, removes and re-roles the members an organization has."
};

interface OrgRow {
    id: string | number;
    name?: string;
    slug?: string;
    description?: string;
    createdAt?: string;
}

export async function orgsCommand(subcommand: string | undefined, rawArgs: string[]): Promise<void> {
    switch (subcommand) {
        case "list":
        case undefined:
            await listOrgs(rawArgs);
            break;
        case "create":
            await createOrg(rawArgs);
            break;
        case "rename":
            await renameOrg(rawArgs);
            break;
        case "delete":
            await deleteOrg(rawArgs);
            break;
        case "members":
            await membersCommand(rawArgs);
            break;
        case "invites":
            await invitesCommand(rawArgs);
            break;
        case "--help":
            printOrgsHelp();
            break;
        default:
            fail(`Unknown orgs command: ${subcommand}`, "Run `rebase cloud orgs --help`.", "unknown_command");
    }
}

async function listOrgs(rawArgs: string[]): Promise<void> {
    parseCloudArgs({ spec: {},
rawArgs,
commandWords: 3,
command: "cloud orgs",
maxPositionals: 0 });
    const { client, url } = await requireClient(rawArgs);
    try {
        const orgs = cloudRows<OrgRow>((await client.data.table("organizations").find({ limit: 100 })).data);
        const active = getContextOrg(url);

        emit(
            () => {
                console.log("");
                console.log(chalk.bold("  🏢 Organizations"));
                console.log("");
                if (orgs.length === 0) {
                    console.log(chalk.gray("  You are not a member of any organization."));
                    console.log("");
                    return;
                }
                for (const o of orgs) {
                    const marker = String(o.id) === active ? chalk.green(" ●") : "  ";
                    console.log(`${marker}${chalk.bold(o.name ?? "(unnamed)")} ${chalk.gray(`[${o.id}]`)}${o.slug ? chalk.gray(`  ${o.slug}`) : ""}`);
                }
                console.log("");
                // The legend explains the ● glyph, which only exists in the
                // human rendering — `active: true` needs no legend.
                note(chalk.gray("● = active organization. Switch with `rebase cloud use <id>`."));
                console.log("");
            },
            {
                activeOrg: active ?? null,
                organizations: orgs.map((o) => ({
                    id: String(o.id),
                    name: o.name ?? null,
                    slug: o.slug ?? null,
                    active: String(o.id) === active
                }))
            }
        );
    } catch (e) {
        reportError(e, "Failed to list organizations");
    }
}

/** What `rebase cloud orgs create` parses. Its page is the group's own. */
export const CREATE_ORG_FLAGS = {
    "--name": String,
    "--slug": String,
    "-n": "--name"
} as const;

async function createOrg(rawArgs: string[]): Promise<void> {
    // Strict: `--nmae "Acme"` used to be dropped, and the command then prompted
    // for a name — or, off a terminal, refused for one that had been given.
    const { flags: args } = parseCloudArgs({
        spec: CREATE_ORG_FLAGS,
        rawArgs,
        commandWords: 3, // cloud orgs create
        command: "cloud orgs",
        maxPositionals: 0
    });
    const { client, url } = await requireClient(rawArgs);

    const prompts: Array<{ type: "input"; name: string; message: string }> = [];
    if (!args["--name"]) {
        requireInteractive("an organization name", "--name <name>");
        prompts.push({ type: "input",
name: "name",
message: "Organization name:" });
    }
    const answers = prompts.length
        ? await inquirer.prompt(prompts)
        : {};

    const name = (args["--name"] || (answers as { name?: string }).name || "").trim();
    if (!name) fail("Organization name is required.", "Pass `--name <name>`.", "input_required");
    const slug = (args["--slug"] || slugify(name)).trim();

    try {
        const created = requireCloudRow<OrgRow>(await client.data.table("organizations").create({
            name,
            slug,
            createdAt: new Date().toISOString()
        }), "organization");
        setContextOrg(url, String(created.id));
        success(`Created organization ${chalk.bold(name)} and set it active`);
        emit(() => {}, {
            success: true,
            id: String(created.id),
            name,
            slug,
            setActive: true
        });
    } catch (e) {
        reportError(e, "Failed to create organization");
    }
}

/** What `rebase cloud orgs rename` parses. Its page is the group's own. */
export const RENAME_ORG_FLAGS = {
    "--slug": String,
    "--org": String
} as const;

/**
 * Rename an organization, and with `--slug` change its slug. A plain update of
 * the `organizations` row: the control plane lets its owners and admins make
 * it, and refuses a slug another organization holds.
 */
async function renameOrg(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parseCloudArgs({
        spec: RENAME_ORG_FLAGS,
        rawArgs,
        commandWords: 3, // cloud orgs rename
        command: "cloud orgs",
        maxPositionals: 1
    });
    const name = positionals[0]?.trim();
    const slug = flags["--slug"]?.trim();
    if (!name) fail("Name the organization's new name.", "`rebase cloud orgs rename \"Acme Inc\" [--slug acme]`.", "usage");
    if (slug !== undefined && slugify(slug) !== slug) {
        fail(`--slug ${slug} is not a slug.`, `Lowercase letters, digits and hyphens, e.g. ${slugify(slug) || "acme"}.`, "usage");
    }
    const { client, url } = await requireClient(rawArgs);
    const org = orgFor(flags["--org"], url);
    const patch: Record<string, string> = { name };
    if (slug) patch.slug = slug;
    try {
        await client.data.table("organizations").update(org, patch);
    } catch (e) {
        // The server's words: not an owner or admin, or the slug is taken.
        reportError(e, "Failed to rename the organization");
    }
    emit(() => success(`Organization ${org} is now ${chalk.bold(name)}${slug ? ` (${slug})` : ""}`), { success: true, id: org, ...patch });
}

/**
 * Delete an organization. Asks first, and refuses while it still has projects:
 * deleting each project is what tears down its namespace and database and
 * cancels its subscription, and the control plane will not let an
 * organization's deletion skip that. The check here names them before asking;
 * the control plane's own refusal is the authority.
 */
async function deleteOrg(rawArgs: string[]): Promise<void> {
    const { flags } = parseCloudArgs({
        spec: { "--org": String },
        rawArgs,
        commandWords: 3, // cloud orgs delete
        command: "cloud orgs",
        maxPositionals: 0
    });
    const { client, url } = await requireClient(rawArgs);
    const org = orgFor(flags["--org"], url);

    let row: OrgRow | undefined;
    let projects: Array<{ id: string | number; subdomain?: string; name?: string }>;
    try {
        row = cloudRow<OrgRow>(await client.data.table("organizations").findById(org));
        projects = cloudRows<{ id: string | number; subdomain?: string; name?: string }>((await client.data.table("projects").find({
            where: { organization: ["==", org] },
            limit: 20
        })).data);
    } catch (e) {
        reportError(e, "Failed to read the organization");
    }
    if (!row) fail(`No organization ${org} that you can see.`, "`rebase cloud orgs` lists yours.", "not_found");
    const label = row.name ? `${row.name} (${org})` : org;
    if (projects.length > 0) {
        const names = projects.map((p) => String(p.subdomain ?? p.name ?? p.id)).sort();
        fail(
            `Organization ${label} still has ${projects.length}${projects.length === 20 ? "+" : ""} project(s): ${names.slice(0, 5).join(", ")}${names.length > 5 ? ", …" : ""}.`,
            "Delete them first with `rebase cloud projects delete <slug>`: that is what tears down each one's database and cancels its subscription.",
            "org_not_empty"
        );
    }

    await confirmDestructive({
        yes: Boolean(flags["--yes"]),
        prompt: `Delete organization ${label}? Its members lose it, and this cannot be undone.`
    });
    try {
        await client.data.table("organizations").delete(org);
    } catch (e) {
        // The server's words: not an owner or admin, or projects remain.
        reportError(e, "Failed to delete the organization");
    }
    // The active organization no longer exists; leaving it selected would
    // send every later command to an id that answers nothing.
    const wasActive = getContextOrg(url) === org;
    if (wasActive) setContextOrg(url, undefined);
    emit(
        () => {
            success(`Deleted organization ${label}`);
            if (wasActive) note(chalk.gray("It was the active organization; pick another with `rebase cloud use`."));
        },
        { success: true, deleted: org, wasActive }
    );
}

/** A membership row with the person's email, when the caller may read it. */
interface MemberRow {
    id: string;
    userId: string | null;
    email: string | null;
    role: string | null;
}

/** An open invitation, as the control plane lists it. Never the link. */
export interface CliInvite {
    id: string;
    email: string;
    role: string;
    invitedBy: { userId: string | null; email: string | null };
    expiresAt: string;
    expired: boolean;
    createdAt: string | null;
}

type EmailDelivery = { sent: true } | { sent: false; reason: "not_configured" | "failed" };

const MEMBER_ROLES = ["owner", "admin", "member"] as const;

const MEMBERS_ACTIONS = ["list", "invite", "remove", "role"] as const;
const INVITES_ACTIONS = ["list", "revoke", "resend"] as const;

/** The organization a members/invites command acts on: `--org`, else the active one. */
function orgFor(flag: string | undefined, url: string): string {
    const org = flag || getContextOrg(url);
    if (!org) fail("No organization selected.", `Pass ${chalk.bold("--org <id>")} or run ${chalk.bold("rebase cloud use")}.`, "no_org");
    return org;
}

async function loadMembers(client: CloudClient, org: string): Promise<MemberRow[]> {
    const rows = cloudRows<{ id: string | number; userId?: string; role?: string }>((await client.data.table("organization-members").find({
        where: { organization: ["==", org] },
        limit: 200
    })).data);
    const ids = rows.map((m) => m.userId).filter((id): id is string => typeof id === "string" && id !== "");
    const emails = new Map<string, string>();
    if (ids.length > 0) {
        // The users read policy shows the people you share an organization
        // with, which is exactly this list. An unreadable row leaves the id.
        try {
            const users = cloudRows<{ id: string | number; email?: string }>((await client.data.table("users").find({
                where: { id: ["in", ids] },
                limit: 200
            })).data);
            for (const u of users) if (u.email) emails.set(String(u.id), u.email);
        } catch {
            /* ids only */
        }
    }
    return rows.map((m) => ({
        id: String(m.id),
        userId: m.userId ?? null,
        email: m.userId ? emails.get(m.userId) ?? null : null,
        role: m.role ?? null
    }));
}

/** The membership `ref` names — a user id or an email — or a refusal. */
function pickMember(members: MemberRow[], ref: string | undefined, action: string): MemberRow {
    if (!ref) fail(`Name the member to ${action}.`, `Pass their email or user id: \`rebase cloud orgs members ${action} <email|uid>\`.`, "usage");
    const wanted = ref.trim().toLowerCase();
    const match = members.find((m) => m.userId === ref || (m.email ?? "").toLowerCase() === wanted);
    if (!match) {
        fail(`${ref} is not a member of this organization.`, "Run `rebase cloud orgs members` to see who is.", "not_found");
    }
    return match;
}

async function membersCommand(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parseCloudArgs({
        spec: { "--role": String, "--org": String },
        rawArgs,
        commandWords: 3, // cloud orgs members
        command: "cloud orgs",
        maxPositionals: 3
    });
    const [action = "list", ...rest] = positionals;
    if (!(MEMBERS_ACTIONS as readonly string[]).includes(action)) {
        fail(
            `Unknown orgs members command: ${action}`,
            `Run \`rebase cloud orgs --help\`. Actions: ${MEMBERS_ACTIONS.join(", ")}.`,
            "unknown_command"
        );
    }
    if (flags["--role"] !== undefined && action !== "invite") {
        fail(`--role belongs to \`members invite\`.`, "To change a member's role: `rebase cloud orgs members role <email|uid> <role>`.", "usage");
    }
    const expected = action === "list" ? 0 : action === "role" ? 2 : 1;
    if (rest.length > expected) {
        fail(`Too many arguments for \`orgs members ${action}\`: ${rest.slice(expected).join(" ")}`, "Run `rebase cloud orgs --help`.", "usage");
    }
    if (action === "role" && rest[1] !== undefined && !(MEMBER_ROLES as readonly string[]).includes(rest[1])) {
        fail(`"${rest[1]}" is not a role.`, "A role is owner, admin or member.", "usage");
    }
    const role = flags["--role"] ?? "member";
    if (action === "invite" && role === "owner") {
        const who = rest[0] ?? "<email>";
        fail(
            "Nobody is invited as an owner.",
            `Invite them with --role admin, and once they have joined: \`rebase cloud orgs members role ${who} owner\`.`,
            "invite_role_not_allowed"
        );
    }
    if (action === "invite" && !(MEMBER_ROLES as readonly string[]).includes(role)) {
        fail(`"${role}" is not a role.`, "Pass --role admin or --role member.", "usage");
    }

    switch (action) {
        case "list":
            return listMembers(rawArgs, flags["--org"]);
        case "invite":
            return inviteMember(rawArgs, flags["--org"], rest[0], role);
        case "remove":
            return removeMember(rawArgs, flags["--org"], rest[0], Boolean(flags["--yes"]));
        case "role":
            return changeRole(rawArgs, flags["--org"], rest[0], rest[1], Boolean(flags["--yes"]));
    }
}

async function listMembers(rawArgs: string[], orgFlag: string | undefined): Promise<void> {
    const { client, url } = await requireClient(rawArgs);
    const org = orgFor(orgFlag, url);
    let members: MemberRow[];
    try {
        members = await loadMembers(client, org);
    } catch (e) {
        reportError(e, "Failed to list members");
    }
    emit(
        () => {
            console.log("");
            console.log(chalk.bold(`  👥 Members — org ${org}`));
            console.log("");
            if (members.length === 0) {
                console.log(chalk.gray("  No members found."));
                console.log("");
                return;
            }
            for (const m of members) {
                const who = m.email ?? m.userId ?? "?";
                console.log(`  ${chalk.bold(who)}  ${colorStatus(m.role ?? undefined)}${m.email && m.userId ? chalk.gray(`  ${m.userId}`) : ""}`);
            }
            console.log("");
            note(chalk.gray("Invite someone: `rebase cloud orgs members invite <email>`. Pending: `rebase cloud orgs invites`."));
            console.log("");
        },
        { org, members }
    );
}

/**
 * Whether the invitation email went out. Not sent is a warning, not a note: the
 * invitee hears nothing unless whoever ran this passes the link on, so it is
 * said in JSON mode too (stderr), and `emailDelivery` carries it in the value.
 */
function reportDelivery(delivery: EmailDelivery, email: string): void {
    if (delivery.sent) {
        note(chalk.gray(`Emailed the invitation to ${email}.`));
        return;
    }
    warn(
        delivery.reason === "failed"
            ? `The invitation email to ${email} could not be sent.`
            : `This control plane sends no email, so nothing was sent to ${email}.`,
        "Send them the link yourself."
    );
}

async function inviteMember(rawArgs: string[], orgFlag: string | undefined, email: string | undefined, role: string): Promise<void> {
    if (!email) fail("Name the address to invite.", "`rebase cloud orgs members invite <email> [--role admin|member]`.", "usage");
    const { client, url } = await requireSessionClient(rawArgs, "invite people to an organization");
    const org = orgFor(orgFlag, url);
    type Result =
        | { kind: "added"; userId: string; role: string; email: string }
        | { kind: "invited"; invite: CliInvite; link: string; emailDelivery: EmailDelivery };
    let result: Result;
    try {
        result = await client.functions.invoke<Result>("invites", { organizationId: org, email: email.trim().toLowerCase(), role });
    } catch (e) {
        reportCallError(e, `Failed to invite ${email}`, INVITES_UNSERVED);
    }
    if (result.kind === "added") {
        // Only a control plane from before invitations-for-everyone adds
        // anyone directly; today's always answers "invited".
        emit(() => success(`${result.email} already had a verified account and is now a member (${result.role}) of org ${org}`), { org, ...result });
        return;
    }
    const invited = result;
    emit(
        () => {
            success(`Invitation sent to ${invited.invite.email} as ${invited.invite.role} — they join when they accept; the link works once, until ${invited.invite.expiresAt.slice(0, 10)}`);
            console.log("");
            console.log(`  ${chalk.cyan(invited.link)}`);
            console.log("");
            note(chalk.gray("Only an account that has verified that address can accept it."));
        },
        { org, ...invited }
    );
    reportDelivery(invited.emailDelivery, invited.invite.email);
}

async function removeMember(rawArgs: string[], orgFlag: string | undefined, ref: string | undefined, yes: boolean): Promise<void> {
    if (!ref) pickMember([], ref, "remove");
    const { client, url } = await requireClient(rawArgs);
    const org = orgFor(orgFlag, url);
    let members: MemberRow[];
    try {
        members = await loadMembers(client, org);
    } catch (e) {
        reportError(e, "Failed to list members");
    }
    const target = pickMember(members, ref, "remove");
    const who = target.email ?? target.userId ?? ref;
    await confirmDestructive({ yes, prompt: `Remove ${who} (${target.role ?? "member"}) from org ${org}? They lose access to its projects.` });
    try {
        await client.data.table("organization-members").delete(target.id);
    } catch (e) {
        // The server's words: the last owner, or an admin removing an owner.
        reportError(e, `Failed to remove ${who}`);
    }
    emit(() => success(`Removed ${who} from org ${org}`), { org, removed: { userId: target.userId, email: target.email, role: target.role } });
}

async function changeRole(
    rawArgs: string[],
    orgFlag: string | undefined,
    ref: string | undefined,
    role: string | undefined,
    yes: boolean
): Promise<void> {
    if (!ref || !role) fail("Name the member and the role.", "`rebase cloud orgs members role <email|uid> <owner|admin|member>`.", "usage");
    const { client, url } = await requireClient(rawArgs);
    const org = orgFor(orgFlag, url);
    let members: MemberRow[];
    try {
        members = await loadMembers(client, org);
    } catch (e) {
        reportError(e, "Failed to list members");
    }
    const target = pickMember(members, ref, "role");
    const who = target.email ?? target.userId ?? ref;
    if (target.role === role) {
        emit(() => success(`${who} is already ${role} in org ${org}`), { org, userId: target.userId, email: target.email, role, changed: false });
        return;
    }
    // A role is what someone may do to every project in the organization;
    // owner is the one that may delete it. Asked every time, said loudest
    // where owner is granted or taken away.
    const ownership = role === "owner"
        ? " They will be able to delete the organization and change anyone's role."
        : target.role === "owner" ? " They stop being an owner." : "";
    await confirmDestructive({
        yes,
        prompt: `Make ${who} ${role} in org ${org} (now ${target.role ?? "member"})?${ownership}`
    });
    try {
        await client.data.table("organization-members").update(target.id, { role });
    } catch (e) {
        // The server's words: only an owner grants or removes owner; never the last owner.
        reportError(e, `Failed to change ${who}'s role`);
    }
    emit(() => success(`${who} is now ${role} in org ${org} (was ${target.role ?? "member"})`), {
        org, userId: target.userId, email: target.email, role, previousRole: target.role, changed: true
    });
}

async function loadInvites(client: CloudClient, org: string): Promise<{ invites: CliInvite[]; canManage: boolean }> {
    return client.functions.invoke<{ invites: CliInvite[]; canManage: boolean }>(
        "invites",
        undefined,
        { method: "GET", path: `org/${encodeURIComponent(org)}` }
    );
}

/** The open invitation `ref` names — its id or its email — or a refusal. */
function pickInvite(invites: CliInvite[], ref: string | undefined, action: string): CliInvite {
    if (!ref) fail(`Name the invitation to ${action}.`, `Pass its id or email: \`rebase cloud orgs invites ${action} <id|email>\`.`, "usage");
    const wanted = ref.trim().toLowerCase();
    const match = invites.find((i) => i.id === ref || i.email === wanted);
    if (!match) fail(`No pending invitation for ${ref}.`, "Run `rebase cloud orgs invites` to see the pending ones.", "not_found");
    return match;
}

async function invitesCommand(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parseCloudArgs({
        spec: { "--org": String },
        rawArgs,
        commandWords: 3, // cloud orgs invites
        command: "cloud orgs",
        maxPositionals: 2
    });
    const [action = "list", ref] = positionals;
    if (!(INVITES_ACTIONS as readonly string[]).includes(action)) {
        fail(
            `Unknown orgs invites command: ${action}`,
            `Run \`rebase cloud orgs --help\`. Actions: ${INVITES_ACTIONS.join(", ")}.`,
            "unknown_command"
        );
    }
    if (action === "list" && ref !== undefined) {
        fail(`Too many arguments for \`orgs invites\`: ${ref}`, "Run `rebase cloud orgs --help`.", "usage");
    }
    if (action !== "list" && !ref) pickInvite([], ref, action);

    const { client, url } = await requireSessionClient(rawArgs, "manage invitations");
    const org = orgFor(flags["--org"], url);
    let listed: { invites: CliInvite[]; canManage: boolean };
    try {
        listed = await loadInvites(client, org);
    } catch (e) {
        // A member: pending invitations, like inviting, are an owner's and
        // admin's. Said plainly rather than as a bare 403.
        if ((e as { status?: number } | null)?.status === 403) {
            fail(
                `Only owners and admins of org ${org} can see its pending invitations.`,
                "Ask one of them; `rebase cloud orgs members` lists who they are.",
                "forbidden"
            );
        }
        reportCallError(e, "Failed to list invitations", INVITES_UNSERVED);
    }

    if (action === "list") {
        emit(
            () => {
                console.log("");
                console.log(chalk.bold(`  ✉️  Pending invitations — org ${org}`));
                console.log("");
                if (listed.invites.length === 0) {
                    console.log(chalk.gray("  No pending invitations."));
                    console.log("");
                    return;
                }
                for (const i of listed.invites) {
                    const when = i.expired ? chalk.yellow("expired") : chalk.gray(`expires ${i.expiresAt.slice(0, 10)}`);
                    console.log(`  ${chalk.bold(i.email)}  ${colorStatus(i.role)}  ${when}  ${chalk.gray(`by ${i.invitedBy.email ?? "?"}  [${i.id}]`)}`);
                }
                console.log("");
            },
            { org, invites: listed.invites }
        );
        return;
    }

    const target = pickInvite(listed.invites, ref, action);
    if (action === "revoke") {
        await confirmDestructive({
            yes: Boolean(flags["--yes"]),
            prompt: `Revoke the invitation for ${target.email} (${target.role})? Its link stops working.`
        });
        try {
            await client.functions.invoke("invites", undefined, { method: "DELETE", path: encodeURIComponent(target.id) });
        } catch (e) {
            reportCallError(e, `Failed to revoke the invitation for ${target.email}`, INVITES_UNSERVED);
        }
        emit(() => success(`Revoked the invitation for ${target.email}; its link no longer works`), { org, revoked: target });
        return;
    }

    let resent: { invite: CliInvite; link: string; emailDelivery: EmailDelivery };
    try {
        resent = await client.functions.invoke<{ invite: CliInvite; link: string; emailDelivery: EmailDelivery }>(
            "invites", {}, { path: `${encodeURIComponent(target.id)}/resend` }
        );
    } catch (e) {
        reportCallError(e, `Failed to resend the invitation for ${target.email}`, INVITES_UNSERVED);
    }
    emit(
        () => {
            success(`New link for ${resent.invite.email}, valid until ${resent.invite.expiresAt.slice(0, 10)}; the old one no longer works`);
            console.log("");
            console.log(`  ${chalk.cyan(resent.link)}`);
            console.log("");
        },
        { org, ...resent }
    );
    reportDelivery(resent.emailDelivery, resent.invite.email);
}

function slugify(s: string): string {
    return s
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

export function printOrgsHelp(): void {
    printGroupHelp({
        command: "cloud orgs",
        title: "Organizations",
        actions: [
            { action: "list",
description: "List organizations you belong to" },
            {
                action: "create",
                description: "Create a new organization",
                flags: [
                    ["--name <name>", "Display name"],
                    ["--slug <slug>", "URL slug. Derived from the name when omitted"]
                ]
            },
            {
                action: "rename",
                args: "<name>",
                description: "Rename the organization. Owners and admins",
                flags: [
                    ["--slug <slug>", "Change its slug too. Kept when omitted"],
                    ["--org <id>", "The organization. Default: the active one"]
                ]
            },
            {
                action: "delete",
                description: "Delete the organization. Refused while it has projects; asks first, --yes skips the prompt",
                flags: [["--org <id>", "The organization. Default: the active one"]]
            },
            {
                action: "members",
                args: "[list]",
                section: "Members",
                description: "List members of the organization, with their email and role",
                flags: [["--org <id>", "The organization. Default: the active one"]]
            },
            {
                action: "members invite",
                args: "<email>",
                section: "Members",
                description: "Invite by email: a 7-day, single-use link they accept. Nobody joins until they do",
                flags: [["--role <role>", "admin or member (default). Never owner: promote them with `members role` once they have joined"]]
            },
            {
                action: "members remove",
                args: "<email|uid>",
                section: "Members",
                description: "Remove a member. Asks first; --yes skips the prompt"
            },
            {
                action: "members role",
                args: "<email|uid> <role>",
                section: "Members",
                description: "Change a member's role: owner, admin or member. Asks first; --yes skips the prompt"
            },
            {
                action: "invites",
                args: "[list]",
                section: "Invitations",
                description: "Pending invitations: email, role, who invited, expiry. Owners and admins only"
            },
            {
                action: "invites revoke",
                args: "<id|email>",
                section: "Invitations",
                description: "Revoke a pending invitation; its link stops working. Asks first; --yes skips the prompt"
            },
            {
                action: "invites resend",
                args: "<id|email>",
                section: "Invitations",
                description: "A new link and seven more days; the old link stops working"
            }
        ],
        notes: [
            "The active one is what `rebase cloud use` selects, and what billing is scoped to.",
            "An organization with projects cannot be deleted: delete each project first, which is what tears down its database and cancels its subscription.",
            "Inviting and invitations take a `rebase cloud login` session, not REBASE_TOKEN, and the owner or admin role.",
            "The invitation link is printed because the control plane may send no email; the output says whether it did. "
                + "Only an account that has verified the invited address can accept it."
        ]
    });
}
