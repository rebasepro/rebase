/**
 * `rebase cloud` auth subcommands: login, logout, whoami.
 */
import chalk from "chalk";
import inquirer from "inquirer";
import {
    NO_PASSWORD_HINT,
    askSignInMethod,
    offersBrowserSignIn,
    offersSignInCodes,
    readAuthConfig,
    requireTerminalForCode,
    signInWithBrowser,
    signInWithCode,
    withSecondFactor
} from "./login-flow";
import {
    resolveCloudUrl,
    resolveCloudTarget,
    isKnownControlPlane,
    isJsonMode,
    refuseDirectLink,
    parseCloudArgs,
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
    requireInteractive,
    envToken,
    linkedEphemeralGrant,
    grantProjectOf,
    appKeyExpiryNote,
    projectDotenvSetsAppKey,
    TOKEN_ENV,
    freshAccessToken,
    type CloudClient,
    type EphemeralGrant
} from "./context";
import { capabilitiesInScopes, orgCapabilitiesInScopes } from "./token-capabilities";
import { describeGrants } from "./tokens";

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
    "--code": Boolean,
    "--web": Boolean,
    "--no-browser": Boolean,
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
 * CI should not need a password at all: `rebase cloud tokens create` mints a
 * token narrowed to one project, and `REBASE_TOKEN` hands it to every cloud
 * command. Where a login is still wanted, `REBASE_CLOUD_PASSWORD` is how a
 * secret store hands the password over without it appearing on a command line.
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
    // Strictly, through the family's own parser. `arg(…, { permissive: true })`
    // dropped an undeclared flag on the floor, so `rebase cloud login --emial
    // me@example.com` prompted for an email as though nothing had been typed.
    const { flags: args } = parseCloudArgs({
        spec: LOGIN_FLAGS,
        rawArgs,
        commandWords: 2, // cloud login
        command: "cloud login",
        maxPositionals: 0
    });
    // `login` builds its own client, so it does not pass through
    // `requireClient`'s guard — and it is the one command where getting this
    // wrong sends a password somewhere it should never go.
    refuseDirectLink(rawArgs);
    const { url, source } = resolveCloudTarget(rawArgs);
    if (source === "link" && !isKnownControlPlane(url)) await confirmLinkedControlPlane(url);

    noteBlank();
    note(`Signing in to ${chalk.cyan(url)}`);
    noteBlank();

    if (args["--code"] && passwordOnTheCommandLine(args)) {
        fail("--code and --password are two ways to sign in. Pass one of them.", undefined, "usage");
    }
    if (args["--web"] && (args["--code"] || args["--email"] || passwordOnTheCommandLine(args))) {
        fail("--web signs in through the browser, with no email, password or code. Pass it on its own.", undefined, "usage");
    }

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

    // Which way in. `--web` is the browser; `--code` asks for an emailed
    // code; a password from the flag or the environment is a choice already
    // made. With none of those and no `--email`, the browser — when this
    // control plane offers it — so nobody types an email or a password into a
    // terminal. Otherwise a terminal is asked, and offered a code only when
    // this control plane mails them: accounts made with Google, GitHub or
    // LinkedIn have no password, and the code is their way in there.
    let method: "browser" | "password" | "code" | undefined = args["--web"]
        ? "browser"
        : args["--code"]
            ? "code"
            : (args["--password"] || envPassword) ? "password" : undefined;
    if (method === "code") requireTerminalForCode();

    const client = createCloudClient(url);
    // Read at most once, and only when a choice is left to make.
    let authConfig: Awaited<ReturnType<typeof readAuthConfig>> | undefined;
    const config = async () => (authConfig === undefined ? (authConfig = await readAuthConfig(client.auth)) : authConfig);
    if (method === undefined && !args["--email"] && offersBrowserSignIn(await config())) {
        method = "browser";
    }

    let email = (args["--email"] || envEmail).trim();
    let password = args["--password"] || envPassword;
    if (method !== "browser") {
        // Collect anything missing interactively — but only where a terminal
        // can supply it. Piped, this used to hang on a password prompt.
        if (!email || method === undefined) {
            requireInteractive("credentials", `--email and --password, or ${EMAIL_ENV} and ${PASSWORD_ENV}`);
        }
        if (!email) {
            const answers = await inquirer.prompt([{ type: "input", name: "email", message: "Email:" }]);
            email = String(answers.email ?? "").trim();
        }
        if (!email) fail("An email is required.", undefined, "input_required");

        if (method === undefined) {
            method = offersSignInCodes(await config()) ? await askSignInMethod() : "password";
        }

        if (method === "password" && !password) {
            const answers = await inquirer.prompt([{ type: "password", name: "password", message: "Password:", mask: "•" }]);
            password = String(answers.password ?? "");
        }
        if (method === "password" && !password) {
            fail("Email and password are required.");
        }
    }

    try {
        // An account with 2FA on answers the password and code doors with
        // MFA_REQUIRED; the second factor is asked for here and the sign-in
        // finished with it. The browser asks for it itself.
        const { user } = method === "browser"
            ? await signInWithBrowser(client.auth, { openBrowser: !args["--no-browser"] })
            : await withSecondFactor(client.auth, () => method === "code"
                ? signInWithCode(client.auth, email)
                : client.auth.signInWithEmail(email, password));
        setCurrentContext(url);

        // Convenience: if the account belongs to exactly one org, make it active.
        try {
            const orgs = await client.data.table("organizations").find({ limit: 2 });
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
        if (err?.status === 401 && method === "password") {
            // Most often an account that never had a password: a console
            // sign-up through Google, GitHub or LinkedIn.
            fail("Invalid email or password.", NO_PASSWORD_HINT, "invalid_credentials");
        }
        reportError(e, "Login failed");
    }
}

/**
 * Ask before sending a password to a control plane a repository named.
 *
 * `.rebase/cloud.json` is committed with the code, so a cloned repository can
 * point its cloud commands at any host — and "Not logged in to <host>" invites
 * the login that would hand that host the user's email and password. A host
 * the user has signed in to before, or the platform's own, is theirs; any other
 * one is named and confirmed at a terminal, and refused without one: `--url`
 * is how a script says it means that host.
 */
async function confirmLinkedControlPlane(url: string): Promise<void> {
    const message = `This directory's .rebase/cloud.json names the control plane ${url}, which you have not signed in to before.`;
    if (isJsonMode() || process.stdin.isTTY !== true) {
        fail(
            message,
            `Your email and password would be sent there. To sign in to it on purpose, pass --url ${url}.`,
            "unknown_control_plane"
        );
    }
    warn(message, "Your Rebase Cloud email and password will be sent to it.");
    const { confirmed } = await inquirer.prompt([
        { type: "confirm", name: "confirmed", default: false, message: `Sign in to ${url}?` }
    ]);
    if (!confirmed) {
        console.error(chalk.gray("  Aborted."));
        process.exit(0);
    }
}

export async function logoutCommand(rawArgs: string[]): Promise<void> {
    // Only the globals, but parsed. `rebase cloud logout --frobnicate` exited 0
    // and signed the session out anyway — the one shape of this bug that also
    // destroys something.
    parseCloudArgs({ spec: {},
rawArgs,
commandWords: 2,
command: "cloud logout",
maxPositionals: 0 });
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
    parseCloudArgs({ spec: {},
rawArgs,
commandWords: 2,
command: "cloud whoami",
maxPositionals: 0 });
    const { client, url } = await requireClient(rawArgs);
    // A token is not a session: `/auth/me` takes only a person's login, so the
    // question a token can answer is what it holds.
    // Unless `requireClient` set REBASE_TOKEN aside for the linked project's
    // own token, because it holds nothing on that project.
    if (envToken() && !grantProjectOf(client)) {
        await whoamiToken(client, url);
        return;
    }
    // Nor is the token `rebase cloud init --claim` stored for this directory's
    // project, which `requireClient` picked over the login. Asking `/auth/me`
    // with it used to be refused, and the refusal deleted the token and the
    // only stored copy of the claim link. What it can answer is what it holds,
    // and the claim link a person needs.
    const linked = linkedEphemeralGrant(url);
    if (linked) {
        await whoamiGrant(client, url, linked);
        return;
    }
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

/**
 * `whoami` in a directory linked to a project `rebase cloud init --claim`
 * provisioned: the project's own token, what it may do, the claim URL and
 * when the project expires unless someone claims it.
 */
async function whoamiGrant(
    client: CloudClient,
    url: string,
    linked: { projectId: string; grant: EphemeralGrant }
): Promise<void> {
    let held: string[];
    try {
        ({ held } = await client.personalKeys.listScopes());
    } catch (e) {
        reportError(e, "Failed to read the project token's scopes");
    }
    const grants = capabilitiesInScopes(held).filter(grant => grant.capabilities.length > 0);
    const link = readLink();
    const expires = new Date(linked.grant.expiresAt);
    const appKeyNote = projectDotenvSetsAppKey() ? appKeyExpiryNote(linked.grant.expiresAt) : undefined;
    emit(
        () => {
            console.log("");
            console.log(chalk.bold("  🔐 Unclaimed project token"));
            console.log("");
            keyValues([
                ["Host", url],
                ["Credential", "the token `rebase cloud init --claim` stored (~/.rebase/credentials.json)"],
                ["Project", link ? `${link.projectName ?? ""} (${linked.projectId})`.trim() : linked.projectId],
                ["Can", grants.length ? grants.map(g => g.capabilities.join(", ")).join("; ") : undefined],
                ["Claim URL", chalk.bold(linked.grant.claimUrl)],
                ["Expires", `${expires.toLocaleString()} unless claimed`]
            ]);
            console.log("");
            console.log(chalk.gray("  Open the claim URL and sign in to keep the project. Unclaimed, it is deleted when it expires."));
            if (appKeyNote) console.log(chalk.gray(`  ${appKeyNote}`));
            console.log("");
        },
        {
            host: url,
            credential: "ephemeral",
            projectId: linked.projectId,
            claimUrl: linked.grant.claimUrl,
            expiresAt: linked.grant.expiresAt,
            appKeyNote: appKeyNote ?? null,
            grants,
            scopes: held,
            linkedProject: link
                ? { id: link.projectId, name: link.projectName ?? null, slug: link.slug ?? null }
                : null
        }
    );
}

/** `whoami` under `REBASE_TOKEN`: the host, the token, and what it may do. */
async function whoamiToken(client: CloudClient, url: string): Promise<void> {
    let held: string[];
    try {
        ({ held } = await client.personalKeys.listScopes());
    } catch (e) {
        reportError(e, "Failed to read the token's scopes");
    }
    const grants = capabilitiesInScopes(held).filter(grant => grant.capabilities.length > 0);
    const orgGrants = orgCapabilitiesInScopes(held).filter(grant => grant.capabilities.length > 0);
    const link = readLink();
    emit(
        () => {
            console.log("");
            console.log(chalk.bold("  🔐 Rebase Cloud token"));
            console.log("");
            keyValues([
                ["Host", url],
                ["Credential", TOKEN_ENV],
                ["Can", describeGrants(held)],
                ["Scopes", held.join(", ")],
                [
                    "Linked project",
                    link ? `${link.projectName ?? ""} (${link.projectId})`.trim() : undefined
                ]
            ]);
            console.log("");
        },
        {
            host: url,
            credential: "token",
            grants,
            orgGrants,
            scopes: held,
            linkedProject: link
                ? { id: link.projectId, name: link.projectName ?? null, slug: link.slug ?? null }
                : null
        }
    );
}

/**
 * `rebase cloud access-token` — the bearer this CLI would send right now.
 *
 * For tools that reach the control plane on a person's behalf without a second
 * login: the MCP server reads a project's data through the console's Studio
 * proxy with it, so whoever is signed in to Rebase Cloud reaches every project
 * their organizations hold, and no service key leaves the control plane. It is
 * the same credential `requireClient` resolves — `REBASE_TOKEN`, the token
 * `init --claim` stored for a linked project, or the login, refreshed first when
 * it is close to expiry — so the control plane checks it exactly as it checks
 * this CLI. The token is printed bare, so `$(rebase cloud access-token)` works.
 */
export async function accessTokenCommand(rawArgs: string[]): Promise<void> {
    parseCloudArgs({ spec: {},
rawArgs,
commandWords: 2,
command: "cloud access-token",
maxPositionals: 0 });
    const { client, url } = await requireClient(rawArgs);
    let token: string;
    try {
        token = await freshAccessToken(client);
    } catch {
        fail("The session could not be refreshed.", "Run `rebase cloud login` again.", "session_invalid");
    }
    // A session's token lapses; `REBASE_TOKEN` and a claim token are returned as they are.
    const session = client.auth.getSession();
    const expiresAt = session?.accessToken === token ? session.expiresAt : null;
    emit(
        () => console.log(token),
        { host: url, accessToken: token, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null }
    );
}
