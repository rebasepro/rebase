import net from "node:net";
import { SMTPEmailService } from "../src/email/smtp-email-service";

/**
 * Connections to the mail server, counted by a fake SMTP server over a real
 * socket and real nodemailer.
 *
 * The transport was built without `pool: true`, so nodemailer opened a new
 * connection for every message — TCP, greeting, EHLO, and in production
 * STARTTLS and AUTH again — and fifty concurrent sends opened fifty
 * connections at once. Providers cap those (Office 365 SMTP AUTH allows three
 * per mailbox), so a burst came back as refusals the caller saw as failed
 * sends.
 */

interface FakeSmtp {
    port: number;
    /** Connections accepted since start. */
    accepted(): number;
    /** Connections open right now. */
    open(): number;
    /** The most connections open at once. */
    peak(): number;
    close(): Promise<void>;
}

async function fakeSmtpServer(): Promise<FakeSmtp> {
    let accepted = 0;
    let open = 0;
    let peak = 0;
    const sockets = new Set<net.Socket>();
    const server = net.createServer((socket) => {
        accepted++;
        open++;
        peak = Math.max(peak, open);
        sockets.add(socket);
        socket.on("close", () => {
            open--;
            sockets.delete(socket);
        });
        socket.on("error", () => undefined);
        const reply = (line: string) => socket.write(`${line}\r\n`);
        reply("220 fake ESMTP");
        let inData = false;
        let buffer = "";
        socket.on("data", (chunk) => {
            buffer += chunk.toString();
            let end: number;
            while ((end = buffer.indexOf("\r\n")) !== -1) {
                const line = buffer.slice(0, end);
                buffer = buffer.slice(end + 2);
                if (inData) {
                    if (line === ".") {
                        inData = false;
                        reply("250 2.0.0 queued");
                    }
                    continue;
                }
                const command = line.slice(0, 4).toUpperCase();
                if (command === "EHLO") reply("250-fake\r\n250-PIPELINING\r\n250 8BITMIME");
                else if (command === "DATA") {
                    inData = true;
                    reply("354 go ahead");
                } else if (command === "QUIT") {
                    reply("221 bye");
                    socket.end();
                } else reply("250 OK");
            }
        });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
    return {
        port: (server.address() as net.AddressInfo).port,
        accepted: () => accepted,
        open: () => open,
        peak: () => peak,
        close: () => new Promise<void>((resolve) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => resolve());
        })
    };
}

async function until(check: () => boolean): Promise<void> {
    for (let i = 0; i < 400 && !check(); i++) await new Promise(r => setTimeout(r, 5));
}

const mail = (i: number) => ({ to: `user${i}@example.com`, subject: `Hello ${i}`, text: "hello" });

describe("SMTPEmailService connections", () => {
    let smtp: FakeSmtp;
    let service: SMTPEmailService;

    beforeEach(async () => {
        smtp = await fakeSmtpServer();
        service = new SMTPEmailService({
            from: "app@example.com",
            smtp: { host: "127.0.0.1", port: smtp.port, secure: false }
        });
    });

    afterEach(async () => {
        service.close();
        await smtp.close();
    });

    it("sends twenty messages at once over at most five connections", async () => {
        const results = await Promise.all(Array.from({ length: 20 }, (_, i) => service.send(mail(i))));

        expect(results).toHaveLength(20);
        expect(smtp.accepted()).toBeLessThanOrEqual(5);
        expect(smtp.peak()).toBeLessThanOrEqual(5);
    });

    it("reuses one connection for messages sent one after another", async () => {
        for (let i = 0; i < 5; i++) await service.send(mail(i));

        expect(smtp.accepted()).toBe(1);
    });

    it("keeps to a lower limit when the config sets one", async () => {
        service = new SMTPEmailService({
            from: "app@example.com",
            smtp: { host: "127.0.0.1", port: smtp.port, secure: false, maxConnections: 2 }
        });

        await Promise.all(Array.from({ length: 10 }, (_, i) => service.send(mail(i))));

        expect(smtp.peak()).toBeLessThanOrEqual(2);
    });

    it("leaves no connection open after close()", async () => {
        await Promise.all(Array.from({ length: 10 }, (_, i) => service.send(mail(i))));
        expect(smtp.open()).toBeGreaterThan(0);

        service.close();
        await until(() => smtp.open() === 0);

        expect(smtp.open()).toBe(0);
    });
});
