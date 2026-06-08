import React, { useState } from "react";
import { LoginView } from "@rebasepro/core";
import { Checkbox, cls, Typography } from "@rebasepro/ui";
import type { RebaseAuthController } from "@rebasepro/auth";

const DEMO_EMAIL = "demo@rebase.pro";
const DEMO_PASSWORD = "DemoRebase2026!";

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
            additionalComponent={
                <div className="flex flex-col gap-3 mt-2">
                    {/* Demo info */}
                    <div className={cls(
                        "rounded-lg px-4 py-3 text-sm",
                        "bg-surface-100 text-surface-600 dark:bg-surface-900 dark:text-surface-300"
                    )}>
                        No account needed — demo credentials are pre-filled. Just click <strong>Sign in with email</strong>.
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
