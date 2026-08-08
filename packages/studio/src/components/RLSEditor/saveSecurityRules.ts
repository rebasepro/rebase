/**
 * Write a collection's security rules to its source file.
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
export async function saveSecurityRulesToCodebase(options: {
    apiBase: string;
    collectionId: string;
    securityRules: unknown[];
    getAuthToken?: () => Promise<string | null | undefined>;
}): Promise<void> {
    const { apiBase, collectionId, securityRules, getAuthToken } = options;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = getAuthToken ? await getAuthToken() : null;
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const response = await fetch(`${apiBase}/schema-editor/collection/save`, {
        method: "POST",
        headers,
        // Only the rules change here. `partial` says so: read as a
        // whole-collection save, a payload of one key deletes everything it does
        // not mention.
        body: JSON.stringify({ collectionId,
collectionData: { securityRules },
partial: true })
    });

    if (response.ok) return;

    const body = await response.text().catch(() => "");
    let message: string | undefined;
    try {
        const parsed = JSON.parse(body) as { error?: { message?: string }, message?: string };
        message = parsed.error?.message ?? parsed.message;
    } catch {
        message = body.trim() || undefined;
    }
    throw new Error(message ?? `Failed to save policy (HTTP ${response.status}).`);
}
