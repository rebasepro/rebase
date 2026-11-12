import type { TablePatch } from "@rebasepro/types";

/**
 * Write a table's rule edits to its source file: `{ patches }` to the
 * source-only schema editor (`/admin/schema-editor/apply`).
 *
 * The schema-editor routes sit behind an admin gate that accepts a bearer token
 * and nothing else — there is no cookie fallback — so a request without an
 * `Authorization` header is a 401 every time. The RLS editor's two write paths
 * ("Create policy" on a mapped table, and "Import to codebase") both sent none,
 * and both reported the failure as a constant "Failed to save policy", which is
 * also what a 501 and a parse error looked like.
 *
 * It lives in its own module rather than inline in the component so that the
 * header can be asserted without rendering the whole RLS editor.
 */
export async function postTablePatches(options: {
    apiBase: string;
    patches: TablePatch[];
    getAuthToken?: () => Promise<string | null | undefined>;
}): Promise<void> {
    const { apiBase, patches, getAuthToken } = options;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = getAuthToken ? await getAuthToken() : null;
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const response = await fetch(`${apiBase}/admin/schema-editor/apply`, {
        method: "POST",
        headers,
        // Only the operations: each names the table and the rule it changes,
        // and whatever it does not name stays as written.
        body: JSON.stringify({ patches })
    });

    if (response.ok) return;

    const body = await response.text().catch(() => "");
    let message: string | undefined;
    try {
        const parsed: unknown = JSON.parse(body);
        const error = typeof parsed === "object" && parsed !== null && "error" in parsed ? parsed.error : undefined;
        message = typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
            ? error.message
            : undefined;
    } catch {
        message = body.trim() || undefined;
    }
    throw new Error(message ?? `Failed to save policy (HTTP ${response.status}).`);
}
