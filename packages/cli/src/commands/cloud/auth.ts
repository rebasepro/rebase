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
    reportError,
    emit,
    note,
    noteBlank,
    requireInteractive
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

    noteBlank();
    note(`Signing in to ${chalk.cyan(url)}`);
    noteBlank();

    // Collect any missing credentials interactively — but only where a terminal
    // can supply them. Piped, this used to hang on a password prompt.
    if (!args["--email"] || !args["--password"]) {
        requireInteractive("credentials", "--email and --password");
    }

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
        emit(
            () => {
                keyValues([
                    ["Host", url],
                    ["User", user.email ?? undefined],
                    ["Active org", getContextOrg(url)]
                ]);
                console.log("");
            },
            {
                success: true,
                host: url,
                user: user.email ?? null,
                activeOrg: getContextOrg(url) ?? null
            }
        );
    } catch (e) {
        // Auth failures are the common case — give a clean message, not a stack.
        const err = e as { status?: number; message?: string };
        if (err?.status === 401) {
            fail("Invalid email or password.", undefined, "invalid_credentials");
        }
        reportError(e, "Login failed");
    }
}

export async function logoutCommand(rawArgs: string[]): Promise<void> {
    const url = resolveCloudUrl(rawArgs);
    const client = createCloudClient(url);
    if (!client.auth.getSession()) {
        // Not an error: `logout` is idempotent and a script should be able to
        // run it unconditionally. `wasLoggedIn` is how a caller tells the two
        // outcomes apart without reading the prose.
        emit(
            () => {
                console.log("");
                console.log(chalk.gray(`  Not logged in to ${url}.`));
                console.log("");
            },
            { success: true,
host: url,
wasLoggedIn: false }
        );
        return;
    }
    try {
        await client.auth.signOut();
    } catch {
        // signOut clears local state even if the network call fails
    }
    success(`Logged out of ${url}`);
    emit(() => {}, { success: true,
host: url,
wasLoggedIn: true });
}

export async function whoamiCommand(rawArgs: string[]): Promise<void> {
    const { client, url } = await requireClient(rawArgs);
    try {
        const user = await client.auth.getUser();
        if (!user) {
            fail("Session is no longer valid.", "Run `rebase cloud login` again.", "session_invalid");
        }
        const link = readLink();
        emit(
            () => {
                console.log("");
                console.log(chalk.bold("  🔐 Rebase Cloud session"));
                console.log("");
                keyValues([
                    ["Host", url],
                    ["User", user.email ?? undefined],
                    ["User ID", user.uid],
                    ["Roles", user.roles?.length ? user.roles.join(", ") : undefined],
                    ["Active org", getContextOrg(url)],
                    [
                        "Linked project",
                        link ? `${link.projectName ?? ""} (${link.projectId})`.trim() : undefined
                    ]
                ]);
                console.log("");
            },
            {
                host: url,
                user: {
                    email: user.email ?? null,
                    uid: user.uid,
                    roles: user.roles ?? []
                },
                activeOrg: getContextOrg(url) ?? null,
                linkedProject: link
                    ? { id: link.projectId,
name: link.projectName ?? null,
slug: link.slug ?? null }
                    : null
            }
        );
    } catch (e) {
        reportError(e, "Failed to fetch session");
    }
}
