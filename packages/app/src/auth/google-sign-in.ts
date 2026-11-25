/**
 * Google Identity Services — the script the Google sign-in button's popup runs
 * on — fetched when a Google button mounts.
 */
/** Google Identity Services SDK — loaded by {@link loadGoogleIdentityServices}. */
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

const GOOGLE_IDENTITY_SCRIPT = "https://accounts.google.com/gsi/client";
/** The load in flight or done; cleared on failure so a later call retries. */
let googleIdentityLoad: Promise<void> | null = null;

/**
 * Google's sign-in script, fetched when a Google button mounts.
 *
 * It was a `<script>` in each app's index.html, so every page load — signed-in
 * sessions, which never see this button, included — fetched and ran ~100 kB
 * of Google's code while the app was starting. Now only the login screen pays
 * for it, and an app needs no tag at all (the scaffold never had one, so its
 * Google button had nothing to call). A tag an app still carries is reused.
 */
export function loadGoogleIdentityServices(): Promise<void> {
    if (typeof window === "undefined" || typeof document === "undefined") return Promise.reject(new Error("No document"));
    if (window.google?.accounts) return Promise.resolve();
    if (googleIdentityLoad) return googleIdentityLoad;
    googleIdentityLoad = new Promise<void>((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(`script[src^="${GOOGLE_IDENTITY_SCRIPT}"]`);
        const script = existing ?? document.createElement("script");
        script.addEventListener("load", () => resolve());
        script.addEventListener("error", () => {
            // Blocked or offline: the next mount, or click, tries again.
            googleIdentityLoad = null;
            reject(new Error("Google Identity Services failed to load"));
        });
        if (!existing) {
            script.src = GOOGLE_IDENTITY_SCRIPT;
            script.async = true;
            document.head.appendChild(script);
        }
    });
    return googleIdentityLoad;
}
