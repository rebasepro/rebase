import React, { useState } from "react";
import { LoginView } from "@rebasepro/app";
import { Button, Checkbox, cls, Typography } from "@rebasepro/ui";
import type { RebaseAuthController } from "@rebasepro/app";

const DEMO_EMAIL = "demo@rebase.pro";
const DEMO_PASSWORD = "DemoRebase2026!";

/**
 * Subscriptions are recorded on the Rebase Cloud control plane (same store the
 * console login uses), not on the demo backend — the demo database is wiped
 * routinely. Fire-and-forget: a hiccup here must never surface at login.
 * The shared demo account is filtered out — nearly everyone signs in with the
 * pre-filled credentials, and subscribing demo@rebase.pro would be noise.
 */
function subscribeToNewsletter(email: string) {
    if (email.trim().toLowerCase() === DEMO_EMAIL) return;
    fetch("https://app.rebase.pro/api/functions/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "demo" })
    }).catch(() => undefined);
}

export interface DemoLoginViewProps {
    authController: RebaseAuthController;
    googleClientId?: string;
}

const PRIVACY_POLICY_URL = "https://rebase.pro/policy/privacy_policy/";

function PrivacyPolicyLink() {
    return (
        <a
            href={PRIVACY_POLICY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-primary dark:text-primary-light"
        >
            Privacy Policy
        </a>
    );
}

/**
 * The standard LoginView with a one-click way into the shared demo account on
 * top.
 *
 * "Try the demo" is the primary button on every rebase.pro page, and it used to
 * land here on a form: tick the privacy box, then press "Sign in with email" on
 * pre-filled credentials — two steps before a visitor saw anything. The shared
 * account holds no personal data, so it opens in one click under a notice.
 * Signing in with your own account (email or Google) still takes the explicit
 * privacy tick, because that path records an address.
 */
export function DemoLoginView({ authController, googleClientId }: DemoLoginViewProps) {
    const [privacyAccepted, setPrivacyAccepted] = useState(false);
    const canOpenDemo = Boolean(authController.emailPasswordLogin);

    function openDemo() {
        if (!authController.emailPasswordLogin) return;
        void Promise.resolve(authController.emailPasswordLogin(DEMO_EMAIL, DEMO_PASSWORD))
            .catch(() => undefined);
    }

    return (
        <LoginView
            authController={authController}
            googleClientId={googleClientId}
            // Still pre-filled: the e2e global setup creates the demo account on
            // a fresh database through this form, and signs in through it after.
            defaultEmail={DEMO_EMAIL}
            defaultPassword={DEMO_PASSWORD}
            disabled={!privacyAccepted}
            onNewsletterOptIn={subscribeToNewsletter}
            topComponent={
                <div className="flex flex-col gap-3 mb-1">
                    {canOpenDemo && (
                        <div className="flex flex-col gap-2">
                            <Button
                                variant="filled"
                                color="primary"
                                size="large"
                                fullWidth
                                disabled={authController.authLoading}
                                onClick={openDemo}
                            >
                                Open the demo
                            </Button>
                            <Typography variant="caption" color="secondary" className="text-center">
                                A shared account, reset regularly. Opening it means you accept the{" "}
                                <PrivacyPolicyLink />.
                            </Typography>
                        </div>
                    )}

                    <div className={cls(
                        "rounded-lg px-4 py-3 text-sm",
                        "bg-surface-field text-surface-600 dark:text-surface-300"
                    )}>
                        Or sign in with your own account. Accept the privacy policy first.
                    </div>

                    <label className="flex items-center gap-2 cursor-pointer">
                        <Checkbox
                            checked={privacyAccepted}
                            onCheckedChange={(checked) => setPrivacyAccepted(checked === true)}
                            size="small"
                        />
                        <Typography variant="caption" color="secondary" className="select-none">
                            I accept the <PrivacyPolicyLink />
                        </Typography>
                    </label>
                </div>
            }
        />
    );
}
