import net from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { SMTPEmailService, DEFAULT_SMTP_TIMEOUT_MS } from "../src/email/smtp-email-service";

/**
 * An SMTP server that accepts the connection and never says hello.
 *
 * The transport was built with nodemailer's own timeouts — two minutes to
 * connect, thirty seconds for the greeting, ten minutes of socket silence — and
 * invitation, verification and reset mails are awaited by the request that
 * sends them. A mail host that hangs held `POST /users` for as long as that,
 * so behind a 60-second proxy the admin saw an error for a user who had been
 * created, and never saw the fallback temporary password.
 */
let server: net.Server;
let port: number;
const sockets = new Set<net.Socket>();

beforeEach(async () => {
    server = net.createServer((socket) => {
        sockets.add(socket);
        socket.on("error", () => undefined);
        socket.on("close", () => sockets.delete(socket));
        // Silence: no `220` greeting, ever.
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as net.AddressInfo).port;
});

afterEach(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
});

describe("a mail server that never answers", () => {
    it("fails the send at smtp.timeoutMs instead of hanging", async () => {
        const service = new SMTPEmailService({
            from: "noreply@example.test",
            smtp: { host: "127.0.0.1", port, secure: false, timeoutMs: 300 }
        });

        const started = Date.now();
        await expect(service.send({ to: "ada@example.test", subject: "Hi", html: "<p>Hi</p>" }))
            .rejects.toThrow(/Failed to send email/);
        expect(Date.now() - started).toBeLessThan(3_000);
    });

    it("has a default well under a proxy's 60 seconds", () => {
        expect(DEFAULT_SMTP_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
    });
});
