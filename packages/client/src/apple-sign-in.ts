import { RebaseClientError } from "./errors";

/**
 * The browser half of Sign in with Apple.
 *
 * Apple is the one provider a single-page app cannot take through the usual
 * redirect: asking for the `name` or `email` scope obliges
 * `response_mode=form_post`, so Apple answers with a cross-site POST to the
 * redirect URI — a request a static page never sees. Apple's own JS SDK has a
 * popup mode that hands the answer back to the opening page with
 * `postMessage` instead, and that is what this uses. The redirect URI still
 * has to be listed under the Services ID's Return URLs (HTTPS, no
 * `localhost`), because Apple matches it and the token exchange repeats it.
 *
 * `state` is generated and checked here, which is what binds the code that
 * comes back to the click that started it.
 */

/** Apple's JS SDK, the only way into its popup mode. */
export const APPLE_JS_SDK_URL = "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleauth.js";

/** What `POST /auth/apple` needs from a web sign-in. */
export interface AppleAuthorization {
    code: string;
    redirectUri: string;
    /**
     * Present on the first authorization only — Apple never sends the name
     * again, so it has to reach the backend on this request or not at all.
     */
    user?: { name?: { firstName?: string; lastName?: string } };
}

export interface AppleAuthorizationRequest {
    /** The Services ID. */
    clientId: string;
    /**
     * A Return URL registered on the Services ID. Defaults to this page's
     * origin with a trailing slash (`https://app.example.com/`).
     */
    redirectUri?: string;
}

interface AppleSignInResponse {
    authorization?: { code?: string; id_token?: string; state?: string };
    user?: { email?: string; name?: { firstName?: string; lastName?: string } };
}

interface AppleIdGlobal {
    auth: {
        init(config: {
            clientId: string;
            scope: string;
            redirectURI: string;
            state: string;
            usePopup: boolean;
        }): void;
        signIn(): Promise<AppleSignInResponse>;
    };
}

/** Apple's popup answers with `{ error }` when the visitor backs out. */
const APPLE_CANCELLATIONS = new Set(["popup_closed_by_user", "user_cancelled_authorize"]);

let sdkLoad: Promise<AppleIdGlobal> | null = null;

function appleIdGlobal(): AppleIdGlobal | undefined {
    return (globalThis as { AppleID?: AppleIdGlobal }).AppleID;
}

/**
 * Load Apple's SDK once per page. A failed load is forgotten, so a retry tries
 * again. A tag someone else added and that has not finished yet is not waited
 * on — it may already have failed, and its events would never come — so a
 * second, cached copy is added instead, which is harmless.
 */
function loadAppleSdk(): Promise<AppleIdGlobal> {
    const loaded = appleIdGlobal();
    if (loaded) return Promise.resolve(loaded);
    if (sdkLoad) return sdkLoad;

    sdkLoad = new Promise<AppleIdGlobal>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = APPLE_JS_SDK_URL;
        script.async = true;
        script.onload = () => {
            const apple = appleIdGlobal();
            if (apple) resolve(apple);
            else reject(new Error("Apple's sign-in script loaded without defining AppleID"));
        };
        script.onerror = () => reject(new Error("Apple's sign-in script could not be loaded"));
        document.head.appendChild(script);
    }).catch((err: unknown) => {
        sdkLoad = null;
        throw new RebaseClientError(
            "Sign in with Apple could not be loaded. Check your connection or any script blockers, then try again.",
            { code: "APPLE_SIGN_IN_UNAVAILABLE", cause: err }
        );
    });
    return sdkLoad;
}

/**
 * Start loading Apple's SDK ahead of the click. Worth calling when the sign-in
 * button mounts: with the SDK already on the page, the popup opens in the same
 * task as the click, and Safari blocks a popup that opens later than that.
 */
export async function preloadAppleSignIn(): Promise<void> {
    if (typeof document === "undefined") return;
    await loadAppleSdk();
}

function randomState(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Open Apple's sign-in popup and return the authorization code, without
 * spending it. Call it from a click handler: browsers block a popup that no
 * gesture opened. Call {@link preloadAppleSignIn} first (on mount) so the
 * popup does not wait on a script download.
 *
 * Throws a `RebaseClientError` whose `code` is `APPLE_SIGN_IN_CANCELLED` when
 * the visitor closes the popup or declines, `APPLE_SIGN_IN_UNAVAILABLE` when
 * Apple's script cannot load or this is not a browser, and
 * `APPLE_SIGN_IN_FAILED` otherwise.
 */
export async function requestAppleAuthorization(request: AppleAuthorizationRequest): Promise<AppleAuthorization> {
    if (typeof window === "undefined" || typeof document === "undefined") {
        throw new RebaseClientError(
            "Sign in with Apple's popup needs a browser. A native app gets the code from ASAuthorizationController and passes it to signInWithApple({ code, bundleId }).",
            { code: "APPLE_SIGN_IN_UNAVAILABLE" }
        );
    }

    // No `await` when the SDK is already here: the popup has to open in the
    // task the click started, or Safari's popup blocker eats it.
    const apple = appleIdGlobal() ?? await loadAppleSdk();
    const redirectUri = request.redirectUri ?? `${window.location.origin}/`;
    const state = randomState();
    apple.auth.init({
        clientId: request.clientId,
        scope: "name email",
        redirectURI: redirectUri,
        state,
        usePopup: true
    });

    let response: AppleSignInResponse;
    try {
        response = await apple.auth.signIn();
    } catch (err: unknown) {
        const reason = typeof err === "object" && err !== null && "error" in err && typeof err.error === "string"
            ? err.error
            : undefined;
        if (reason && APPLE_CANCELLATIONS.has(reason)) {
            throw new RebaseClientError("Sign in with Apple was cancelled.", { code: "APPLE_SIGN_IN_CANCELLED" });
        }
        throw new RebaseClientError(
            reason ? `Sign in with Apple failed: ${reason}` : "Sign in with Apple failed. Please try again.",
            { code: "APPLE_SIGN_IN_FAILED", cause: err }
        );
    }

    const authorization = response.authorization;
    if (!authorization?.code) {
        throw new RebaseClientError("Apple returned no authorization code.", { code: "APPLE_SIGN_IN_FAILED" });
    }
    if (authorization.state !== state) {
        throw new RebaseClientError(
            "This Apple sign-in could not be verified as one started on this page. Please try again.",
            { code: "APPLE_SIGN_IN_FAILED" }
        );
    }

    return {
        code: authorization.code,
        redirectUri,
        ...(response.user?.name ? { user: { name: response.user.name } } : {})
    };
}
