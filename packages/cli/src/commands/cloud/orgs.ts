/**
 * `rebase cloud orgs` — list / create / members.
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
    requireInteractive
} from "./context";

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
        case "members":
            await listMembers(rawArgs);
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
        const orgs = (await client.data.collection("organizations").find({ limit: 100 })).data as unknown as OrgRow[];
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

    const prompts: Array<Record<string, unknown>> = [];
    if (!args["--name"]) {
        requireInteractive("an organization name", "--name <name>");
        prompts.push({ type: "input",
name: "name",
message: "Organization name:" });
    }
    const answers = prompts.length
        ? await inquirer.prompt(prompts as unknown as Parameters<typeof inquirer.prompt>[0])
        : {};

    const name = (args["--name"] || (answers as { name?: string }).name || "").trim();
    if (!name) fail("Organization name is required.", "Pass `--name <name>`.", "input_required");
    const slug = (args["--slug"] || slugify(name)).trim();

    try {
        const created = (await client.data.collection("organizations").create({
            name,
            slug,
            createdAt: new Date().toISOString()
        })) as unknown as OrgRow;
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

async function listMembers(rawArgs: string[]): Promise<void> {
    parseCloudArgs({ spec: {},
rawArgs,
commandWords: 3,
command: "cloud orgs",
maxPositionals: 0 });
    const { client, url } = await requireClient(rawArgs);
    const org = getContextOrg(url);
    if (!org) fail("No active organization.", "Run `rebase cloud use` first.", "no_org");

    try {
        const members = (await client.data.collection("organization-members").find({
            where: { organization: ["==", org] },
            limit: 200
        })).data as unknown as Array<{ id: string | number; userId?: string; role?: string }>;

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
                    console.log(`  ${chalk.bold(m.userId ?? "?")}  ${colorStatus(m.role)}`);
                }
                console.log("");
            },
            {
                org,
                members: members.map((m) => ({
                    id: String(m.id),
                    userId: m.userId ?? null,
                    role: m.role ?? null
                }))
            }
        );
    } catch (e) {
        reportError(e, "Failed to list members");
    }
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
            { action: "members",
description: "List members of the active organization" }
        ],
        notes: ["The active one is what `rebase cloud use` selects, and what billing is scoped to."]
    });
}
