/**
 * The steps of `rebase cloud login` that are not a password: signing in
 * through a browser, an emailed sign-in code, and the second factor of an
 * account with 2FA on.
 *
 * ## Why a browser link is the default
 *
 * A person signing in at a terminal should not have to type an email, a
 * password or a code into it, and an account made with Google, GitHub or
 * LinkedIn has no password to type. So when the control plane offers device
 * sign-in (`deviceLogin` in `/auth/config`), `login` asks it for a pending
 * sign-in, prints a link and a short code, opens the browser when it can, and
 * polls until the person approves it on the console — where they are signed in
 * already, or sign in with whatever they use there. This is RFC 8628's device
 * authorization grant, the way `gh auth login --web` works. The code is shown
 * on both screens so the person can check the page is approving this
 * terminal and not someone else's. The second factor is the browser's
 * business: an account with 2FA approves from a session that used it.
 *
 * ## Why a code
 *
 * Every console account made through Google, GitHub or LinkedIn has no
 * password, so a password-only login could never sign it in — it answered
 * "Invalid email or password" to an account that has never had one. The
 * control plane mails a six-digit code (`POST /auth/otp`) when it can send
 * mail; the person types it here. A magic link would open the session in the
 * browser that has the mail, not in this terminal, which is why it is a code.
 *
 * ## Why the second factor is handled on every path
 *
 * The server gates every way of minting a session — password, code, provider —
 * behind the account's verified factors, answering `401 MFA_REQUIRED` with a
 * five-minute token that only the two challenge routes accept. A CLI that does
 * not know that reads the 401 as "wrong password", which for an account with
 * 2FA is both false and a dead end.
 *
 * Both steps need a person at a terminal. Without one they refuse with the
 * route that does not: an access token in `REBASE_TOKEN`.
 */
import os from "os";
import chalk from "chalk";
import inquirer from "inquirer";
import {
    fail,
    isJsonMode,
    note,
    noteBlank,
    openUrl,
    warn,
    TOKEN_ENV,
    type CloudClient
} from "./context";

type CloudAuth = CloudClient["auth"];
type SignedIn = Awaited<ReturnType<CloudAuth["signInWithEmail"]>>;

/** How many codes one login takes before it gives up. The server limits verification per address too. */
export const CODE_ATTEMPTS = 3;

/**
 * The remedy for a step that needs a terminal when there is none: a token,
 * which needs neither a password nor a code. Minted in the console because a
 * person who cannot log in to the CLI cannot run `rebase cloud tokens create`.
 */
export const TOKEN_REMEDY =
    `Create an access token in the console (Settings → Access tokens) and set ${TOKEN_ENV} to it.`;

/** What the password refusal adds, for the accounts that never had a password. */
export const NO_PASSWORD_HINT =
    `Signed up with Google or GitHub? Run \`rebase cloud login --code\`, or ${TOKEN_REMEDY.charAt(0).toLowerCase()}${TOKEN_REMEDY.slice(1)}`;

function atTerminal(): boolean {
    return !isJsonMode() && process.stdin.isTTY === true;
}

function errorCode(error: unknown): unknown {
    return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

function errorStatus(error: unknown): unknown {
    return typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
}

/** A sign-in waiting for its second factor. */
export interface PendingSecondFactor {
    mfaToken: string;
    factors: Array<{ id: string; factorType: string; friendlyName?: string }>;
}

/**
 * The pending sign-in an `MFA_REQUIRED` refusal describes, or `null` for any
 * other error — including one with no token or no factor, which no code step
 * could finish. The same reading the console's login view makes.
 */
export function readMfaRequired(error: unknown): PendingSecondFactor | null {
    if (errorCode(error) !== "MFA_REQUIRED") return null;
    const details = typeof error === "object" && error !== null && "details" in error ? error.details : undefined;
    if (typeof details !== "object" || details === null) return null;
    const mfaToken = "mfaToken" in details ? details.mfaToken : undefined;
    const rawFactors = "factors" in details && Array.isArray(details.factors) ? details.factors : [];
    const factors = rawFactors.flatMap((f: unknown) => {
        if (typeof f !== "object" || f === null) return [];
        const id = "id" in f ? f.id : undefined;
        const factorType = "factorType" in f ? f.factorType : undefined;
        const friendlyName = "friendlyName" in f && typeof f.friendlyName === "string" ? f.friendlyName : undefined;
        return typeof id === "string" && id && typeof factorType === "string"
            ? [{ id, factorType, friendlyName }]
            : [];
    });
    if (typeof mfaToken !== "string" || !mfaToken || factors.length === 0) return null;
    return { mfaToken, factors };
}

type AuthConfig = Awaited<ReturnType<CloudAuth["getAuthConfig"]>>;

/**
 * The control plane's `/auth/config`, or null when it cannot be read. Read
 * once per login: it says both whether codes are mailed and whether device
 * sign-in is offered.
 */
export async function readAuthConfig(auth: CloudAuth): Promise<AuthConfig | null> {
    try {
        return await auth.getAuthConfig();
    } catch {
        return null;
    }
}

/**
 * Whether the control plane mails sign-in codes, as its `/auth/config` says.
 * `false` when it cannot be asked: an older control plane has no such door,
 * and offering one that 404s is worse than not offering it.
 */
export function offersSignInCodes(config: AuthConfig | null): boolean {
    return config?.emailOtp === true;
}

/** Whether the control plane signs a terminal in through a browser, as its `/auth/config` says. */
export function offersBrowserSignIn(config: AuthConfig | null): boolean {
    return config?.deviceLogin === true;
}

/** What the browser sign-in does outside this process. An object so tests can replace it. */
export const BROWSER_SIGN_IN_IO = {
    sleep: (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms)),
    open: (url: string): void => openUrl(url, "Opening")
};

/** What the approval page calls this terminal. */
export function browserSignInClientName(): string {
    let host = "";
    try {
        host = os.hostname().replace(/\.local$/, "");
    } catch {
        // No name to give; the page still shows where the request came from.
    }
    return host ? `Rebase CLI on ${host}` : "Rebase CLI";
}

/** How long to wait after a poll that could not get an answer, at most. */
const MAX_RETRY_INTERVAL_SECONDS = 30;

/**
 * Sign in through a browser: ask for a pending sign-in, show its link and
 * code, open the browser when there is a person at a terminal to look at it,
 * and poll until it is approved, denied or expired.
 *
 * Without a terminal — piped, or `--json` — the link and code still go to
 * stderr and the polling still happens: whoever runs this (an agent, a
 * script with a person nearby) has what to open and is told what it is
 * waiting for.
 */
export async function signInWithBrowser(auth: CloudAuth, options: { openBrowser: boolean }): Promise<SignedIn> {
    let started: Awaited<ReturnType<CloudAuth["startDeviceLogin"]>>;
    try {
        started = await auth.startDeviceLogin({ clientName: browserSignInClientName() });
    } catch (e) {
        if (errorStatus(e) === 404) {
            fail(
                "This control plane does not offer signing in through a browser.",
                "Run `rebase cloud login --email <address>` to sign in with your password or an emailed code.",
                "device_login_unavailable"
            );
        }
        throw e;
    }

    const minutes = Math.max(1, Math.round(started.expiresIn / 60));
    if (isJsonMode()) {
        // `note` is silent in JSON mode, and this is not hand-holding: without
        // the link nobody can approve the sign-in this command waits for.
        process.stderr.write(`To sign in, open ${started.verificationUriComplete}\n`);
        process.stderr.write(`  and check that it shows the code ${started.userCode}.\n`);
        process.stderr.write(`Waiting for the sign-in to be approved in the browser (expires in ${minutes} minutes)...\n`);
    } else {
        noteBlank();
        note(`Your code: ${chalk.bold(started.userCode)}`);
        if (options.openBrowser && atTerminal()) {
            BROWSER_SIGN_IN_IO.open(started.verificationUriComplete);
            note(chalk.gray("If the browser did not open, open the link above yourself."));
        } else {
            noteBlank();
            note(`Open ${chalk.cyan(started.verificationUriComplete)}`);
        }
        note(chalk.gray("Check that the page shows the same code, then approve the sign-in there."));
        noteBlank();
        note(chalk.gray(`Waiting for approval in the browser (expires in ${minutes} minutes, Ctrl-C to cancel)…`));
    }

    const deadline = Date.now() + started.expiresIn * 1000;
    let interval = started.interval;
    let warnedUnreachable = false;
    while (Date.now() < deadline) {
        await BROWSER_SIGN_IN_IO.sleep(interval * 1000);
        let result: Awaited<ReturnType<CloudAuth["pollDeviceLogin"]>>;
        try {
            result = await auth.pollDeviceLogin(started.deviceCode);
        } catch (e) {
            // A rate limit, a blip, a pod rolling over: none of them is an
            // answer about the sign-in, which is still waiting in the browser.
            // Anything the control plane meant — a code already used — is.
            const status = errorStatus(e);
            const transient = typeof status !== "number" || status === 429 || status >= 500;
            if (!transient) throw e;
            if (!warnedUnreachable) {
                warn("Could not reach the control plane to check on the sign-in. Still waiting.");
                warnedUnreachable = true;
            }
            interval = Math.min(interval + 5, MAX_RETRY_INTERVAL_SECONDS);
            continue;
        }
        switch (result.status) {
            case "approved":
                return { user: result.user, accessToken: result.accessToken, refreshToken: result.refreshToken };
            case "pending":
            case "slow_down":
                interval = result.interval;
                break;
            case "denied":
                return fail(
                    "The sign-in was denied in the browser.",
                    "Nothing was signed in. To sign in, run `rebase cloud login` again.",
                    "access_denied"
                );
            case "expired":
                return fail(
                    "The sign-in link expired before it was approved.",
                    "Run `rebase cloud login` again for a new link.",
                    "expired_token"
                );
        }
    }
    fail(
        "The sign-in link expired before it was approved.",
        "Run `rebase cloud login` again for a new link.",
        "expired_token"
    );
}

/** Ask "password or code?" at a terminal. */
export async function askSignInMethod(): Promise<"password" | "code"> {
    const { method } = await inquirer.prompt([{
        type: "list",
        name: "method",
        message: "Sign in with:",
        choices: [
            { name: "Password", value: "password" },
            { name: "Email me a code (for accounts made with Google, GitHub or LinkedIn)", value: "code" }
        ]
    }]);
    return method === "code" ? "code" : "password";
}

/** Refuse a code step with no terminal to type it at. Never returns when there is none. */
export function requireTerminalForCode(): void {
    if (atTerminal()) return;
    fail(
        "A sign-in code is typed at a terminal, and there is none.",
        TOKEN_REMEDY,
        "input_required"
    );
}

/**
 * Mail a code to `email` and trade what the person types for a session.
 *
 * Throws what `verifyEmailOtp` throws for anything but a wrong code —
 * `MFA_REQUIRED` included, which the caller's {@link withSecondFactor} answers.
 */
export async function signInWithCode(auth: CloudAuth, email: string): Promise<SignedIn> {
    requireTerminalForCode();
    try {
        await auth.sendEmailOtp(email);
    } catch (e) {
        const code = errorCode(e);
        if (code === "EMAIL_NOT_CONFIGURED" || errorStatus(e) === 404) {
            fail(
                "This control plane does not send sign-in codes.",
                `Sign in with your password, or: ${TOKEN_REMEDY}`,
                "otp_unavailable"
            );
        }
        throw e;
    }
    // The server answers the same for an address with no account, on purpose:
    // it will not say which addresses are customers. Neither does this.
    note(`If ${email} has a Rebase Cloud account, a 6-digit code is on its way. It expires in 10 minutes.`);

    for (let attempt = 1; attempt <= CODE_ATTEMPTS; attempt++) {
        const { code } = await inquirer.prompt([{
            type: "input",
            name: "code",
            message: "Code from the email:",
            validate: (value: string) => /^\d{6}$/.test(value.replace(/\s+/g, "")) || "The code is six digits."
        }]);
        try {
            return await auth.verifyEmailOtp(email, String(code).replace(/\s+/g, ""));
        } catch (e) {
            if (errorCode(e) !== "INVALID_CODE") throw e;
            if (attempt < CODE_ATTEMPTS) warn("That code is not right, or it has expired.", "Check the newest email and try again.");
        }
    }
    fail(
        "That code was not accepted.",
        "Run `rebase cloud login --code` again for a new one.",
        "invalid_code"
    );
}

/**
 * Run a sign-in, and when the account has 2FA on, ask for the second factor
 * and finish it there.
 */
export async function withSecondFactor(auth: CloudAuth, signIn: () => Promise<SignedIn>): Promise<SignedIn> {
    try {
        return await signIn();
    } catch (e) {
        const pending = readMfaRequired(e);
        if (!pending) throw e;
        return answerSecondFactor(auth, pending);
    }
}

async function answerSecondFactor(auth: CloudAuth, pending: PendingSecondFactor): Promise<SignedIn> {
    if (!atTerminal()) {
        fail(
            "This account has two-factor authentication on, and there is no terminal to ask for the code on.",
            TOKEN_REMEDY,
            "mfa_required"
        );
    }
    note("Two-factor authentication is on for this account.");

    let factorId = pending.factors[0].id;
    if (pending.factors.length > 1) {
        ({ factorId } = await inquirer.prompt([{
            type: "list",
            name: "factorId",
            message: "Verify with:",
            choices: pending.factors.map(f => ({ name: f.friendlyName || f.factorType, value: f.id }))
        }]));
    }

    const options = { mfaToken: pending.mfaToken };
    let challengeId: string | undefined;
    for (let attempt = 1; attempt <= CODE_ATTEMPTS; attempt++) {
        try {
            challengeId ??= (await auth.mfa.challenge(factorId, options)).challengeId;
            const { code } = await inquirer.prompt([{
                type: "input",
                name: "code",
                message: "Code from your authenticator app (or a recovery code):",
                validate: (value: string) => value.trim() !== "" || "Enter the code."
            }]);
            return await auth.mfa.verifyChallenge(challengeId, String(code).replace(/\s+/g, ""), options);
        } catch (e) {
            const code = errorCode(e);
            if (code === "INVALID_CODE") {
                if (attempt < CODE_ATTEMPTS) warn("That code is not right.");
                continue;
            }
            if (code === "CHALLENGE_EXHAUSTED") {
                // The challenge has had its attempts; the next code needs a new one.
                challengeId = undefined;
                continue;
            }
            if (code === "INVALID_CHALLENGE" || code === "SESSION_REVOKED" || errorStatus(e) === 401) {
                // The pending token lasts five minutes from the first factor.
                fail("The sign-in timed out before the second factor was entered.", "Run `rebase cloud login` again.", "mfa_expired");
            }
            throw e;
        }
    }
    fail(
        "The two-factor code was not accepted.",
        "Run `rebase cloud login` again, or use one of your recovery codes.",
        "mfa_failed"
    );
}
