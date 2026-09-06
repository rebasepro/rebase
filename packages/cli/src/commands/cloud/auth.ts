/**
 * `rebase cloud` auth subcommands: login, logout, whoami.
 */
import arg from "arg";
import chalk from "chalk";
import inquirer from "inquirer";
import {
    resolveCloudUrl,
    refuseDirectLink,
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
    warn,
    requireInteractive
} from "./context";

/**
 * Every flag `rebase cloud login` accepts.
 *
 * Hoisted out of the `arg` call so one declaration serves the parser,
 * `action-help.ts`'s page for this command, and the test that holds the two to
 * each other — the same arrangement `DEPLOY_FLAGS` and `CREATE_PROJECT_FLAGS`
 * already use.
 */
export const LOGIN_FLAGS = {
    "--email": String,
    "--password": String,
    "-e": "--email"
} as const;

/**
 * Where credentials may come from, in the order this command prefers them.
 *
 * The environment is the non-interactive route, and it exists so `--password`
 * does not have to be. A password written as an argument is in the shell's
 * history file and in the process table for as long as the command runs, and
 * neither is something this CLI can redact after the fact — the same reasoning
 * `rls-check` states for its connection string, which carries one too.
 *
 * There is no machine token yet, so CI genuinely does need a human's password;
 * `REBASE_CLOUD_PASSWORD` is how a secret store hands it over without it
 * appearing on a command line.
 */
export const PASSWORD_ENV = "REBASE_CLOUD_PASSWORD";
export const EMAIL_ENV = "REBASE_CLOUD_EMAIL";

/**
 * Whether this line put a password in the shell's history.
 *
 * Exported for its test: the warning is the whole feature, so "it warns exactly
 * when the flag was used" is the thing worth pinning.
 */
export function passwordOnTheCommandLine(args: { "--password"?: string }): boolean {
    return typeof args["--password"] === "string" && args["--password"] !== "";
}

export async function loginCommand(rawArgs: string[]): Promise<void> {
    const args = arg(LOGIN_FLAGS, { argv: rawArgs.slice(3),
permissive: true });
    // `login` builds its own client, so it does not pass through
    // `requireClient`'s guard — and it is the one command where getting this
    // wrong sends a password somewhere it should never go.
    refuseDirectLink(rawArgs);
    const url = resolveCloudUrl(rawArgs);

    noteBlank();
    note(`Signing in to ${chalk.cyan(url)}`);
    noteBlank();

    // Once, and before the request: by the time this succeeds the password is
    // already in the history file, and a warning after the fact is advice about
    // something that has happened.
    if (passwordOnTheCommandLine(args)) {
        warn(
            "--password puts your password in your shell history and in the process table.",
            `Prefer the prompt, or pass it as ${PASSWORD_ENV} from a secret store.`
        );
    }

    const envEmail = (process.env[EMAIL_ENV] ?? "").trim();
    const envPassword = process.env[PASSWORD_ENV] ?? "";

    // Collect any missing credentials interactively — but only where a terminal
    // can supply them. Piped, this used to hang on a password prompt.
    const needsEmail = !args["--email"] && !envEmail;
    const needsPassword = !args["--password"] && !envPassword;
    if (needsEmail || needsPassword) {
        requireInteractive("credentials", `--email and --password, or ${EMAIL_ENV} and ${PASSWORD_ENV}`);
    }

    const prompts: Array<Record<string, unknown>> = [];
    if (needsEmail) {
        prompts.push({ type: "input",
name: "email",
message: "Email:" });
    }
    if (needsPassword) {
        prompts.push({ type: "password",
name: "password",
message: "Password:",
mask: "•" });
    }
    const answers = prompts.length
        ? await inquirer.prompt(prompts as unknown as Parameters<typeof inquirer.prompt>[0])
        : {};

    const email = (args["--email"] || envEmail || (answers as { email?: string }).email || "").trim();
    const password = args["--password"] || envPassword || (answers as { password?: string }).password || "";

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
