/**
 * `rebase cloud access` — who can reach one project, and their invitations.
 *
 * A person reaches a project two ways. Every member of the organization that
 * owns it does, with a role derived from their organization role (owner and
 * admin are `admin` on every project, a member is `developer`); and anyone can
 * be added to one project alone, as `admin`, `developer` or `viewer`. Their
 * effective role is the higher of the two. It is Firebase's project IAM and
 * Supabase's project-scoped roles: `orgs members` manages the first, this
 * command the second.
 *
 *   admin      everything on the project, its access and settings included
 *   developer  deploy, Studio, logs, environment; no access, billing or delete
 *   viewer     read-only
 *
 * Adding someone opens an invitation, as `orgs members invite` does: a link,
 * valid 7 days, that only an account which has verified that address can
 * accept. Removing someone, or demoting an admin, also takes back the admin
 * role the console's "Open admin panel" gave them inside the app — the control
 * plane asks the app's `POST /auth/platform-revoke`.
 *
 * Calls (all on the control plane, a login session for every change):
 *
 *   GET    project-access/<project>                 the list
 *   PATCH  project-access/<project>/members/<uid>   { role } — change a project role
 *   DELETE project-access/<project>/members/<uid>   remove a project role
 *   POST   invites { scope: "project", projectId, email, role }
 *   GET    invites/project/<project>                pending invitations
 *   DELETE invites/<id>, POST invites/<id>/resend   as for an organization
 *
 * A control plane that does not serve them answers `not_served`.
 */
import chalk from "chalk";
import {
    colorStatus,
    confirmDestructive,
    displayProjectRef,
    emit,
    fail,
    note,
    parseCloudArgs,
    printGroupHelp,
    requireClient,
    requireProject,
    requireSessionClient,
    success,
    type CloudClient
} from "./context";
import { reportCallError, type Unserved } from "./not-served";
import { reportDelivery, type CliInvite, type EmailDelivery } from "./orgs";

/** The roles a person can hold on one project. */
export const PROJECT_ROLES = ["admin", "developer", "viewer"] as const;
export type ProjectRole = typeof PROJECT_ROLES[number];

export const ACCESS_ACTIONS = ["list", "invite", "role", "remove", "invites"] as const;
const INVITES_ACTIONS = ["list", "revoke", "resend"] as const;

/** Someone who can reach the project, as `GET project-access/<project>` lists them. */
export interface ProjectAccessRow {
    userId: string;
    email: string | null;
    /** The effective role: the higher of the organization's and the project's. */
    role: ProjectRole;
    /** Their organization role, when they are a member of the organization that owns the project. */
    organizationRole: "owner" | "admin" | "member" | null;
    /** The role this project gives them on its own, when it gives one. */
    projectRole: ProjectRole | null;
}

const ACCESS_UNSERVED: Unserved = {
    what: "project access",
    hint: "Nothing was changed. `rebase cloud orgs members` manages who reaches every project of an organization."
};

const PROJECT_INVITES_UNSERVED: Unserved = {
    what: "project invitations",
    hint: "Nothing was sent or changed. `rebase cloud orgs members invite` invites someone to the whole organization."
};

const isRole = (value: string): value is ProjectRole => (PROJECT_ROLES as readonly string[]).includes(value);

export async function accessCommand(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parseCloudArgs({
        spec: { "--role": String },
        rawArgs,
        commandWords: 2, // cloud access
        command: "cloud access",
        maxPositionals: 3
    });
    const [action = "list", ...rest] = positionals;
    if (!(ACCESS_ACTIONS as readonly string[]).includes(action)) {
        fail(`Unknown access command: ${action}`, `Run \`rebase cloud access --help\`. Actions: ${ACCESS_ACTIONS.join(", ")}.`, "unknown_command");
    }
    if (flags["--role"] !== undefined && action !== "invite") {
        fail("--role belongs to `access invite`.", "To change a role: `rebase cloud access role <email|uid> <role>`.", "usage");
    }
    if (action === "invites") return invitesCommand(rawArgs, rest, Boolean(flags["--yes"]));

    const expected = action === "list" ? 0 : action === "role" ? 2 : 1;
    if (rest.length > expected) {
        fail(`Too many arguments for \`access ${action}\`: ${rest.slice(expected).join(" ")}`, "Run `rebase cloud access --help`.", "usage");
    }
    const role = action === "role" ? rest[1] : flags["--role"] ?? "developer";
    if ((action === "role" || action === "invite") && role !== undefined && !isRole(role)) {
        fail(`"${role}" is not a project role.`, "A project role is admin, developer or viewer.", "usage");
    }

    switch (action) {
        case "list":
            return listAccess(rawArgs);
        case "invite":
            return invite(rawArgs, rest[0], role as ProjectRole);
        case "role":
            return changeRole(rawArgs, rest[0], role as ProjectRole | undefined, Boolean(flags["--yes"]));
        case "remove":
            return remove(rawArgs, rest[0], Boolean(flags["--yes"]));
    }
}

async function loadAccess(client: CloudClient, project: string): Promise<{ members: ProjectAccessRow[]; canManage: boolean }> {
    try {
        return await client.functions.invoke<{ members: ProjectAccessRow[]; canManage: boolean }>(
            "project-access", undefined, { method: "GET", path: encodeURIComponent(project) }
        );
    } catch (e) {
        reportCallError(e, "Failed to list who can reach the project", ACCESS_UNSERVED);
    }
}

/** The person `ref` names — a user id or an email — or a refusal. */
function pickPerson(members: ProjectAccessRow[], ref: string | undefined, action: string): ProjectAccessRow {
    if (!ref) fail(`Name the person to ${action}.`, `Pass their email or user id: \`rebase cloud access ${action} <email|uid>\`.`, "usage");
    const wanted = ref.trim().toLowerCase();
    const match = members.find((m) => m.userId === ref || (m.email ?? "").toLowerCase() === wanted);
    if (!match) fail(`${ref} cannot reach this project.`, "Run `rebase cloud access` to see who can.", "not_found");
    return match;
}

function reach(m: ProjectAccessRow): string {
    if (m.organizationRole && m.projectRole) return `org ${m.organizationRole} + project ${m.projectRole}`;
    if (m.organizationRole) return `org ${m.organizationRole}`;
    return "this project only";
}

async function listAccess(rawArgs: string[]): Promise<void> {
    const { client } = await requireClient(rawArgs);
    const project = await requireProject(rawArgs, client);
    const { members, canManage } = await loadAccess(client, project);
    emit(
        () => {
            console.log("");
            console.log(chalk.bold(`  🔑 Access — ${displayProjectRef(rawArgs) || project}`));
            console.log("");
            if (members.length === 0) {
                console.log(chalk.gray("  Nobody yet."));
            }
            for (const m of members) {
                console.log(`  ${chalk.bold(m.email ?? m.userId)}  ${colorStatus(m.role)}  ${chalk.gray(reach(m))}`);
            }
            console.log("");
            if (canManage) {
                note(chalk.gray("Add someone: `rebase cloud access invite <email> --role admin|developer|viewer`."));
                console.log("");
            }
        },
        { project, members, canManage }
    );
}

async function invite(rawArgs: string[], email: string | undefined, role: ProjectRole): Promise<void> {
    if (!email) fail("Name the address to invite.", "`rebase cloud access invite <email> [--role admin|developer|viewer]`.", "usage");
    const address = email.trim().toLowerCase();
    const { client } = await requireSessionClient(rawArgs, "invite people to a project");
    const project = await requireProject(rawArgs, client);
    type Result =
        | { kind: "added"; userId: string; role: ProjectRole; email: string }
        | { kind: "invited"; invite: CliInvite; link: string; emailDelivery: EmailDelivery };
    let result: Result;
    try {
        result = await client.functions.invoke<Result>("invites", { scope: "project", projectId: project, email: address, role });
    } catch (e) {
        reportCallError(e, `Failed to invite ${address}`, PROJECT_INVITES_UNSERVED);
    }
    if (result.kind === "added") {
        emit(() => success(`${result.email} can now reach the project as ${result.role}`), { project, ...result });
        return;
    }
    const invited = result;
    emit(
        () => {
            success(`Invitation sent to ${invited.invite.email} as ${invited.invite.role} on this project — they get access when they accept; the link works once, until ${invited.invite.expiresAt.slice(0, 10)}`);
            console.log("");
            console.log(`  ${chalk.cyan(invited.link)}`);
            console.log("");
            note(chalk.gray("Only an account that has verified that address can accept it."));
        },
        { project, ...invited }
    );
    reportDelivery(invited.emailDelivery, invited.invite.email);
}

async function changeRole(rawArgs: string[], ref: string | undefined, role: ProjectRole | undefined, yes: boolean): Promise<void> {
    if (!ref || !role) fail("Name the person and the role.", "`rebase cloud access role <email|uid> <admin|developer|viewer>`.", "usage");
    const { client } = await requireSessionClient(rawArgs, "change who can reach a project");
    const project = await requireProject(rawArgs, client);
    const { members } = await loadAccess(client, project);
    const target = pickPerson(members, ref, "role");
    const who = target.email ?? target.userId;
    if (target.projectRole === role) {
        emit(() => success(`${who} already has ${role} on this project`), { project, userId: target.userId, email: target.email, role, changed: false });
        return;
    }
    const losesAdmin = target.role === "admin" && role !== "admin" && target.organizationRole !== "owner" && target.organizationRole !== "admin";
    await confirmDestructive({
        yes,
        prompt: `Give ${who} ${role} on this project (now ${target.role}, ${reach(target)})?`
            + (losesAdmin ? " An admin role the console's Open admin panel gave them in the app is taken back, and their app sessions end." : "")
    });
    let changed: { member: ProjectAccessRow };
    try {
        changed = await client.functions.invoke<{ member: ProjectAccessRow }>(
            "project-access", { role },
            { method: "PATCH", path: `${encodeURIComponent(project)}/members/${encodeURIComponent(target.userId)}` }
        );
    } catch (e) {
        reportCallError(e, `Failed to change ${who}'s role`, ACCESS_UNSERVED);
    }
    emit(
        () => {
            success(`${who} has ${role} on this project; their effective role is ${changed.member.role}`);
            if (changed.member.role !== role) {
                note(chalk.gray(`Their organization role (${target.organizationRole}) gives more; change it with \`rebase cloud orgs members role\`.`));
            }
        },
        { project, member: changed.member, previousRole: target.role, changed: true }
    );
}

async function remove(rawArgs: string[], ref: string | undefined, yes: boolean): Promise<void> {
    if (!ref) pickPerson([], ref, "remove");
    const { client } = await requireSessionClient(rawArgs, "change who can reach a project");
    const project = await requireProject(rawArgs, client);
    const { members } = await loadAccess(client, project);
    const target = pickPerson(members, ref, "remove");
    const who = target.email ?? target.userId;
    if (!target.projectRole) {
        fail(
            `${who} reaches this project as an organization ${target.organizationRole ?? "member"}, not through the project.`,
            "Remove them from the organization with `rebase cloud orgs members remove`, which takes every project away.",
            "usage"
        );
    }
    await confirmDestructive({
        yes,
        prompt: `Remove ${who}'s ${target.projectRole} role on this project?`
            + (target.organizationRole ? ` They keep what their organization role (${target.organizationRole}) gives.` : " They lose access to it.")
            + " An admin role the console's Open admin panel gave them in the app is taken back, and their app sessions end."
    });
    let removed: Record<string, unknown>;
    try {
        removed = await client.functions.invoke<Record<string, unknown>>(
            "project-access", undefined,
            { method: "DELETE", path: `${encodeURIComponent(project)}/members/${encodeURIComponent(target.userId)}` }
        );
    } catch (e) {
        reportCallError(e, `Failed to remove ${who}`, ACCESS_UNSERVED);
    }
    // What the control plane answered (whether the app's admin was taken back,
    // say), with this command's own account of whom it removed on top.
    emit(() => success(`Removed ${who}'s ${target.projectRole} role on this project`), {
        ...removed, project, removed: { userId: target.userId, email: target.email, projectRole: target.projectRole }
    });
}

async function loadInvites(client: CloudClient, project: string): Promise<CliInvite[]> {
    try {
        return (await client.functions.invoke<{ invites: CliInvite[] }>(
            "invites", undefined, { method: "GET", path: `project/${encodeURIComponent(project)}` }
        )).invites;
    } catch (e) {
        if ((e as { status?: number } | null)?.status === 403) {
            fail("Only the project's admins can see its pending invitations.", "`rebase cloud access` lists who they are.", "forbidden");
        }
        reportCallError(e, "Failed to list the project's invitations", PROJECT_INVITES_UNSERVED);
    }
}

function pickInvite(invites: CliInvite[], ref: string | undefined, action: string): CliInvite {
    if (!ref) fail(`Name the invitation to ${action}.`, `Pass its id or email: \`rebase cloud access invites ${action} <id|email>\`.`, "usage");
    const wanted = ref.trim().toLowerCase();
    const match = invites.find((i) => i.id === ref || i.email === wanted);
    if (!match) fail(`No pending invitation to this project for ${ref}.`, "Run `rebase cloud access invites` to see the pending ones.", "not_found");
    return match;
}

async function invitesCommand(rawArgs: string[], words: string[], yes: boolean): Promise<void> {
    const [action = "list", ref, ...extra] = words;
    if (!(INVITES_ACTIONS as readonly string[]).includes(action)) {
        fail(`Unknown access invites command: ${action}`, `Run \`rebase cloud access --help\`. Actions: ${INVITES_ACTIONS.join(", ")}.`, "unknown_command");
    }
    if (extra.length > 0 || (action === "list" && ref !== undefined)) {
        fail(`Too many arguments for \`access invites ${action}\`: ${[...(action === "list" ? [ref] : []), ...extra].join(" ")}`, "Run `rebase cloud access --help`.", "usage");
    }
    if (action !== "list" && !ref) pickInvite([], ref, action);

    const { client } = await requireSessionClient(rawArgs, "manage invitations");
    const project = await requireProject(rawArgs, client);
    const invites = await loadInvites(client, project);

    if (action === "list") {
        emit(
            () => {
                console.log("");
                console.log(chalk.bold(`  ✉️  Pending invitations — ${displayProjectRef(rawArgs) || project}`));
                console.log("");
                if (invites.length === 0) console.log(chalk.gray("  No pending invitations."));
                for (const i of invites) {
                    const when = i.expired ? chalk.yellow("expired") : chalk.gray(`expires ${i.expiresAt.slice(0, 10)}`);
                    console.log(`  ${chalk.bold(i.email)}  ${colorStatus(i.role)}  ${when}  ${chalk.gray(`by ${i.invitedBy.email ?? "?"}  [${i.id}]`)}`);
                }
                console.log("");
            },
            { project, invites }
        );
        return;
    }

    const target = pickInvite(invites, ref, action);
    if (action === "revoke") {
        await confirmDestructive({ yes, prompt: `Revoke the invitation for ${target.email} (${target.role})? Its link stops working.` });
        try {
            await client.functions.invoke("invites", undefined, { method: "DELETE", path: encodeURIComponent(target.id) });
        } catch (e) {
            reportCallError(e, `Failed to revoke the invitation for ${target.email}`, PROJECT_INVITES_UNSERVED);
        }
        emit(() => success(`Revoked the invitation for ${target.email}; its link no longer works`), { project, revoked: target });
        return;
    }

    let resent: { invite: CliInvite; link: string; emailDelivery: EmailDelivery };
    try {
        resent = await client.functions.invoke<{ invite: CliInvite; link: string; emailDelivery: EmailDelivery }>(
            "invites", {}, { path: `${encodeURIComponent(target.id)}/resend` }
        );
    } catch (e) {
        reportCallError(e, `Failed to resend the invitation for ${target.email}`, PROJECT_INVITES_UNSERVED);
    }
    emit(
        () => {
            success(`New link for ${resent.invite.email}, valid until ${resent.invite.expiresAt.slice(0, 10)}; the old one no longer works`);
            console.log("");
            console.log(`  ${chalk.cyan(resent.link)}`);
            console.log("");
        },
        { project, ...resent }
    );
    reportDelivery(resent.emailDelivery, resent.invite.email);
}

export function printAccessHelp(): void {
    printGroupHelp({
        command: "cloud access",
        title: "Who can reach a project",
        actions: [
            {
                action: "list",
                description: "Everyone who can reach the project: email, effective role, and whether it comes from the organization or the project"
            },
            {
                action: "invite",
                args: "<email>",
                description: "Invite someone to this project alone. They get access when they accept a 7-day, single-use link",
                flags: [["--role <role>", "admin, developer (default) or viewer"]]
            },
            {
                action: "role",
                args: "<email|uid> <role>",
                description: "Set the role this project gives someone: admin, developer or viewer. Asks first; --yes skips the prompt"
            },
            {
                action: "remove",
                args: "<email|uid>",
                description: "Remove the role this project gives someone. Asks first; --yes skips the prompt"
            },
            {
                action: "invites",
                args: "[list]",
                section: "Invitations",
                description: "Pending invitations to this project: email, role, who invited, expiry. Project admins only"
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
            "An organization's owners and admins are admin on every project it owns, and its members developer. A role given "
                + "here adds to that; someone's effective role is the higher of the two. `rebase cloud orgs members` manages the organization's.",
            "admin: everything, access and settings included. developer: deploy, Studio, logs, environment. viewer: read-only.",
            "Losing admin on a project also takes back the admin role the console's \"Open admin panel\" gave that person inside the app, and ends their sessions there.",
            "Every change takes a `rebase cloud login` session, not REBASE_TOKEN, and admin on the project."
        ]
    });
}
