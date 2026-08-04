import React, { useState } from "react";
import { LoginView } from "@rebasepro/app";
import { Checkbox, cls, Typography } from "@rebasepro/ui";
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

/**
 * Thin wrapper around the standard LoginView that pre-fills demo
 * credentials and adds a privacy-policy checkbox + info banner.
 */
export function DemoLoginView({ authController, googleClientId }: DemoLoginViewProps) {
    const [privacyAccepted, setPrivacyAccepted] = useState(false);

    return (
        <LoginView
            authController={authController}
            googleClientId={googleClientId}
            defaultEmail={DEMO_EMAIL}
            defaultPassword={DEMO_PASSWORD}
            disabled={!privacyAccepted}
            onNewsletterOptIn={subscribeToNewsletter}
            topComponent={
                <div className="flex flex-col gap-3 mb-1">
                    {/* Demo info */}
                    <div className={cls(
                        "rounded-lg px-4 py-3 text-sm",
                        "bg-surface-100 text-surface-600 dark:bg-surface-900 dark:text-surface-300"
                    )}>
                        {/* Both steps, in order. This said "Just click Sign in
                            with email" while `disabled={!privacyAccepted}` held
                            the button inert, so the first thing a visitor is
                            told to do did nothing and nothing said why. */}
                        No account needed — demo credentials are pre-filled. Accept the privacy policy below,
                        then click <strong>Sign in with email</strong>.
                    </div>

                    {/* Privacy policy checkbox */}
                    <label className="flex items-center gap-2 cursor-pointer">
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
                                className="underline text-primary-600 dark:text-primary-400"
                            >
                                Privacy Policy
                            </a>
                        </Typography>
                    </label>
                </div>
            }
        />
    );
}
