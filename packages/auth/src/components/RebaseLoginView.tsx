
import React, { ReactNode, useEffect, useRef, useState } from "react";

import { Button, CircularProgress, cls, IconButton, LoadingButton, Menu, MenuItem, TextField, Typography, iconSize } from "@rebasepro/ui";
import { ArrowLeftIcon, MailIcon, MoonIcon, SunIcon, SunMoonIcon } from "lucide-react";
import { ErrorView, LanguageToggle, RebaseLogo, useModeController, useTranslation } from "@rebasepro/core";

import { RebaseAuthController } from "../types";

/**
 * Props for RebaseLoginView
 */
export interface RebaseLoginViewProps {
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
 * Login view component for custom JWT authentication
 */
export function RebaseLoginView({
    logo,
    authController,
    noUserComponent,
    disableSignupScreen = false,
    disabled = false,
    notAllowedError,
    googleEnabled = false,
    googleClientId
}: RebaseLoginViewProps) {

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
                                    <LoginButton
                                        disabled={disabled}
                                        text={"Sign in with email"}
                                        icon={<MailIcon/>}
                                        onClick={() => switchMode("login")}
                                    />
                                    {googleEnabled && googleClientId && (
                                        <GoogleLoginButton
                                            disabled={disabled}
                                            googleClientId={googleClientId}
                                            authController={authController}
                                        />
                                    )}
                                    {showRegistration && (
                                        <div className="mt-2 text-center">
                                            <Typography variant="body2" color="secondary">
                                                Don&apos;t have an account?{" "}
                                                <button
                                                    type="button"
                                                    className={cls(
                                                        "font-semibold hover:underline cursor-pointer",
                                                        "text-primary-600 dark:text-primary-400"
                                                    )}
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
                                    onForgotPassword={() => switchMode("forgot")}
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
    const buttonRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const { mode: colorMode } = useModeController();

    useEffect(() => {
        const google = (window as any).google;
        if (!google) {
            console.error("Google Sign-In not loaded");
            return;
        }

        if (!buttonRef.current || !containerRef.current) return;

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

        const width = containerRef.current.offsetWidth;

        google.accounts.id.renderButton(buttonRef.current, {
            theme: colorMode === "dark" ? "filled_black" : "outline",
            size: "large",
            width: Math.min(width, 400)
        });
    }, [googleClientId, authController, colorMode]);

    return (
        <div 
            ref={containerRef}
            className="w-full flex justify-center" 
            style={{ opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? "none" : "auto" }}
        >
            <div ref={buttonRef} className="w-full [&>div]:w-full flex justify-center" />
        </div>
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

    const [email, setEmail] = useState<string>();
    const [password, setPassword] = useState<string>();
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
