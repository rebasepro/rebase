/**
 * A real JSON `Response`, as a fetch stand-in answers. A hand-built object
 * cast to `Response` described only the members someone remembered the
 * transport reading; this is the whole thing.
 */
export function jsonResponse(body: unknown, status = 200, statusText?: string): Response {
    return new Response(JSON.stringify(body), {
        status,
        statusText,
        headers: { "Content-Type": "application/json" }
    });
}
