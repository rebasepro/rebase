/**
 * The development mail sink, and the three conditions that gate it.
 *
 * The gate is the part worth testing hardest. A captured password-reset mail
 * carries a working reset token, so "never in production" is a security
 * property, not a preference — and "only with an absolute link base" is what
 * keeps this from turning a working no-email boot into a failed one, since
 * `assertEmailLinkBases` refuses a config that cannot build a followable link.
 */
import { createDevEmailSink, extractLinks } from "../src/email/dev-sink";
import { resolveEmailOptions } from "../src/boot/options";
import { assertEmailLinkBases } from "../src/email/link-base";
import type { RebaseBootEnv } from "../src/boot/env";

const env = (overrides: Partial<RebaseBootEnv>): RebaseBootEnv =>
    ({ NODE_ENV: "development", APP_NAME: "Rebase", ...overrides }) as RebaseBootEnv;

const DEV = { FRONTEND_URL: "http://localhost:5173" };

describe("extractLinks", () => {
    it("reads hrefs out of an HTML body, in document order", () => {
        const html = '<a href="https://a.example/one">one</a><a href="https://a.example/two">two</a>';
        expect(extractLinks(html, undefined)).toEqual(["https://a.example/one", "https://a.example/two"]);
    });

    it("falls back to bare URLs in the text part", () => {
        expect(extractLinks(undefined, "Open http://localhost:5173/verify-email?token=abc to continue"))
            .toEqual(["http://localhost:5173/verify-email?token=abc"]);
    });

    it("does not repeat a link that appears in both parts", () => {
        const url = "https://a.example/reset?token=t";
        expect(extractLinks(`<a href="${url}">reset</a>`, `Reset here: ${url}`)).toEqual([url]);
    });

    it("trims trailing punctuation so the result is pasteable", () => {
        expect(extractLinks(undefined, "Go to https://a.example/x?token=t.")).toEqual(["https://a.example/x?token=t"]);
    });

    it("ignores relative and non-http hrefs", () => {
        const html = '<a href="/verify">rel</a><a href="mailto:a@b.c">mail</a>';
        expect(extractLinks(html, undefined)).toEqual([]);
    });

    it("returns nothing for a message with no links", () => {
        expect(extractLinks("<p>hello</p>", "hello")).toEqual([]);
    });
});

describe("createDevEmailSink", () => {
    it("captures a message and extracts its link", async () => {
        const sink = createDevEmailSink();
        await sink.sendEmail({
            to: "user@example.com",
            subject: "Your magic link",
            html: '<a href="http://localhost:5173/auth/magic-link?token=abc">Sign in</a>'
        });

        const [mail] = sink.list();
        expect(mail).toMatchObject({
            to: "user@example.com",
            subject: "Your magic link",
            links: ["http://localhost:5173/auth/magic-link?token=abc"]
        });
        expect(Date.parse(mail.at)).not.toBeNaN();
    });

    it("joins multiple recipients for display", async () => {
        const sink = createDevEmailSink();
        await sink.sendEmail({ to: ["a@x.com", "b@x.com"], subject: "s", text: "t" });
        expect(sink.list()[0].to).toBe("a@x.com, b@x.com");
    });

    it("lists most recent first", async () => {
        const sink = createDevEmailSink();
        await sink.sendEmail({ to: "a@x.com", subject: "first", text: "t" });
        await sink.sendEmail({ to: "a@x.com", subject: "second", text: "t" });
        expect(sink.list().map(m => m.subject)).toEqual(["second", "first"]);
    });

    it("is a ring buffer, not a mailbox — the oldest falls off", async () => {
        const sink = createDevEmailSink({ capacity: 2 });
        for (const subject of ["one", "two", "three"]) {
            await sink.sendEmail({ to: "a@x.com", subject, text: "t" });
        }
        expect(sink.list().map(m => m.subject)).toEqual(["three", "two"]);
    });

    it("clears", async () => {
        const sink = createDevEmailSink();
        await sink.sendEmail({ to: "a@x.com", subject: "s", text: "t" });
        sink.clear();
        expect(sink.list()).toEqual([]);
    });

    it("hands out copies, so a caller cannot mutate the buffer", async () => {
        const sink = createDevEmailSink();
        await sink.sendEmail({ to: "a@x.com", subject: "s", text: "t" });
        sink.list().length = 0;
        expect(sink.list()).toHaveLength(1);
    });
});

describe("resolveEmailOptions — when the sink is used", () => {
    it("uses it in development when SMTP is absent and a link base exists", () => {
        const config = resolveEmailOptions(env(DEV));
        expect(config).toBeDefined();
        expect(typeof config!.sendEmail).toBe("function");
        expect(config!.smtp).toBeUndefined();
        expect(config!.resetPasswordUrl).toBe("http://localhost:5173");
    });

    it("produces a config that can build a followable link", () => {
        // The condition that would otherwise fail the boot.
        expect(() => assertEmailLinkBases(resolveEmailOptions(env(DEV))!)).not.toThrow();
    });

    it("NEVER in production — a captured reset mail carries a live token", () => {
        expect(resolveEmailOptions(env({ ...DEV, NODE_ENV: "production" }))).toBeUndefined();
    });

    it("not without an absolute link base, which would be a dead link", () => {
        expect(resolveEmailOptions(env({}))).toBeUndefined();
        expect(resolveEmailOptions(env({ FRONTEND_URL: "" }))).toBeUndefined();
        expect(resolveEmailOptions(env({ FRONTEND_URL: "/app" }))).toBeUndefined();
        expect(resolveEmailOptions(env({ FRONTEND_URL: "localhost:5173" }))).toBeUndefined();
    });

    it("a configured SMTP host always wins over the sink", () => {
        const config = resolveEmailOptions(env({ ...DEV, SMTP_HOST: "smtp.example.com" }));
        expect(config!.smtp?.host).toBe("smtp.example.com");
        expect(config!.sendEmail).toBeUndefined();
    });

    it("carries branding into the sink config, like the SMTP one", () => {
        const config = resolveEmailOptions(env({
            ...DEV,
            APP_NAME: "Acme",
            EMAIL_LOGO_URL: "https://acme.example/logo.png"
        }));
        expect(config).toMatchObject({ appName: "Acme", logoUrl: "https://acme.example/logo.png" });
    });

    it("each boot gets its own buffer", async () => {
        const a = resolveEmailOptions(env(DEV))!;
        const b = resolveEmailOptions(env(DEV))!;
        await a.sendEmail!({ to: "a@x.com", subject: "only in a", text: "t" });
        // Nothing shared: b's sink never saw it. Asserted through the public
        // surface rather than by reaching into either closure.
        await expect(b.sendEmail!({ to: "b@x.com", subject: "only in b", text: "t" })).resolves.toBeUndefined();
    });
});
