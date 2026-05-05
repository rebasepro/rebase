import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server-core";
import { rebase } from "@rebasepro/server-core";

/**
 * Test function to verify rebase.email works.
 *
 * Call via: POST http://localhost:3001/api/functions/test-email
 * Or:      GET  http://localhost:3001/api/functions/test-email
 */
const app = new Hono<HonoEnv>();

app.all("/", async (c) => {
    try {
        const isConfigured = rebase.email?.isConfigured() ?? false;

        if (!isConfigured) {
            return c.json({ error: "Email not configured" }, 503);
        }

        await rebase.email!.send({
            to: "francesco@firecms.co",
            subject: "Rebase SDK Email Test ✅",
            html: `
                <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 40px;">
                    <h2>Rebase Email Service Test</h2>
                    <p>This email was sent using <code>rebase.email.send()</code> from a custom function.</p>
                    <p><strong>The singleton works!</strong></p>
                    <hr style="margin: 20px 0; border: none; border-top: 1px solid #e2e8f0;" />
                    <p style="color: #94a3b8; font-size: 14px;">
                        Sent at: ${new Date().toISOString()}
                    </p>
                </div>
            `
        });

        return c.json({
            success: true,
            message: "Email sent to francesco@firecms.co via rebase.email",
            timestamp: new Date().toISOString()
        });
    } catch (err: any) {
        return c.json({
            error: "Failed to process request",
            details: err.message,
            stack: err.stack
        }, 500);
    }
});

export default app;
