/**
 * Recipe: your own login screen.
 *
 * Any built-in screen can be replaced or wrapped through `<Rebase components>`.
 * The login screen is `"Auth.LoginView"`, and it is handed the auth controller:
 * sign in with `emailPasswordLogin`, and read a failure from
 * `authProviderError`. Once a user is signed in, the admin renders instead.
 *
 * To use it:
 *   <Rebase components={{ "Auth.LoginView": { Component: BrandedLoginView } }} …>
 * Or keep the built-in form and only frame it: `{ Component: …, wrap: true }`
 * hands you the original as `OriginalComponent`.
 */
import React, { useState } from "react";
import type { AuthControllerExtended } from "@rebasepro/cms-types";
import { Button, Card, TextField, Typography } from "@rebasepro/ui";

export function BrandedLoginView({ authController }: { authController: AuthControllerExtended }) {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | undefined>();

    const signIn = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!authController.emailPasswordLogin) {
            setError("Email sign-in is not enabled.");
            return;
        }
        setSubmitting(true);
        setError(undefined);
        try {
            await authController.emailPasswordLogin(email, password);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setSubmitting(false);
        }
    };

    const failure = error ?? (authController.authProviderError ? String(authController.authProviderError) : undefined);

    return (
        <div className={"min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-950 p-4"}>
            <Card className={"w-full max-w-sm p-6"}>
                <form onSubmit={signIn} className={"flex flex-col gap-4"}>
                    <Typography variant={"h5"}>Acme back office</Typography>
                    <TextField label={"Email"} type={"email"} value={email} autoFocus
                        onChange={e => setEmail(e.target.value)}/>
                    <TextField label={"Password"} type={"password"} value={password}
                        onChange={e => setPassword(e.target.value)}/>
                    {failure && <Typography variant={"body2"} color={"error"} role={"alert"}>{failure}</Typography>}
                    <Button type={"submit"} variant={"filled"} disabled={submitting || !email || !password}>
                        Sign in
                    </Button>
                </form>
            </Card>
        </div>
    );
}
