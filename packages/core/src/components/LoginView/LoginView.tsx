import React, { ReactNode, useEffect, useRef, useState } from "react";

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
import { AuthControllerExtended, User } from "@rebasepro/types";
import { ErrorView } from "../ErrorView";
import { RebaseLogo } from "../RebaseLogo";
import { LanguageToggle } from "../LanguageToggle";
import { useModeController, useTranslation } from "../../hooks";

/**
 * Props for the generic LoginView.
 * Consumes {@link AuthControllerExtended} — works with any backend
 * (Rebase custom backend, Firebase, Supabase, etc.)
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
}

type AuthMode = "buttons" | "login" | "register" | "forgot";

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
    additionalComponent
}: LoginViewProps) {

    const modeState = useModeController();
    const { mode: colorMode, setMode: setColorMode } = modeState;
    const { t } = useTranslation();

    const [mode, setMode] = useState<AuthMode>("buttons");
    const [fadeIn, setFadeIn] = useState(false);
    const [viewVisible, setViewVisible] = useState(true);

    const switchMode = (newMode: AuthMode) => {
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
    const hasGoogleLogin = googleClientId && (caps.enabledProviders?.includes("google") ?? caps.googleLogin ?? false);
    const hasGitHubLogin = githubClientId && (caps.enabledProviders?.includes("github") ?? false);
    const hasLinkedinLogin = linkedinClientId && (caps.enabledProviders?.includes("linkedin") ?? false);
    const hasPasswordReset = caps.passwordReset ?? !!authController.forgotPassword;

    const showRegistration = !disableSignupScreen && canRegister;

    useEffect(() => {
        const timer = setTimeout(() => setFadeIn(true), 50);
        return () => clearTimeout(timer);
    }, []);

    // Effect to handle incoming redirect OAuth codes (GitHub, LinkedIn, etc.)
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        const provider = localStorage.getItem("rebase_oauth_provider");
        if (code && provider) {
            localStorage.removeItem("rebase_oauth_provider");
            // Clear URL search params without page reload
            const cleanUrl = window.location.origin + window.location.pathname;
            window.history.replaceState({}, document.title, cleanUrl);
            
            if (authController.oauthLogin) {
                authController.oauthLogin(provider, {
                    code,
                    redirectUri: cleanUrl
                }).catch((err) => {
                    console.error(`${provider} login failed:`, err);
                });
            }
        }
    }, [authController]);

    function buildErrorView() {
        if (!authController.authProviderError) return null;
        if (authController.user != null) return null;
        const errorMsg = authController.authProviderError instanceof Error
            ? authController.authProviderError.message
            : String(authController.authProviderError);
        return (
            <div className="w-full">
                <ErrorView error={errorMsg}/>
            </div>
        );
    }

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
                "relative flex items-center justify-center h-screen w-screen p-4 transition-opacity duration-500 bg-surface-50 dark:bg-surface-950 overflow-hidden",
                fadeIn ? "opacity-100" : "opacity-0"
            )}>

            {/* Glowing background blobs */}
            <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary-500/10 blur-[120px] pointer-events-none" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-500/10 blur-[120px] pointer-events-none" />

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

            <div className="relative flex flex-col items-center w-[440px] max-w-full p-8 sm:p-10 bg-white/70 dark:bg-surface-900/60 backdrop-blur-xl border border-surface-200/50 dark:border-surface-800/50 rounded-2xl shadow-2xl z-10 transition-all duration-300 hover:shadow-primary-500/5">
                {/* Logo */}
                <div className="w-24 h-24 m-2 mb-4 drop-shadow-md">
                    {logoComponent}
                </div>

                {notAllowedMessage && (
                    <div className="p-4 w-full">
                        <ErrorView error={notAllowedMessage}/>
                    </div>
                )}

                {mode !== "forgot" && buildErrorView()}

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
                            noUserComponent={noUserComponent}
                            disableSignupScreen={false}
                            bootstrapMode={true}
                        />
                    )}

                    {/* Normal mode */}
                    {!isBootstrapMode && (
                        <>
                            {/* Provider buttons screen */}
                            {mode === "buttons" && (
                                <div className="w-full flex flex-col gap-3 mt-2">
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

                {additionalComponent && (
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
    authController
}: {
    disabled?: boolean,
    googleClientId: string,
    authController: AuthControllerExtended
}) {
    const codeClientRef = useRef<{ requestCode(): void } | null>(null);

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
                    return;
                }
                try {
                    // Send the authorization code to the backend.
                    // redirectUri "postmessage" is required when using popup ux_mode.
                    await authController.googleLogin!({
                        code: response.code,
                        redirectUri: "postmessage"
                    });
                } catch (err: unknown) {
                    console.error("Google login error:", err);
                }
            }
        });
    }, [googleClientId, authController]);

    const handleClick = () => {
        if (!codeClientRef.current) {
            console.error("Google Sign-In not loaded");
            return;
        }
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
        localStorage.setItem("rebase_oauth_provider", "github");
        const redirectUri = encodeURIComponent(window.location.origin + window.location.pathname);
        const scope = "read:user,user:email";
        window.location.href = `https://github.com/login/oauth/authorize?client_id=${githubClientId}&redirect_uri=${redirectUri}&scope=${scope}`;
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
        localStorage.setItem("rebase_oauth_provider", "linkedin");
        const redirectUri = encodeURIComponent(window.location.origin + window.location.pathname);
        const scope = "openid profile email";
        window.location.href = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${linkedinClientId}&redirect_uri=${redirectUri}&scope=${scope}`;
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
    switchToLogin
}: {
    onClose: () => void,
    onForgotPassword?: () => void,
    authController: AuthControllerExtended,
    registrationMode: boolean,
    noUserComponent?: ReactNode,
    disableSignupScreen: boolean,
    bootstrapMode?: boolean,
    switchToRegister?: () => void,
    switchToLogin?: () => void
}) {
    const passwordRef = useRef<HTMLInputElement | null>(null);

    const [email, setEmail] = useState<string>();
    const [password, setPassword] = useState<string>();
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

    function handleEnterPassword() {
        if (email && password && authController.emailPasswordLogin) {
            authController.emailPasswordLogin(email, password);
        }
    }

    function handleRegistration() {
        if (email && password && authController.register) {
            authController.register(email, password, displayName);
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

            <Typography variant="h6" className="mb-0.5">
                {title}
            </Typography>
            <Typography variant="body2" color="secondary" className="mb-5">
                {subtitle}
            </Typography>

            {registrationMode && noUserComponent && (
                <div className="w-full mb-2">
                    {noUserComponent}
                </div>
            )}

            {registrationMode && (
                <div className="w-full mb-3">
                    <Typography variant="label" color="secondary" className="mb-1">
                        Display Name
                    </Typography>
                    <TextField placeholder="Jane Doe (optional)"
                        className="w-full"
                        value={displayName ?? ""}
                        disabled={authController.initialLoading}
                        type="text"
                        size="medium"
                        onChange={(event) => setDisplayName(event.target.value)}/>
                </div>
            )}

            <div className="w-full mb-3">
                <Typography variant="label" color="secondary" className="mb-1">
                    Email
                </Typography>
                <TextField placeholder="you@example.com"
                    className="w-full"
                    autoFocus
                    value={email ?? ""}
                    disabled={authController.initialLoading}
                    type="email"
                    size="medium"
                    onChange={(event) => setEmail(event.target.value)}/>
            </div>

            <div className="w-full mb-1">
                <Typography variant="label" color="secondary" className="mb-1">
                    Password
                </Typography>
                <TextField placeholder="••••••••"
                    className="w-full"
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

                <div className="text-center rounded-xl p-6 bg-surface-50 dark:bg-surface-950">
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
                <Typography variant="label" color="secondary" className="mb-1">
                    Email
                </Typography>
                <TextField
                    placeholder="you@example.com"
                    className="w-full"
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
