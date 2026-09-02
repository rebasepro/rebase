/**
 * Your Firebase project, from the environment.
 *
 * This file used to carry a real project's configuration — a live web API key,
 * auth domain, database URL and bucket, belonging to a different product
 * entirely. A Firebase web API key is not a secret by design (it identifies the
 * project; the security rules are what protect the data), but shipping a live
 * one inside a public example is still an invitation: anyone who clones this
 * repository can point traffic at that project, spend its quota, and try
 * whatever its rules happen to allow.
 *
 * So the values come from the environment. Copy `.env.example` to `.env` and
 * fill in your own project's config, which the Firebase console gives you under
 * Project settings → Your apps.
 */
const fromEnv = (key: string): string =>
    (import.meta.env as Record<string, string | undefined>)[key] ?? "";

export const firebaseConfig = {
    apiKey: fromEnv("VITE_FIREBASE_API_KEY"),
    authDomain: fromEnv("VITE_FIREBASE_AUTH_DOMAIN"),
    databaseURL: fromEnv("VITE_FIREBASE_DATABASE_URL"),
    projectId: fromEnv("VITE_FIREBASE_PROJECT_ID"),
    storageBucket: fromEnv("VITE_FIREBASE_STORAGE_BUCKET"),
    messagingSenderId: fromEnv("VITE_FIREBASE_MESSAGING_SENDER_ID"),
    appId: fromEnv("VITE_FIREBASE_APP_ID"),
    measurementId: fromEnv("VITE_FIREBASE_MEASUREMENT_ID")
};

/**
 * Whether the example has been pointed at a project at all.
 *
 * Worth checking before rendering: an unconfigured Firebase app fails deep
 * inside the SDK with an error about an invalid API key, which reads as a bug
 * in this example rather than as a missing `.env`.
 */
export const firebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
