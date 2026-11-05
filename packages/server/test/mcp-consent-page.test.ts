/**
 * The consent screen's own behaviour: what a person reads, and what the inline
 * script does with each answer the auth routes can give it.
 *
 * The script is run for real, in a `vm` context, against a small stand-in for
 * the handful of DOM calls it makes. That is deliberate: the bugs this file
 * exists for were in the script's reading of response bodies (an error object
 * rendered as "[object Object]", an `MFA_REQUIRED` answer with no way forward),
 * and only running the script reaches them.
 */
import vm from "node:vm";
import { renderConsentPage, type ConsentPageParams } from "../src/mcp/consent-page";

const BASE: ConsentPageParams = {
    clientName: "Claude",
    scope: "data:read",
    scopeDescriptions: [{ scope: "data:read", description: "Read your data" }],
    requestToken: "rt",
    loginUrl: "/api/auth/login",
    mfaChallengeUrl: "/api/auth/mfa/challenge",
    mfaVerifyUrl: "/api/auth/mfa/challenge/verify",
    decisionUrl: "/api/oauth/authorize/decision",
    refreshUrl: "/api/auth/refresh",
    resource: "https://app.example.com/mcp",
    redirectUri: "https://claude.ai/api/mcp/auth_callback",
    nonce: "n1"
};

interface FakeElement {
    id: string;
    value: string;
    textContent: string;
    hidden: boolean;
    disabled: boolean;
    required: boolean;
    submitted: number;
    listeners: Record<string, Array<(event: { preventDefault(): void }) => void>>;
    addEventListener(type: string, fn: (event: { preventDefault(): void }) => void): void;
    removeAttribute(name: string): void;
    setAttribute(name: string, value: string): void;
    focus(): void;
    submit(): void;
}

interface FetchCall { url: string; headers: Record<string, string>; body: Record<string, unknown> }
type Responder = (call: FetchCall) => { status: number; body: unknown } | { status: number; text: string };

/** Mount the page's script against a stand-in DOM built from the page's own ids. */
function mount(html: string, respond: Responder, storage?: Map<string, string>) {
    const elements = new Map<string, FakeElement>();
    for (const match of html.matchAll(/<[a-z]+\b([^>]*)>/g)) {
        const attrs = match[1];
        const id = /\sid="([^"]+)"/.exec(attrs)?.[1];
        if (!id) continue;
        const value = /\svalue="([^"]*)"/.exec(attrs)?.[1] ?? "";
        const el: FakeElement = {
            id,
            value,
            textContent: "",
            hidden: /\shidden(\s|$|>)/.test(attrs + ">"),
            disabled: false,
            required: /\srequired(\s|$|>)/.test(attrs + ">"),
            submitted: 0,
            listeners: {},
            addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
            removeAttribute(name) { if (name === "required") this.required = false; if (name === "hidden") this.hidden = false; },
            setAttribute(name) { if (name === "required") this.required = true; if (name === "hidden") this.hidden = true; },
            focus() {},
            submit() { this.submitted++; }
        };
        elements.set(id, el);
    }

    const calls: FetchCall[] = [];
    const fetch = async (url: string, init: { headers?: Record<string, string>; body?: string }) => {
        const call = { url, headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : {} };
        calls.push(call);
        const answer = respond(call);
        return {
            ok: answer.status >= 200 && answer.status < 300,
            status: answer.status,
            json: async () => {
                if ("text" in answer) throw new SyntaxError(`Unexpected token '<', "${answer.text}" is not valid JSON`);
                return answer.body;
            }
        };
    };

    const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html)?.[1];
    if (!script) throw new Error("no inline script in the page");
    const document = {
        getElementById(id: string) {
            const el = elements.get(id);
            if (!el) throw new Error(`the script asked for #${id}, which the page does not have`);
            return el;
        }
    };
    const localStorage = storage && {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => { storage.set(key, value); }
    };
    vm.runInNewContext(script, { document, fetch, JSON, Promise, Error, setTimeout, Date, ...(localStorage && { localStorage }) });

    const el = (id: string) => elements.get(id)!;
    return {
        el,
        calls,
        async submit() {
            let prevented = false;
            for (const fn of el("consent").listeners.submit ?? []) fn({ preventDefault() { prevented = true; } });
            await new Promise(resolve => setTimeout(resolve, 20));
            return prevented;
        },
        click(id: string) {
            for (const fn of el(id).listeners.click ?? []) fn({ preventDefault() {} });
        }
    };
}

const SIGNED_IN = { status: 200, body: { user: { uid: "u1" }, tokens: { accessToken: "session-token" } } };

describe("consent page: sign-in errors are shown as the server words them", () => {
    it("shows the canonical error envelope's message, not [object Object]", async () => {
        const page = mount(renderConsentPage(BASE), () => ({
            status: 401,
            body: { error: { message: "Invalid email or password.", code: "INVALID_CREDENTIALS" } }
        }));
        page.el("email").value = "a@b.c";
        page.el("password").value = "pw";
        await page.submit();

        expect(page.el("error").textContent).toBe("Invalid email or password.");
        expect(page.el("consent").submitted).toBe(0);
        expect(page.el("allow").disabled).toBe(false);
    });

    it("reads the flat spellings a transformed auth response may use", async () => {
        for (const body of [{ error: "Account locked." }, { message: "Account locked." }, { error: "x", error_description: "Account locked." }]) {
            const page = mount(renderConsentPage(BASE), () => ({ status: 401, body }));
            await page.submit();
            expect(page.el("error").textContent).toBe("Account locked.");
        }
    });

    it("says sign-in failed when the answer is not JSON at all", async () => {
        const page = mount(renderConsentPage(BASE), () => ({ status: 502, text: "<html>Bad gateway</html>" }));
        await page.submit();
        expect(page.el("error").textContent).toBe("Sign-in failed (HTTP 502).");
    });

    it("posts the session token and submits the decision on a plain sign-in", async () => {
        const page = mount(renderConsentPage(BASE), () => SIGNED_IN);
        page.el("email").value = "a@b.c";
        page.el("password").value = "pw";
        await page.submit();

        expect(page.calls.map(c => c.url)).toEqual(["/api/auth/login"]);
        expect(page.calls[0].body).toEqual({ email: "a@b.c", password: "pw" });
        expect(page.el("session_token").value).toBe("session-token");
        expect(page.el("consent").submitted).toBe(1);
    });
});

describe("consent page: an account with a second factor can consent", () => {
    const MFA_REQUIRED = {
        status: 401,
        body: {
            error: {
                message: "Multi-factor authentication is required to complete sign-in.",
                code: "MFA_REQUIRED",
                details: { mfaToken: "pending-token", factors: [{ id: "factor-1", factorType: "totp" }] }
            }
        }
    };

    function mfaPage(verify: Responder) {
        return mount(renderConsentPage(BASE), call => {
            if (call.url === BASE.loginUrl) return MFA_REQUIRED;
            if (call.url === BASE.mfaChallengeUrl) return { status: 200, body: { challengeId: "challenge-1", factorId: "factor-1" } };
            return verify(call);
        });
    }

    it("asks for a code after the password, then verifies it with the pending token and submits", async () => {
        const page = mfaPage(() => ({ status: 200, body: { tokens: { accessToken: "aal2-session" } } }));
        expect(page.el("mfa").hidden).toBe(true);

        page.el("email").value = "a@b.c";
        page.el("password").value = "pw";
        await page.submit();

        // The challenge is opened with the pending credential, never a session.
        expect(page.calls[1]).toMatchObject({
            url: "/api/auth/mfa/challenge",
            headers: { Authorization: "Bearer pending-token" },
            body: { factorId: "factor-1" }
        });
        expect(page.el("mfa").hidden).toBe(false);
        expect(page.el("signin").hidden).toBe(true);
        expect(page.el("mfa_code").required).toBe(true);
        expect(page.el("password").required).toBe(false);
        expect(page.el("consent").submitted).toBe(0);
        expect(page.el("error").textContent).toBe("");

        page.el("mfa_code").value = " 123456 ";
        await page.submit();

        expect(page.calls[2]).toMatchObject({
            url: "/api/auth/mfa/challenge/verify",
            headers: { Authorization: "Bearer pending-token" },
            body: { challengeId: "challenge-1", code: "123456" }
        });
        expect(page.el("session_token").value).toBe("aal2-session");
        expect(page.el("consent").submitted).toBe(1);
    });

    it("shows a wrong code's message and lets the person try again", async () => {
        let attempt = 0;
        const page = mfaPage(() => (++attempt === 1
            ? { status: 401, body: { error: { message: "Invalid verification code", code: "INVALID_CODE" } } }
            : { status: 200, body: { tokens: { accessToken: "aal2-session" } } }));
        await page.submit();
        page.el("mfa_code").value = "000000";
        await page.submit();

        expect(page.el("error").textContent).toBe("Invalid verification code");
        expect(page.el("consent").submitted).toBe(0);

        page.el("mfa_code").value = "ABCD-EFGH"; // a recovery code goes to the same route
        await page.submit();
        expect(page.calls.at(-1)?.body).toEqual({ challengeId: "challenge-1", code: "ABCD-EFGH" });
        expect(page.el("consent").submitted).toBe(1);
    });

    it("opens a fresh challenge when the current one is spent", async () => {
        let attempt = 0;
        const page = mfaPage(() => (++attempt === 1
            ? { status: 401, body: { error: { message: "Too many failed attempts for this challenge", code: "CHALLENGE_EXHAUSTED" } } }
            : { status: 200, body: { tokens: { accessToken: "aal2-session" } } }));
        await page.submit();
        page.el("mfa_code").value = "000000";
        await page.submit();

        expect(page.calls.filter(c => c.url === BASE.mfaChallengeUrl)).toHaveLength(2);
        expect(page.el("error").textContent).toContain("Too many failed attempts");
    });

    it("lets a denial through without any credential, at either step", async () => {
        const page = mfaPage(() => SIGNED_IN);
        await page.submit();
        page.click("deny");
        expect(page.el("decision").value).toBe("deny");
        expect(page.el("mfa_code").required).toBe(false);
        expect(page.el("consent").submitted).toBe(1);
    });
});

describe("consent page: what the person is told", () => {
    it("names the host the authorization code is sent to, and says it is not verified", () => {
        const html = renderConsentPage({ ...BASE, clientName: "Claude", redirectUri: "https://claude-connect.example/cb?x=1" });
        expect(html).toContain("claude-connect.example");
        expect(html).toMatch(/not verified/i);
    });

    it("calls a loopback redirect this computer, and shows a private-use scheme whole", () => {
        expect(renderConsentPage({ ...BASE, redirectUri: "http://127.0.0.1:33418/callback" }))
            .toContain("127.0.0.1:33418");
        expect(renderConsentPage({ ...BASE, redirectUri: "http://127.0.0.1:33418/callback" }))
            .toMatch(/this computer/i);
        expect(renderConsentPage({ ...BASE, redirectUri: "com.example.app:/oauth" }))
            .toContain("com.example.app:/oauth");
    });

    it("escapes whatever the redirect carries", () => {
        const html = renderConsentPage({ ...BASE, redirectUri: "com.ex\"<b>.app:/x" });
        expect(html).not.toContain("<b>");
    });

    it("tells an account with no password how to get one", () => {
        const html = renderConsentPage(BASE);
        expect(html).toMatch(/Google, GitHub/);
        expect(html).toMatch(/Forgot password/);
    });
});

describe("consent page: someone signed in to this app in this browser", () => {
    const session = (overrides: Record<string, unknown> = {}) => new Map([["rebase_auth", JSON.stringify({
        accessToken: "console-token",
        refreshToken: "console-refresh",
        expiresAt: Date.now() + 30 * 60_000,
        user: { email: "dev@example.com" },
        ...overrides
    })]]);

    it("is offered that account, and Allow uses its session without a password", async () => {
        const page = mount(renderConsentPage(BASE), () => SIGNED_IN, session());

        expect(page.el("current").hidden).toBe(false);
        expect(page.el("current_email").textContent).toBe("dev@example.com");
        expect(page.el("signin").hidden).toBe(true);
        expect(page.el("email").required).toBe(false);
        // Nothing is sent before the press.
        expect(page.calls).toEqual([]);

        await page.submit();
        expect(page.calls).toEqual([]);
        expect(page.el("session_token").value).toBe("console-token");
        expect(page.el("consent").submitted).toBe(1);
    });

    it("renews an expired session first, and hands the new pair back to the frontend", async () => {
        const storage = session({ expiresAt: Date.now() - 1000 });
        const page = mount(renderConsentPage(BASE), () => ({
            status: 200,
            body: { tokens: { accessToken: "renewed", refreshToken: "rotated", accessTokenExpiresAt: 123 } }
        }), storage);

        await page.submit();
        expect(page.calls.map(c => [c.url, c.body])).toEqual([["/api/auth/refresh", { refreshToken: "console-refresh" }]]);
        expect(page.el("session_token").value).toBe("renewed");
        expect(JSON.parse(storage.get("rebase_auth")!)).toEqual({
            accessToken: "renewed", refreshToken: "rotated", expiresAt: 123, user: { email: "dev@example.com" }
        });
    });

    it("falls back to signing in here when the session cannot be renewed", async () => {
        const page = mount(renderConsentPage(BASE),
            () => ({ status: 401, body: { error: { message: "Invalid", code: "INVALID_TOKEN" } } }),
            session({ expiresAt: Date.now() - 1000 }));

        await page.submit();
        expect(page.el("consent").submitted).toBe(0);
        expect(page.el("signin").hidden).toBe(false);
        expect(page.el("email").required).toBe(true);
        expect(page.el("error").textContent).toContain("Sign in below");
    });

    it("can use another account instead", async () => {
        const page = mount(renderConsentPage(BASE), () => SIGNED_IN, session());
        page.click("other");
        page.el("email").value = "a@b.c";
        page.el("password").value = "pw";

        await page.submit();
        expect(page.calls.map(c => c.url)).toEqual(["/api/auth/login"]);
    });

    it("is not offered a stored value that is not a session", async () => {
        for (const raw of ["not json", JSON.stringify({ accessToken: "t" }), JSON.stringify(null)]) {
            const page = mount(renderConsentPage(BASE), () => SIGNED_IN, new Map([["rebase_auth", raw]]));
            expect(page.el("current").hidden).toBe(true);
            expect(page.el("signin").hidden).toBe(false);
        }
    });

    it("shows the email as text, never as markup", async () => {
        const page = mount(renderConsentPage(BASE), () => SIGNED_IN, session({ user: { email: "<img src=x onerror=alert(1)>" } }));
        expect(page.el("current_email").textContent).toBe("<img src=x onerror=alert(1)>");
    });
});
