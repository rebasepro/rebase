import React, { ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";

/** Google Identity Services SDK — injected by the GIS <script> tag. */
declare global {
    interface Window {
        google?: {
            accounts: {
                oauth2: {
                    initCodeClient(config: {
                        client_id: string;
                        scope: string;
                        ux_mode: "popup" | "redirect";
                        callback: (response: { code?: string; error?: string }) => void;
                    }): { requestCode(): void };
                };
            };
        };
    }
}

import {
    ArrowLeftIcon,
    Button,
    Checkbox,
    cls,
    IconButton,
    iconSize,
    LoadingButton,
    MailIcon,
    Menu,
    MenuItem,
    MoonIcon,
    SunIcon,
    SunMoonIcon,
    TextField,
    Typography
} from "@rebasepro/ui";
import { User } from "@rebasepro/types";
import { AuthControllerExtended } from "@rebasepro/admin-types";
import { ErrorView } from "../ErrorView";
import { RebaseLogo } from "../RebaseLogo";
import { LanguageToggle } from "../LanguageToggle";
import { useModeController, useTranslation } from "../../hooks";
import { consumeOAuthCallback, startOAuthRedirect } from "./oauth-redirect-flow";

/**
 * Props for the generic LoginView.
 * Consumes {@link AuthControllerExtended} — works with any backend
 * (Rebase custom backend, Firebase, etc.)
 */
export interface LoginViewProps {
    /**
     * Auth controller — must implement AuthControllerExtended.
     */
    authController: AuthControllerExtended;

    /**
     * Path to the logo displayed in the login screen
     */
    logo?: string;

    /**
     * Enable the skip login button
     */
    allowSkipLogin?: boolean;

    /**
     * Disable the login buttons
     */
    disabled?: boolean;

    /**
     * Prevent users from creating new accounts.
     * If not set, checks `authController.capabilities.registration`.
     */
    disableSignupScreen?: boolean;

    /**
     * Display this component when no user is found
     */
    noUserComponent?: ReactNode;

    /**
     * Display this component below the sign-in buttons
     */
    additionalComponent?: ReactNode;

    /**
     * Display this component above the sign-in buttons
     */
    topComponent?: ReactNode;

    /**
     * Error message when user is not allowed access
     */
    notAllowedError?: string | Error;


    /**
     * Google client ID for Google OAuth.
     * Required when Google login is enabled via ID token flow.
     */
    googleClientId?: string;

    /**
     * GitHub client ID for GitHub OAuth.
     */
    githubClientId?: string;

    /**
     * LinkedIn client ID for LinkedIn OAuth.
     */
    linkedinClientId?: string;

    /**
     * Optional custom title shown above options
     */
    title?: string;

    /**
     * Optional custom subtitle shown above options
     */
    subtitle?: string;

    /**
     * When true, shows bootstrap/setup UI (first-user creation).
     * If not set, derived from `authController` if it exposes `needsSetup`.
     */
    needsSetup?: boolean;

    /**
     * Whether registration is enabled.
     * If not set, derived from `authController.capabilities.registration`.
     */
    registrationEnabled?: boolean;

    /**
     * Pre-fill the email field (e.g. for demo or testing environments).
     */
    defaultEmail?: string;

    /**
     * Pre-fill the password field (e.g. for demo or testing environments).
     */
    defaultPassword?: string;

    /**
     * When set, a "Join the newsletter" opt-in checkbox is offered. Called with
     * the address that just authenticated — by any method — if the box was
     * ticked. Wire it to whatever stores the subscription; failures are the
     * callback's problem, the login flow never waits on it.
     *
     * The checkbox sits on the **provider screen**, beside the buttons that
     * choose how to sign in, rather than on the credentials form. It is a
     * decision about the visitor, not about the password: asking on the
     * credentials form put it in front of only the people who got that far by
     * typing an address, so anyone signing in with Google was never offered it
     * at all. Bootstrap mode is the exception — there is no provider screen
     * there, so the form keeps it.
     */
    onNewsletterOptIn?: (email: string) => void;
}

type AuthMode = "buttons" | "login" | "register" | "forgot";

/**
 * The shared field background mixin (`dark:bg-black/30`) is invisible on the
 * near-black login card, so login inputs get an explicit border in dark mode.
 */
const loginFieldClasses = "w-full dark:border dark:border-surface-700/70 dark:hover:border-surface-600";

/** One warning per provider per page load — this is a config hint, not a log stream. */
const warnedProviders = new Set<string>();

/**
 * An OAuth button needs a client id in the frontend *and* the provider
 * configured on the backend. Half a configuration renders nothing at all, with
 * no error anywhere — the button simply is not there, which reads as "the
 * feature broke" rather than "one env var is missing". Say which half is
 * missing instead.
 */
function warnAboutHalfConfiguredOAuth(
    provider: string,
    clientId: string | undefined,
    backendProviders: string[]
) {
    const backendHasIt = backendProviders.includes(provider);
    if (Boolean(clientId) === backendHasIt) return; // both or neither — nothing to say
    if (warnedProviders.has(provider)) return;
    warnedProviders.add(provider);

    const envVar = `${provider.toUpperCase()}_CLIENT_ID`;
    console.warn(
        clientId
            ? `[Rebase] ${provider} login is hidden: the login view has a client id, but the backend reports no "${provider}" provider. `
              + `Set ${envVar} (and ${provider.toUpperCase()}_CLIENT_SECRET) on the server and restart it.`
            : `[Rebase] ${provider} login is hidden: the backend has a "${provider}" provider, but the login view was given no client id. `
              + `Pass it to the login view (e.g. VITE_${envVar}) and restart the frontend so the new env var is picked up.`
    );
}

/**
 * Whether a provider's error code means "the visitor backed out" rather than
 * "the sign-in failed". Closing the popup is an answer, not a fault, and
 * showing it in red reads as a broken login.
 */
function isUserCancellation(code: string | undefined): boolean {
    if (!code) return false;
    return [
        "access_denied",
        "popup_closed",
        "popup_closed_by_user",
        "user_cancel",
        "immediate_failed"
    ].includes(code);
}

/**
 * Generic login view component that works with any AuthControllerExtended.
 * Feature-detects capabilities to show/hide login methods.
 * @group Core
 */
export function LoginView({
    logo,
    authController,
    noUserComponent,
    disableSignupScreen = false,
    disabled = false,
    notAllowedError,
    googleClientId,
    githubClientId,
    linkedinClientId,
    title,
    subtitle,
    needsSetup,
    registrationEnabled,
    additionalComponent,
    topComponent,
    defaultEmail,
    defaultPassword,
    onNewsletterOptIn
}: LoginViewProps) {

    const modeState = useModeController();
    const { mode: colorMode, setMode: setColorMode } = modeState;
    const { t } = useTranslation();

    const [mode, setMode] = useState<AuthMode>("buttons");
    const [fadeIn, setFadeIn] = useState(false);
    const [viewVisible, setViewVisible] = useState(true);
    // Failures that never reach the auth controller: a provider that answers the
    // popup with an error, a redirect whose `state` does not match, a Google
    // script that never loaded. The controller records everything it is *given*
    // in `authProviderError`, so it cannot speak for the half of the flow that
    // happens before the code reaches it.
    const [providerError, setProviderError] = useState<string | null>(null);
    // Lives here, not in LoginForm: the box is ticked on the provider screen
    // and read after a sign-in that happens one or two screens later, so it has
    // to outlive both. The form also unmounts on every login↔register switch.
    const [newsletterOptIn, setNewsletterOptIn] = useState(false);

    // The controller as of the latest render. A provider callback resolves long
    // after the click that started it, and the `authController` captured in that
    // closure is the one from the render that mounted the button — which, for a
    // controller replaced on each render, has no `user` on it yet.
    const authControllerRef = useRef(authController);
    authControllerRef.current = authController;

    /**
     * Subscribe the address that just authenticated, if the visitor asked for
     * it. Every sign-in path calls this, which is the point: the checkbox sits
     * beside the provider buttons, so it has to mean the same thing whichever
     * one is pressed.
     *
     * Only ever from a resolution path — a ticked box on a *failed* attempt
     * must not subscribe an address nobody proved they control.
     */
    const subscribeIfOptedIn = useCallback((email?: string | null) => {
        if (!newsletterOptIn || !onNewsletterOptIn || !email) return;
        onNewsletterOptIn(email);
    }, [newsletterOptIn, onNewsletterOptIn]);

    const switchMode = (newMode: AuthMode) => {
        // A message about the last Google attempt has nothing to say about the
        // email form the visitor just opened.
        setProviderError(null);
        setViewVisible(false);
        setTimeout(() => {
            setMode(newMode);
            setViewVisible(true);
        }, 150);
    };

    // Resolve capabilities — explicit props override authController.capabilities
    const caps = authController.capabilities ?? {};
    const isBootstrapMode = needsSetup
        ?? ("needsSetup" in authController && !!(authController as { needsSetup?: boolean }).needsSetup)
        ?? false;
    const canRegister = registrationEnabled ?? caps.registration ?? false;
    // Every OAuth button needs BOTH halves: a client id here and the matching
    // provider configured on the backend. `enabledProviders` is always an array
    // (the controller defaults it to `[]`), so a missing entry means "the
    // backend has no such provider" — never "unknown". A client id on its own
    // shows nothing, which is silent enough that `warnAboutHalfConfiguredOAuth`
    // below says so out loud.
    const backendProviders = caps.enabledProviders ?? [];
    const hasGoogleLogin = Boolean(googleClientId) && backendProviders.includes("google");
    const hasGitHubLogin = githubClientId && backendProviders.includes("github");
    const hasLinkedinLogin = linkedinClientId && backendProviders.includes("linkedin");

    useEffect(() => {
        // `enabledProviders` is empty until /auth/config lands, which looks
        // exactly like "the backend has no providers" — so wait for the value
        // to settle. A config that arrives late re-runs this effect and cancels
        // the pending warning.
        const timer = setTimeout(() => {
            warnAboutHalfConfiguredOAuth("google", googleClientId, backendProviders);
            warnAboutHalfConfiguredOAuth("github", githubClientId, backendProviders);
            warnAboutHalfConfiguredOAuth("linkedin", linkedinClientId, backendProviders);
        }, 3000);
        return () => clearTimeout(timer);
    }, [googleClientId, githubClientId, linkedinClientId, backendProviders.join(",")]);
    const hasPasswordReset = caps.passwordReset ?? !!authController.forgotPassword;

    const showRegistration = !disableSignupScreen && canRegister;

    useEffect(() => {
        const timer = setTimeout(() => setFadeIn(true), 50);
        return () => clearTimeout(timer);
    }, []);

    // Effect to handle incoming redirect OAuth codes (GitHub, LinkedIn, etc.).
    //
    // The `code` is only spent when it belongs to an authorization this browser
    // started: `consumeOAuthCallback` matches the returned `state` against the
    // one generated at button-click time. Without that, an attacker who starts
    // their own authorization, captures the code and gets the victim to load
    // `?code=<theirs>` hands the victim a session on the *attacker's* account.
    useEffect(() => {
        const result = consumeOAuthCallback(window.location.search);
        if (result.status === "none") return;

        // Clear URL search params without page reload
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);

        if (result.status === "error") {
            console.error(`OAuth sign-in failed: ${result.error}`);
            if (!isUserCancellation(result.error)) {
                setProviderError(`Sign-in failed: ${result.error}`);
            }
            return;
        }
        if (result.status === "mismatch") {
            console.error("Ignoring an OAuth code that does not match a sign-in this browser started.");
            setProviderError("This sign-in could not be verified as one you started in this browser. Please try again.");
            return;
        }

        if (authController.oauthLogin) {
            // The rejection is recorded in `authProviderError`, which the screen
            // renders — the catch is here so a shown error does not also surface
            // as an unhandled rejection.
            authController.oauthLogin(result.provider, {
                code: result.code,
                redirectUri: result.redirectUri,
                ...(result.codeVerifier ? { codeVerifier: result.codeVerifier } : {})
            }).catch((err: unknown) => {
                console.error(`${result.provider} login failed:`, err);
            });
        }
    }, [authController]);



    let logoComponent;
    if (logo) {
        logoComponent = <img src={logo}
            style={{
                height: "100%",
                width: "100%",
                objectFit: "cover"
            }}
            alt={"Logo"}/>;
    } else {
        logoComponent = <RebaseLogo/>;
    }

    // The controller's own record of the last rejected sign-in, ignored once a
    // user is present — a stale failure must not sit over a screen that has
    // since succeeded. `LoginForm` renders the same value for the email path.
    const controllerError = authController.authProviderError && !authController.user
        ? (authController.authProviderError instanceof Error
            ? authController.authProviderError.message
            : String(authController.authProviderError))
        : null;
    const buttonsErrorMessage = providerError ?? controllerError;

    let notAllowedMessage: string | undefined;
    if (notAllowedError) {
        if (typeof notAllowedError === "string") {
            notAllowedMessage = notAllowedError;
        } else if (notAllowedError instanceof Error) {
            notAllowedMessage = notAllowedError.message;
        } else {
            notAllowedMessage = "It looks like you don't have access, based on the specified access configuration";
        }
    }

    return (
        <div
            className={cls(
                "relative flex items-center justify-center h-screen w-screen p-4 transition-opacity duration-500 bg-surface-50 dark:bg-surface-900 overflow-hidden",
                fadeIn ? "opacity-100" : "opacity-0"
            )}>

            {/* Top-right controls */}
            <div className="absolute top-4 right-4 flex items-center gap-1 z-10">
                <LanguageToggle/>
                <Menu
                    trigger={<IconButton
                        color="inherit"
                        aria-label="Toggle theme">
                        {colorMode === "dark"
                            ? <MoonIcon size={iconSize.small}/>
                            : <SunIcon size={iconSize.small}/>}
                    </IconButton>}>
                    <MenuItem onClick={() => setColorMode("dark")}><MoonIcon size={iconSize.smallest}/> {t("dark_mode")}</MenuItem>
                    <MenuItem onClick={() => setColorMode("light")}><SunIcon size={iconSize.smallest}/> {t("light_mode")}</MenuItem>
                    <MenuItem onClick={() => setColorMode("system")}><SunMoonIcon size={iconSize.smallest}/> {t("system_mode")}</MenuItem>
                </Menu>
            </div>

            <div className="relative flex flex-col items-center w-[440px] max-w-full p-8 sm:p-10 bg-white/70 dark:bg-surface-800/70 backdrop-blur-xl border border-surface-200/50 dark:border-surface-700/50 rounded-2xl shadow-2xl z-10 transition-all duration-300 hover:shadow-primary-500/5">
                {/* Logo */}
                <div className="w-24 h-24 m-2 mb-4 drop-shadow-md">
                    {logoComponent}
                </div>

                {notAllowedMessage && (
                    <div className="p-4 w-full">
                        <ErrorView error={notAllowedMessage}/>
                    </div>
                )}

                <div className={cls(
                    "w-full transition-opacity duration-150",
                    viewVisible ? "opacity-100" : "opacity-0"
                )}>

                    {/* Bootstrap mode: show setup form directly */}
                    {isBootstrapMode && !authController.user && (
                        <LoginForm
                            authController={authController}
                            registrationMode={true}
                            onClose={() => {}}
                            onForgotPassword={() => {}}
                            disableSignupScreen={false}
                            bootstrapMode={true}
                            defaultEmail={defaultEmail}
                            defaultPassword={defaultPassword}
                            onSignedIn={subscribeIfOptedIn}
                            newsletterOptIn={newsletterOptIn}
                            setNewsletterOptIn={setNewsletterOptIn}
                            showNewsletterOptIn={Boolean(onNewsletterOptIn)}
                        />
                    )}

                    {/* Normal mode */}
                    {!isBootstrapMode && (
                        <>
                            {/* Provider buttons screen */}
                            {mode === "buttons" && (
                                <div className="w-full flex flex-col gap-3 mt-2">
                                    {/* Every provider button fails here, and this
                                        screen used to render nothing for it: a
                                        refused Google sign-in closed the popup
                                        and returned the visitor to an unchanged
                                        login screen, with the reason only in the
                                        browser console. */}
                                    {buttonsErrorMessage && (
                                        <ErrorView error={buttonsErrorMessage}/>
                                    )}
                                    {(title || subtitle) && (
                                        <div className="text-center mb-2">
                                            {title && (
                                                <Typography variant="h6" className="mb-0.5 font-bold">
                                                    {title}
                                                </Typography>
                                            )}
                                            {subtitle && (
                                                <Typography variant="body2" color="secondary" className="mb-4">
                                                    {subtitle}
                                                </Typography>
                                            )}
                                        </div>
                                    )}
                                    {topComponent && (
                                        <div className="w-full">
                                            {topComponent}
                                        </div>
                                    )}
                                    {/* Above the buttons, not below them: it is a
                                        condition on the sign-in you are about to
                                        make, and it reads as one more line of the
                                        consent block a host puts in
                                        `topComponent` — the demo's privacy tick
                                        sits directly above it.

                                        Which is why it pulls back most of the
                                        column's `gap-3`: at the full gap the two
                                        ticks sat 24px apart and read as two
                                        unrelated questions rather than one
                                        consent block. The offset is against this
                                        column's own gap, not against whatever
                                        margins the host's `topComponent` happens
                                        to carry, so it lands the same way under
                                        any of them — but only when there is
                                        something above to hug. With no header
                                        and no `topComponent` this row is the
                                        column's first child, and pulling back a
                                        gap that is not there would crowd it into
                                        the logo. */}
                                    {onNewsletterOptIn && (
                                        <label className={cls(
                                            "flex items-center gap-2 cursor-pointer",
                                            (topComponent || title || subtitle) && "-mt-3"
                                        )}>
                                            <Checkbox
                                                checked={newsletterOptIn}
                                                onCheckedChange={(checked) => setNewsletterOptIn(checked === true)}
                                                size="small"
                                            />
                                            <Typography variant="caption" color="secondary" className="select-none">
                                                {t("join_newsletter")}
                                            </Typography>
                                        </label>
                                    )}
                                    <LoginButton
                                        disabled={disabled}
                                        text={"Sign in with email"}
                                        icon={<MailIcon/>}
                                        onClick={() => switchMode("login")}
                                    />
                                    {hasGoogleLogin && googleClientId && (
                                        <GoogleLoginButton
                                            disabled={disabled}
                                            googleClientId={googleClientId}
                                            authController={authController}
                                            onSignedIn={() => subscribeIfOptedIn(authControllerRef.current.user?.email)}
                                            onError={setProviderError}
                                        />
                                    )}
                                    {hasGitHubLogin && githubClientId && (
                                        <GitHubLoginButton
                                            disabled={disabled}
                                            githubClientId={githubClientId}
                                        />
                                    )}
                                    {hasLinkedinLogin && linkedinClientId && (
                                        <LinkedInLoginButton
                                            disabled={disabled}
                                            linkedinClientId={linkedinClientId}
                                        />
                                    )}
                                    {showRegistration && (
                                        <div className="mt-2 text-center">
                                            <Typography variant="body2" color="secondary">
                                                Don&apos;t have an account?{" "}
                                                <button
                                                    type="button"
                                                    className="font-semibold hover:underline cursor-pointer text-primary-600 dark:text-primary-400"
                                                    onClick={() => switchMode("register")}
                                                >
                                                    Create one
                                                </button>
                                            </Typography>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Login form */}
                            {mode === "login" && (
                                <LoginForm
                                    authController={authController}
                                    registrationMode={false}
                                    onClose={() => switchMode("buttons")}
                                    onForgotPassword={hasPasswordReset ? () => switchMode("forgot") : undefined}
                                    noUserComponent={noUserComponent}
                                    disableSignupScreen={disableSignupScreen}
                                    switchToRegister={showRegistration ? () => switchMode("register") : undefined}
                                    defaultEmail={defaultEmail}
                                    defaultPassword={defaultPassword}
                                    onSignedIn={subscribeIfOptedIn}
                                />
                            )}

                            {/* Registration form */}
                            {mode === "register" && (
                                <LoginForm
                                    authController={authController}
                                    registrationMode={true}
                                    onClose={() => switchMode("buttons")}
                                    onForgotPassword={hasPasswordReset ? () => switchMode("forgot") : undefined}
                                    noUserComponent={noUserComponent}
                                    disableSignupScreen={disableSignupScreen}
                                    switchToLogin={() => switchMode("login")}
                                    defaultEmail={defaultEmail}
                                    defaultPassword={defaultPassword}
                                    onSignedIn={subscribeIfOptedIn}
                                />
                            )}

                            {/* Forgot password form */}
                            {mode === "forgot" && authController.forgotPassword && (
                                <ForgotPasswordForm
                                    authController={authController}
                                    onClose={() => switchMode("login")}
                                />
                            )}
                        </>
                    )}
                </div>

                {additionalComponent && !isBootstrapMode && mode === "buttons" && (
                    <div className="w-full">
                        {additionalComponent}
                    </div>
                )}
            </div>
        </div>
    );
}

function LoginButton({
    icon,
    onClick,
    text,
    disabled
}: { icon: React.ReactNode, onClick: () => void, text: string, disabled?: boolean }) {
    return (
        <Button
            disabled={disabled}
            className="w-full transition-transform duration-200 active:scale-[0.98]"
            variant="outlined"
            size="large"
            onClick={onClick}>
            <div className="flex items-center justify-center w-full gap-3 py-1">
                <span className="flex items-center justify-center w-5 h-5">
                    {icon}
                </span>
                <Typography variant="button">{text}</Typography>
            </div>
        </Button>
    );
}

const GoogleIcon = () => (
    <svg viewBox="0 0 24 24" width="20" height="20">
        <path fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
        <path fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
);

function GoogleLoginButton({
    disabled,
    googleClientId,
    authController,
    onSignedIn,
    onError
}: {
    disabled?: boolean,
    googleClientId: string,
    authController: AuthControllerExtended,
    /** Called once the controller has accepted the provider's code. */
    onSignedIn?: () => void,
    /**
     * Reports a failure the auth controller never saw — Google answering the
     * popup with an error, or its script never having loaded. A rejected
     * `googleLogin` is not reported here: the controller already records it.
     */
    onError?: (message: string | null) => void
}) {
    const codeClientRef = useRef<{ requestCode(): void } | null>(null);
    // The code client is built once and its callback closes over this render's
    // props forever. A ref keeps the callback reaching the *current* handler
    // rather than the one that existed when Google's script happened to load.
    const onSignedInRef = useRef(onSignedIn);
    onSignedInRef.current = onSignedIn;
    const onErrorRef = useRef(onError);
    onErrorRef.current = onError;

    useEffect(() => {
        if (!authController.googleLogin) return;

        const google = window.google;
        if (!google || codeClientRef.current) return;

        codeClientRef.current = google.accounts.oauth2.initCodeClient({
            client_id: googleClientId,
            scope: "openid email profile",
            ux_mode: "popup",
            callback: async (response: { code?: string; error?: string }) => {
                if (response.error || !response.code) {
                    console.error("Google login error:", response.error);
                    if (!isUserCancellation(response.error)) {
                        onErrorRef.current?.(
                            response.error
                                ? `Google sign-in failed: ${response.error}`
                                : "Google sign-in failed. Please try again."
                        );
                    }
                    return;
                }
                onErrorRef.current?.(null);
                try {
                    // Send the authorization code to the backend.
                    // redirectUri "postmessage" is required when using popup ux_mode.
                    await authController.googleLogin!({
                        code: response.code,
                        redirectUri: "postmessage"
                    });
                    // After the await, and only on the resolution path: a
                    // newsletter tick must not subscribe an address whose
                    // sign-in the controller rejected.
                    onSignedInRef.current?.();
                } catch (err: unknown) {
                    console.error("Google login error:", err);
                }
            }
        });
    }, [googleClientId, authController]);

    const handleClick = () => {
        if (!codeClientRef.current) {
            console.error("Google Sign-In not loaded");
            onErrorRef.current?.("Google Sign-In could not be loaded. Check your connection or any script blockers, then try again.");
            return;
        }
        onErrorRef.current?.(null);
        codeClientRef.current.requestCode();
    };

    return (
        <LoginButton
            disabled={disabled}
            text="Sign in with Google"
            icon={<GoogleIcon/>}
            onClick={handleClick}
        />
    );
}

const GitHubIcon = () => (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
        <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.579.688.481C19.137 20.162 22 16.418 22 12c0-5.523-4.477-10-10-10z"/>
    </svg>
);

function GitHubLoginButton({
    disabled,
    githubClientId
}: {
    disabled?: boolean,
    githubClientId: string
}) {
    const handleClick = () => {
        // GitHub OAuth Apps do not implement PKCE, so `state` is the whole
        // binding between this click and the code that comes back.
        void startOAuthRedirect({
            provider: "github",
            authorizeUrl: "https://github.com/login/oauth/authorize",
            clientId: githubClientId,
            redirectUri: window.location.origin + window.location.pathname,
            scope: "read:user,user:email"
        });
    };

    return (
        <LoginButton
            disabled={disabled}
            text="Sign in with GitHub"
            icon={<GitHubIcon/>}
            onClick={handleClick}
        />
    );
}

const LinkedInIcon = () => (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
        <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
    </svg>
);

function LinkedInLoginButton({
    disabled,
    linkedinClientId
}: {
    disabled?: boolean,
    linkedinClientId: string
}) {
    const handleClick = () => {
        void startOAuthRedirect({
            provider: "linkedin",
            authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
            clientId: linkedinClientId,
            redirectUri: window.location.origin + window.location.pathname,
            scope: "openid profile email"
        });
    };

    return (
        <LoginButton
            disabled={disabled}
            text="Sign in with LinkedIn"
            icon={<LinkedInIcon/>}
            onClick={handleClick}
        />
    );
}

function LoginForm({
    onClose,
    onForgotPassword,
    authController,
    registrationMode,
    noUserComponent,
    disableSignupScreen,
    bootstrapMode = false,
    switchToRegister,
    switchToLogin,
    defaultEmail,
    defaultPassword,
    onSignedIn,
    newsletterOptIn = false,
    setNewsletterOptIn,
    showNewsletterOptIn = false
}: {
    onClose: () => void,
    onForgotPassword?: () => void,
    authController: AuthControllerExtended,
    registrationMode: boolean,
    noUserComponent?: ReactNode,
    disableSignupScreen: boolean,
    bootstrapMode?: boolean,
    switchToRegister?: () => void,
    switchToLogin?: () => void,
    defaultEmail?: string,
    defaultPassword?: string,
    /** The address the controller just accepted, reported after every success. */
    onSignedIn?: (email: string) => void,
    newsletterOptIn?: boolean,
    setNewsletterOptIn?: (checked: boolean) => void,
    /**
     * Render the newsletter opt-in here. Only bootstrap mode does: everywhere
     * else it lives on the provider screen, which bootstrap mode never shows.
     */
    showNewsletterOptIn?: boolean
}) {
    const passwordRef = useRef<HTMLInputElement | null>(null);
    const { t } = useTranslation();

    // `Typography variant="label"` already renders a real <label> element, it just
    // never pointed at anything, so each field fell back to naming itself after its
    // own placeholder — the password field announced as eight bullets. Associating
    // the existing labels beats passing the kit's `label` prop here: that one moves
    // the text inside the box (`pt-6 pb-2` at this size) and hides the placeholder
    // until focus, which would redesign the login screen to fix a name.
    const emailId = useId();
    const passwordId = useId();
    const displayNameId = useId();

    const [email, setEmail] = useState<string | undefined>(defaultEmail);
    const [password, setPassword] = useState<string | undefined>(defaultPassword);
    const [displayName, setDisplayName] = useState<string>();

    useEffect(() => {
        if (!document) return;
        const escFunction = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                onClose();
            }
        };
        document.addEventListener("keydown", escFunction, false);
        return () => {
            document.removeEventListener("keydown", escFunction, false);
        };
    }, [onClose]);

    // Both controller methods record the failure in `authProviderError` — which
    // this form renders above — and then rethrow for programmatic callers. This
    // is not one of those: without a catch here every rejected sign-in becomes an
    // unhandled rejection, reported as a crash by anything listening for one,
    // while the user has already been shown the error.
    // Fires only on the resolution path, i.e. after the controller accepted
    // the credentials — a ticked box on a failed attempt must not subscribe
    // an address its owner never proved they control.
    function reportSignedIn(email: string) {
        onSignedIn?.(email);
    }

    function handleEnterPassword() {
        if (email && password && authController.emailPasswordLogin) {
            void Promise.resolve(authController.emailPasswordLogin(email, password))
                .then(() => reportSignedIn(email))
                .catch(() => undefined);
        }
    }

    function handleRegistration() {
        if (email && password && authController.register) {
            void Promise.resolve(authController.register(email, password, displayName))
                .then(() => reportSignedIn(email))
                .catch(() => undefined);
        }
    }

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        if (registrationMode)
            handleRegistration();
        else
            handleEnterPassword();
    };

    const title = bootstrapMode
        ? "Welcome!"
        : registrationMode
            ? "Create account"
            : "Sign in";

    const subtitle = bootstrapMode
        ? "Create your admin account to get started. This account will have admin privileges."
        : registrationMode
            ? "Fill in your details to create a new account"
            : "Enter your credentials to continue";

    const buttonLabel = registrationMode ? "Create account" : "Sign in";

    return (
        <form onSubmit={handleSubmit} className="flex flex-col w-full gap-1 mt-2">
            {!bootstrapMode && (
                <div className="w-full mb-2 -ml-2.5">
                    <IconButton onClick={onClose}>
                        <ArrowLeftIcon/>
                    </IconButton>
                </div>
            )}

            {(() => {
                const err = authController.authProviderError;
                if (!err || authController.user) return null;
                const msg: string = err instanceof Error ? err.message : String(err);
                return (
                    <div className="w-full mb-2">
                        <ErrorView error={msg}/>
                    </div>
                );
            })()}

            <Typography variant="h6" className="mb-0.5">
                {title}
            </Typography>
            <Typography variant="body2" color="secondary" className="mb-5">
                {subtitle}
            </Typography>

            {registrationMode && !bootstrapMode && noUserComponent && (
                <div className="w-full mb-2">
                    {noUserComponent}
                </div>
            )}

            {registrationMode && (
                <div className="w-full mb-3">
                    <Typography variant="label" component="label" color="secondary" className="mb-1" htmlFor={displayNameId}>
                        Display Name
                    </Typography>
                    <TextField placeholder="Jane Doe (optional)"
                        id={displayNameId}
                        className={loginFieldClasses}
                        value={displayName ?? ""}
                        disabled={authController.initialLoading}
                        type="text"
                        size="medium"
                        onChange={(event) => setDisplayName(event.target.value)}/>
                </div>
            )}

            <div className="w-full mb-3">
                <Typography variant="label" component="label" color="secondary" className="mb-1" htmlFor={emailId}>
                    Email
                </Typography>
                <TextField placeholder="you@example.com"
                    id={emailId}
                    className={loginFieldClasses}
                    autoFocus
                    value={email ?? ""}
                    disabled={authController.initialLoading}
                    type="email"
                    size="medium"
                    onChange={(event) => setEmail(event.target.value)}/>
            </div>

            <div className="w-full mb-1">
                <Typography variant="label" component="label" color="secondary" className="mb-1" htmlFor={passwordId}>
                    Password
                </Typography>
                <TextField placeholder="••••••••"
                    id={passwordId}
                    className={loginFieldClasses}
                    value={password ?? ""}
                    disabled={authController.initialLoading}
                    inputRef={passwordRef}
                    type="password"
                    size="medium"
                    onChange={(event) => setPassword(event.target.value)}/>
            </div>

            {registrationMode && (
                <Typography variant="caption" color="secondary" className="mb-3">
                    Password must be 8+ characters with uppercase, lowercase, and a number
                </Typography>
            )}

            {!registrationMode && onForgotPassword && (
                <div className="w-full text-right mb-3">
                    <button
                        type="button"
                        className="text-xs font-medium hover:underline cursor-pointer text-primary-600 dark:text-primary-400"
                        onClick={onForgotPassword}
                    >
                        Forgot password?
                    </button>
                </div>
            )}

            {/* Bootstrap mode only — see `showNewsletterOptIn`. Every other
                route to this form came through the provider screen, which is
                where the box now is. */}
            {showNewsletterOptIn && (
                <label className="flex items-center gap-2 cursor-pointer mt-1 mb-1">
                    <Checkbox
                        checked={newsletterOptIn}
                        onCheckedChange={(checked) => setNewsletterOptIn?.(checked === true)}
                        size="small"
                    />
                    <Typography variant="caption" color="secondary" className="select-none">
                        {t("join_newsletter")}
                    </Typography>
                </label>
            )}

            <LoadingButton
                type="submit"
                variant="filled"
                color="primary"
                className="w-full mt-1"
                size="large"
                loading={authController.authLoading}
                disabled={authController.authLoading || !email || !password}
            >
                {buttonLabel}
            </LoadingButton>

            {/* Switch between login/register */}
            {switchToRegister && (
                <div className="mt-4 text-center">
                    <Typography variant="body2" color="secondary">
                        Don&apos;t have an account?{" "}
                        <button
                            type="button"
                            className="font-semibold hover:underline cursor-pointer text-primary-600 dark:text-primary-400"
                            onClick={switchToRegister}
                        >
                            Create one
                        </button>
                    </Typography>
                </div>
            )}

            {switchToLogin && (
                <div className="mt-4 text-center">
                    <Typography variant="body2" color="secondary">
                        Already have an account?{" "}
                        <button
                            type="button"
                            className="font-semibold hover:underline cursor-pointer text-primary-600 dark:text-primary-400"
                            onClick={switchToLogin}
                        >
                            Sign in
                        </button>
                    </Typography>
                </div>
            )}
        </form>
    );
}

function ForgotPasswordForm({
    onClose,
    authController
}: {
    onClose: () => void,
    authController: AuthControllerExtended
}) {
    const [email, setEmail] = useState<string>("");
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const emailId = useId();

    useEffect(() => {
        if (!document) return;
        const escFunction = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                onClose();
            }
        };
        document.addEventListener("keydown", escFunction, false);
        return () => {
            document.removeEventListener("keydown", escFunction, false);
        };
    }, [onClose]);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError(null);

        if (!email) {
            setError("Please enter your email address");
            return;
        }

        if (!authController.forgotPassword) {
            setError("Password reset is not available with this auth provider.");
            return;
        }

        try {
            await authController.forgotPassword(email);
            setSubmitted(true);
        } catch (err: unknown) {
            // Check for EMAIL_NOT_CONFIGURED error
            if (err instanceof Error && (err as { code?: string }).code === "EMAIL_NOT_CONFIGURED") {
                setError("Password reset is not available. Please contact your administrator.");
            } else {
                // Still show success (security: don't reveal if email exists)
                setSubmitted(true);
            }
        }
    };

    if (submitted) {
        return (
            <div className="flex flex-col w-full gap-4 mt-2">
                <div className="w-full -ml-2.5">
                    <IconButton onClick={onClose}>
                        <ArrowLeftIcon/>
                    </IconButton>
                </div>

                <div className="text-center rounded-xl p-6 bg-surface-50 dark:bg-surface-900/60 dark:border dark:border-surface-700/50">
                    <div className="text-3xl mb-3">📧</div>
                    <Typography variant="subtitle1" className="mb-2">
                        Check your email
                    </Typography>
                    <Typography variant="body2" color="secondary">
                        If an account exists for <strong>{email}</strong>, you&apos;ll receive a password reset link shortly.
                    </Typography>
                </div>

                <Button onClick={onClose} variant="text" className="mt-2">
                    Back to sign in
                </Button>
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="flex flex-col w-full gap-1 mt-2">
            <div className="w-full mb-2 -ml-2.5">
                    <IconButton onClick={onClose}>
                        <ArrowLeftIcon/>
                </IconButton>
            </div>

            <Typography variant="h6" className="mb-0.5">
                Reset password
            </Typography>
            <Typography variant="body2" color="secondary" className="mb-5">
                Enter your email and we&apos;ll send you a reset link.
            </Typography>

            {error && (
                <div className="w-full mb-3">
                    <ErrorView error={error}/>
                </div>
            )}

            <div className="w-full mb-3">
                <Typography variant="label" component="label" color="secondary" className="mb-1" htmlFor={emailId}>
                    Email
                </Typography>
                <TextField
                    placeholder="you@example.com"
                    id={emailId}
                    className={loginFieldClasses}
                    autoFocus
                    value={email}
                    type="email"
                    size="medium"
                    onChange={(event) => setEmail(event.target.value)}
                />
            </div>

            <LoadingButton
                type="submit"
                variant="filled"
                className="w-full"
                size="large"
                loading={authController.authLoading}
                disabled={authController.authLoading || !email}
            >
                Send reset link
            </LoadingButton>
        </form>
    );
}
