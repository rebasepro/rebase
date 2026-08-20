import { resolveEmailOptions } from "../src/boot/options";
import { resolveEmailBranding } from "../src/email/templates";
import type { RebaseBootEnv } from "../src/boot/env";

function env(overrides: Partial<RebaseBootEnv>): RebaseBootEnv {
    return { NODE_ENV: "development", APP_NAME: "Rebase", ...overrides } as RebaseBootEnv;
}

/**
 * A managed tenant ships no code of its own — it ships a bundle and a set of
 * environment variables. So anything the email templates can be told has to be
 * reachable from the environment, or it is unreachable for the tenants that most
 * need it.
 */
describe("resolveEmailOptions — email branding", () => {
    it("is undefined without an SMTP host, logo or not", () => {
        expect(resolveEmailOptions(env({ EMAIL_LOGO_URL: "https://acme.example/l.png" }))).toBeUndefined();
    });

    it("passes EMAIL_LOGO_URL through to the email config", () => {
        const config = resolveEmailOptions(env({
            SMTP_HOST: "smtp.example.com",
            EMAIL_LOGO_URL: "https://acme.example/logo.png"
        }));

        expect(config?.logoUrl).toBe("https://acme.example/logo.png");
    });

    it("leaves logoUrl unset when the variable is absent", () => {
        const config = resolveEmailOptions(env({ SMTP_HOST: "smtp.example.com" }));

        expect(config?.logoUrl).toBeUndefined();
    });

    describe("end to end through resolveEmailBranding", () => {
        it("a renamed tenant that sets EMAIL_LOGO_URL gets its own mark", () => {
            const config = resolveEmailOptions(env({
                SMTP_HOST: "smtp.example.com",
                APP_NAME: "Acme",
                EMAIL_LOGO_URL: "https://acme.example/logo.png"
            }));

            expect(resolveEmailBranding(config)).toEqual({
                appName: "Acme",
                logoUrl: "https://acme.example/logo.png"
            });
        });

        it("a renamed tenant that sets no logo gets none — never Rebase's", () => {
            const config = resolveEmailOptions(env({ SMTP_HOST: "smtp.example.com", APP_NAME: "Acme" }));

            expect(resolveEmailBranding(config).logoUrl).toBeUndefined();
        });

        it("an un-renamed tenant still gets the Rebase mark with no variable set", () => {
            // APP_NAME defaults to "Rebase", so this is the shape every
            // unconfigured managed boot actually produces.
            const config = resolveEmailOptions(env({ SMTP_HOST: "smtp.example.com" }));

            expect(resolveEmailBranding(config).logoUrl).toBe("https://rebase.pro/img/logo_small.png");
        });

        it("a junk EMAIL_LOGO_URL renders no logo rather than a broken image", () => {
            const config = resolveEmailOptions(env({
                SMTP_HOST: "smtp.example.com",
                EMAIL_LOGO_URL: "/img/logo.png"
            }));

            expect(resolveEmailBranding(config).logoUrl).toBeUndefined();
        });
    });
});
