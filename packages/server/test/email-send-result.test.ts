import { SMTPEmailService } from "../src/email/smtp-email-service";
import { createDevEmailSink } from "../src/email/dev-sink";
import nodemailer from "nodemailer";

/**
 * What `send()` reports back, and what it refuses to put in a header.
 *
 * `send()` returned `void` before this. An application that sent a message had
 * no way to learn the id the server gave it, so threading a reply back to the
 * message that prompted it was impossible through this interface — and the
 * headers that carry a one-click unsubscribe could not be sent at all. Both are
 * things a real sender has to do, so both are tested here rather than left to
 * whichever caller notices first.
 */

jest.mock("nodemailer", () => ({
    createTransport: jest.fn().mockReturnValue({
        verify: jest.fn().mockResolvedValue(true),
        sendMail: jest.fn().mockResolvedValue({
            messageId: "<abc123@mail.example.com>",
            accepted: ["dana@acme.com"],
            rejected: []
        })
    })
}));

const smtp = { host: "smtp.example.com", port: 587 };
const message = { to: "dana@acme.com", subject: "Hello", html: "<p>Hello</p>" };

function service() {
    return new SMTPEmailService({ from: "outreach@example.com", smtp });
}

describe("send() reports what the provider said", () => {
    beforeEach(() => jest.clearAllMocks());

    it("returns the Message-ID with the angle brackets stripped", async () => {
        const result = await service().send(message);

        // Stripped because this is an identifier to store and compare against a
        // reply's In-Reply-To. A value that sometimes carries brackets and
        // sometimes does not is a bug waiting in every comparison.
        expect(result.messageId).toBe("abc123@mail.example.com");
        expect(result.accepted).toEqual(["dana@acme.com"]);
        expect(result.rejected).toEqual([]);
    });

    it("passes headers through to the transport", async () => {
        const transporter = (nodemailer.createTransport as jest.Mock)({} as never);
        await service().send({
            ...message,
            headers: {
                "List-Unsubscribe": "<https://example.com/u/1>, <mailto:u@example.com>",
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
            }
        });

        expect(transporter.sendMail).toHaveBeenCalledWith(expect.objectContaining({
            headers: expect.objectContaining({ "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" })
        }));
    });

    it("reports an absent id as undefined rather than inventing one", async () => {
        const transporter = (nodemailer.createTransport as jest.Mock)({} as never);
        transporter.sendMail.mockResolvedValueOnce({ accepted: ["dana@acme.com"] });

        const result = await service().send(message);

        // "Not reported" is a real state — a custom provider may know nothing
        // beyond "no error" — and it must stay distinguishable from an id.
        expect(result.messageId).toBeUndefined();
    });

    it("returns whatever a custom sendEmail reports, or an empty result", async () => {
        const withResult = new SMTPEmailService({
            from: "outreach@example.com",
            sendEmail: async () => ({ messageId: "custom-1@example.com" })
        });
        expect((await withResult.send(message)).messageId).toBe("custom-1@example.com");

        // An existing `async () => {}` provider still satisfies the config type
        // and still works — it simply reports nothing.
        const voidProvider = new SMTPEmailService({
            from: "outreach@example.com",
            sendEmail: async () => { /* reports nothing */ }
        });
        expect(await voidProvider.send(message)).toEqual({});
    });
});

describe("header injection", () => {
    beforeEach(() => jest.clearAllMocks());

    it("refuses a header value containing CR or LF", async () => {
        const transporter = (nodemailer.createTransport as jest.Mock)({} as never);

        // A newline ends the header and starts another one, so any field built
        // from data the sender did not write is a way to add a Bcc.
        await expect(service().send({
            ...message,
            headers: { "X-Thing": "ok\r\nBcc: attacker@evil.com" }
        })).rejects.toThrow(/cannot contain CR or LF/);

        await expect(service().send({
            ...message,
            headers: { "X-Thing": "ok\nBcc: attacker@evil.com" }
        })).rejects.toThrow(/cannot contain CR or LF/);

        // Refused before anything is sent — a rejected message must not be a
        // half-sent one.
        expect(transporter.sendMail).not.toHaveBeenCalled();
    });

    it("refuses a header name that is not a header name", async () => {
        await expect(service().send({
            ...message,
            headers: { "X-Thing: injected": "value" }
        })).rejects.toThrow(/Invalid email header name/);
    });

    it("validates before handing anything to a custom provider", async () => {
        // The custom path must not be a way around the check: whatever client
        // it wraps will splice the header in just the same.
        const sendEmail = jest.fn(async () => ({}));
        const custom = new SMTPEmailService({ from: "outreach@example.com", sendEmail });

        await expect(custom.send({ ...message, headers: { "X-Thing": "a\rb" } }))
            .rejects.toThrow(/cannot contain CR or LF/);
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it("allows the ordinary headers a sender actually needs", async () => {
        await expect(service().send({
            ...message,
            headers: {
                "List-Unsubscribe": "<https://example.com/u/1>",
                "In-Reply-To": "<abc@example.com>",
                References: "<abc@example.com> <def@example.com>"
            }
        })).resolves.toBeDefined();
    });
});

describe("the development sink", () => {
    it("reports a Message-ID so a dev flow behaves like a real one", async () => {
        const sink = createDevEmailSink();
        const result = await sink.sendEmail({ to: "dana@acme.com", subject: "Hi", html: "<p>Hi</p>" });

        expect(result.messageId).toBeTruthy();
        // What was returned is what was captured, so code that stores the id and
        // later matches a reply against it exercises the same path here.
        expect(sink.list()[0].messageId).toBe(result.messageId);
    });

    it("gives each message its own id", async () => {
        const sink = createDevEmailSink();
        const first = await sink.sendEmail({ to: "a@x.com", subject: "1", html: "" });
        const second = await sink.sendEmail({ to: "b@x.com", subject: "2", html: "" });
        expect(first.messageId).not.toBe(second.messageId);
    });
});
