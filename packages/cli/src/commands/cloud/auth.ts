/**
 * `rebase cloud` auth subcommands: login, logout, whoami.
 */
import arg from "arg";
import chalk from "chalk";
import inquirer from "inquirer";
import {
    resolveCloudUrl,
    createCloudClient,
    requireClient,
    setCurrentContext,
    setContextOrg,
    getContextOrg,
    readLink,
    success,
    fail,
    keyValues,
    reportError
} from "./context";

export async function loginCommand(rawArgs: string[]): Promise<void> {
    const args = arg(
        { "--email": String,
"--password": String,
"-e": "--email" },
        { argv: rawArgs.slice(3),
permissive: true }
    );
    const url = resolveCloudUrl(rawArgs);

    console.log("");
    console.log(`  Signing in to ${chalk.cyan(url)}`);
    console.log("");

    // Collect any missing credentials interactively.
    const prompts: Array<Record<string, unknown>> = [];
    if (!args["--email"]) {
        prompts.push({ type: "input",
name: "email",
message: "Email:" });
    }
    if (!args["--password"]) {
        prompts.push({ type: "password",
name: "password",
message: "Password:",
mask: "•" });
    }
    const answers = prompts.length
        ? await inquirer.prompt(prompts as unknown as Parameters<typeof inquirer.prompt>[0])
        : {};

    const email = (args["--email"] || (answers as { email?: string }).email || "").trim();
    const password = args["--password"] || (answers as { password?: string }).password || "";

    if (!email || !password) {
        fail("Email and password are required.");
    }

    const client = createCloudClient(url);
    try {
        const { user } = await client.auth.signInWithEmail(email, password);
        setCurrentContext(url);

        // Convenience: if the account belongs to exactly one org, make it active.
        try {
            const orgs = await client.data.collection("organizations").find({ limit: 2 });
            if (orgs.data.length === 1 && !getContextOrg(url)) {
                setContextOrg(url, String(orgs.data[0].id));
            }
        } catch {
            // non-fatal — org selection is optional
        }

        success(`Logged in as ${chalk.bold(user.email ?? email)}`);
        keyValues([
            ["Host", url],
            ["User", user.email ?? undefined],
            ["Active org", getContextOrg(url)]
        ]);
        console.log("");
    } catch (e) {
        // Auth failures are the common case — give a clean message, not a stack.
        const err = e as { status?: number; message?: string };
        if (err?.status === 401) {
            fail("Invalid email or password.");
        }
        reportError(e, "Login failed");
    }
}

export async function logoutCommand(rawArgs: string[]): Promise<void> {
    const url = resolveCloudUrl(rawArgs);
    const client = createCloudClient(url);
    if (!client.auth.getSession()) {
        console.log("");
        console.log(chalk.gray(`  Not logged in to ${url}.`));
        console.log("");
        return;
    }
    try {
        await client.auth.signOut();
    } catch {
        // signOut clears local state even if the network call fails
    }
    success(`Logged out of ${url}`);
}

export async function whoamiCommand(rawArgs: string[]): Promise<void> {
    const { client, url } = await requireClient(rawArgs);
    try {
        const user = await client.auth.getUser();
        if (!user) fail("Session is no longer valid.", "Run `rebase cloud login` again.");
        const link = readLink();
        console.log("");
        console.log(chalk.bold("  🔐 Rebase Cloud session"));
        console.log("");
        keyValues([
            ["Host", url],
            ["User", user.email ?? undefined],
            ["User ID", user.uid],
            ["Roles", user.roles?.length ? user.roles.join(", ") : undefined],
            ["Active org", getContextOrg(url)],
            ["Linked project", link ? `${link.projectName ?? ""} (${link.projectId})`.trim() : undefined]
        ]);
        console.log("");
    } catch (e) {
        reportError(e, "Failed to fetch session");
    }
}
