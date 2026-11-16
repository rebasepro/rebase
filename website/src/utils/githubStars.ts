/**
 * The repository's star count, read once per build for the header star buttons.
 *
 * Read at build time, not in the browser: the site is static, and a client-side
 * call to api.github.com would be a third-party request on every page view.
 * The count is as fresh as the last deploy.
 *
 * Any failure (offline build, rate limit, a slow API) gives `null`, and the
 * button renders without a number. A build never fails over a star count.
 */

export const REPO_URL = "https://github.com/rebasepro/rebase";
const API_URL = "https://api.github.com/repos/rebasepro/rebase";

let cached: Promise<number | null> | undefined;

async function fetchStars(): Promise<number | null> {
    try {
        const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
        // CI has a token; with it the build cannot hit the anonymous rate limit.
        const token = process.env.GITHUB_TOKEN;
        if (token) headers.Authorization = `Bearer ${token}`;
        const response = await fetch(API_URL, { headers, signal: AbortSignal.timeout(5000) });
        if (!response.ok) return null;
        const body: unknown = await response.json();
        if (body && typeof body === "object" && "stargazers_count" in body && typeof body.stargazers_count === "number") {
            return body.stargazers_count;
        }
        return null;
    } catch {
        return null;
    }
}

/** One request per build, however many pages render a header. */
export function githubStars(): Promise<number | null> {
    cached ??= fetchStars();
    return cached;
}

/** 29 → "29", 1283 → "1.3k". */
export function formatStars(count: number): string {
    if (count < 1000) return String(count);
    return `${(count / 1000).toFixed(count < 10000 ? 1 : 0).replace(/\.0$/, "")}k`;
}
