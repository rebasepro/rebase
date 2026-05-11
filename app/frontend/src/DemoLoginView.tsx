
import React, { ReactNode, useEffect, useRef, useState } from "react";

import { Button, Checkbox, CircularProgress, cls, IconButton, LoadingButton, Menu, MenuItem, TextField, Typography, iconSize } from "@rebasepro/ui";
import { ArrowLeftIcon, MailIcon, MoonIcon, SunIcon, SunMoonIcon } from "lucide-react";
import { ErrorView, LanguageToggle, RebaseLogo, useModeController, useTranslation } from "@rebasepro/core";

import type { RebaseAuthController } from "@rebasepro/auth";

const DEMO_EMAIL = "demo@rebase.pro";
const DEMO_PASSWORD = "DemoRebase2026!";

/**
 * Props for DemoLoginView
 */
export interface DemoLoginViewProps {
    /**
     * Auth controller from useRebaseAuthController
     */
    authController: RebaseAuthController;

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
     * Prevent users from creating new accounts
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
     * Enable Google login button (requires googleClientId in hook)
     */
    googleEnabled?: boolean;

    /**
     * Google client ID for OAuth
     */
    googleClientId?: string;
}

type AuthMode = "buttons" | "login" | "register" | "forgot";

/**
 * Demo login view — exact same as RebaseLoginView but with pre-populated
 * demo credentials (demo@rebase.pro / demo123456).
 */
export function DemoLoginView({
    logo,
    authController,
    noUserComponent,
    disableSignupScreen = false,
    disabled = false,
    notAllowedError,
    googleEnabled = false,
    googleClientId
}: DemoLoginViewProps) {

    const modeState = useModeController();
    const { mode: colorMode, setMode: setColorMode } = modeState;
    const { t } = useTranslation();

    const [mode, setMode] = useState<AuthMode>("buttons");
    const [fadeIn, setFadeIn] = useState(false);
    const [viewVisible, setViewVisible] = useState(true);
    const [privacyAccepted, setPrivacyAccepted] = useState(false);

    const switchMode = (newMode: AuthMode) => {
        setViewVisible(false);
        setTimeout(() => {
            setMode(newMode);
            setViewVisible(true);
        }, 150);
    };

    // Auto-show setup form when no users exist (bootstrap mode)
    const isBootstrapMode = authController.needsSetup;

    useEffect(() => {
        const timer = setTimeout(() => setFadeIn(true), 50);
        return () => clearTimeout(timer);
    }, []);

    function buildErrorView() {
        if (!authController.authProviderError) return null;
        if (authController.user != null) return null;
        return (
            <div className="w-full">
                <ErrorView error={authController.authProviderError.message ?? authController.authProviderError}/>
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
            notAllowedMessage = "It looks like you don't have access to the CMS, based on the specified Authenticator configuration";
        }
    }

    const showRegistration = !disableSignupScreen && authController.registrationEnabled;

    return (
        <div
            className={cls(
                "relative flex items-center justify-center h-screen w-screen p-4 transition-opacity duration-500 bg-white dark:bg-surface-950",
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

            <div className="flex flex-col items-center w-[480px] max-w-full p-8 sm:p-10">
                {/* Logo */}
                <div className="w-32 h-32 m-2 mb-6">
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
                        <DemoLoginForm
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

                                    {/* Demo info */}
                                    <div className={cls(
                                        "rounded-lg px-4 py-3 text-sm",
                                        "bg-surface-100 text-surface-600 dark:bg-surface-900 dark:text-surface-300"
                                    )}>
                                        No account needed — demo credentials are pre-filled. Just click <strong>Sign in with email</strong>.
                                    </div>

                                    {/* Privacy policy checkbox */}
                                    <label className="flex items-center gap-2 mt-1 cursor-pointer">
                                        <Checkbox
                                            checked={privacyAccepted}
                                            onCheckedChange={(checked) => setPrivacyAccepted(checked === true)}
                                            size="small"
                                        />
                                        <Typography variant="caption" color="secondary" className="select-none">
                                            I accept the{" "}
                                            <a
                                                href="https://rebase.pro/policy/privacy_policy/"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className={cls(
                                                    "underline",
                                                    "text-primary-600 dark:text-primary-400"
                                                )}
                                            >
                                                Privacy Policy
                                            </a>
                                        </Typography>
                                    </label>

                                    <LoginButton
                                        disabled={disabled || !privacyAccepted}
                                        text={"Sign in with email"}
                                        icon={<MailIcon/>}
                                        onClick={() => switchMode("login")}
                                    />
                                    {googleEnabled && googleClientId && (
                                        <GoogleLoginButton
                                            disabled={disabled || !privacyAccepted}
                                            googleClientId={googleClientId}
                                            authController={authController}
                                        />
                                    )}
                                </div>
                            )}

                            {/* Login form */}
                            {mode === "login" && (
                                <DemoLoginForm
                                    authController={authController}
                                    registrationMode={false}
                                    onClose={() => switchMode("buttons")}
                                    onForgotPassword={() => switchMode("forgot")}
                                    noUserComponent={noUserComponent}
                                    disableSignupScreen={disableSignupScreen}
                                    switchToRegister={showRegistration ? () => switchMode("register") : undefined}
                                />
                            )}

                            {/* Registration form */}
                            {mode === "register" && (
                                <DemoLoginForm
                                    authController={authController}
                                    registrationMode={true}
                                    onClose={() => switchMode("buttons")}
                                    onForgotPassword={() => switchMode("forgot")}
                                    noUserComponent={noUserComponent}
                                    disableSignupScreen={disableSignupScreen}
                                    switchToLogin={() => switchMode("login")}
                                />
                            )}

                            {/* Forgot password form */}
                            {mode === "forgot" && (
                                <ForgotPasswordForm
                                    authController={authController}
                                    onClose={() => switchMode("login")}
                                />
                            )}
                        </>
                    )}
                </div>
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
            className="w-full"
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

function GoogleLoginButton({
    disabled,
    googleClientId,
    authController
}: {
    disabled?: boolean,
    googleClientId: string,
    authController: RebaseAuthController
}) {
    const handleGoogleLogin = async () => {
        try {
            const google = (window as unknown as { google?: { accounts: { id: { initialize: (config: { client_id: string; callback: (response: { credential: string }) => void }) => void; prompt: () => void } } } }).google;
            if (!google) {
                console.error("Google Sign-In not loaded");
                return;
            }

            google.accounts.id.initialize({
                client_id: googleClientId,
                callback: async (response: { credential: string }) => {
                    try {
                        await authController.googleLogin(response.credential);
                    } catch (err: unknown) {
                        console.error("Google login error:", err);
                    }
                }
            });

            google.accounts.id.prompt();
        } catch (err: unknown) {
            console.error("Google login error:", err);
        }
    };

    return (
        <Button
            disabled={disabled}
            className="w-full"
            variant="outlined"
            size="large"
            onClick={handleGoogleLogin}>
            <div className="flex items-center justify-center w-full gap-3 py-1">
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
                <Typography variant="button">Continue with Google</Typography>
            </div>
        </Button>
    );
}

/**
 * Same as LoginForm but email and password are pre-populated with demo credentials.
 */
function DemoLoginForm({
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
    onForgotPassword: () => void,
    authController: RebaseAuthController,
    registrationMode: boolean,
    noUserComponent?: ReactNode,
    disableSignupScreen: boolean,
    bootstrapMode?: boolean,
    switchToRegister?: () => void,
    switchToLogin?: () => void
}) {
    const passwordRef = useRef<HTMLInputElement | null>(null);

    // Pre-populated with demo credentials
    const [email, setEmail] = useState<string>(DEMO_EMAIL);
    const [password, setPassword] = useState<string>(DEMO_PASSWORD);
    const [displayName, setDisplayName] = useState<string>();

    useEffect(() => {
        if (!document) return;
        const escFunction = (event: KeyboardEvent) => {
            if (event.keyCode === 27) {
                onClose();
            }
        };
        document.addEventListener("keydown", escFunction, false);
        return () => {
            document.removeEventListener("keydown", escFunction, false);
        };
    }, [onClose]);

    function handleEnterPassword() {
        if (email && password) {
            authController.emailPasswordLogin(email, password);
        }
    }

    function handleRegistration() {
        if (email && password) {
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

            {!registrationMode && (
                <div className="w-full text-right mb-3">
                    <button
                        type="button"
                        className={cls(
                            "text-xs font-medium hover:underline cursor-pointer",
                            "text-primary-600 dark:text-primary-400"
                        )}
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
                            className={cls(
                                "font-semibold hover:underline cursor-pointer",
                                "text-primary-600 dark:text-primary-400"
                            )}
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
                            className={cls(
                                "font-semibold hover:underline cursor-pointer",
                                "text-primary-600 dark:text-primary-400"
                            )}
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
    authController: RebaseAuthController
}) {
    const [email, setEmail] = useState<string>("");
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!document) return;
        const escFunction = (event: KeyboardEvent) => {
            if (event.keyCode === 27) {
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

                <div className={cls(
                    "text-center rounded-xl p-6",
                    "bg-surface-50 dark:bg-surface-950"
                )}>
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
                color="primary"
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
