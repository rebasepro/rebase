/**
 * A static app's `path` may be a full URL, which gives the app a hostname of its
 * own. The CLI, the control plane and the runtime all read it through
 * `parseAppAddress`, so these pin what each of them will see.
 */
import { isValidAppHost, parseAppAddress } from "../src";

describe("parseAppAddress", () => {
    it("returns a path as written, for the caller's path rules", () => {
        expect(parseAppAddress("/")).toEqual({ ok: true, address: { path: "/" } });
        expect(parseAppAddress("/admin")).toEqual({ ok: true, address: { path: "/admin" } });
        // Not this function's call: the CLI's path rules refuse these.
        expect(parseAppAddress("admin")).toEqual({ ok: true, address: { path: "admin" } });
        expect(parseAppAddress("/a/../b")).toEqual({ ok: true, address: { path: "/a/../b" } });
    });

    it("splits an https URL into its hostname and the path under it", () => {
        expect(parseAppAddress("https://admin.example.com")).toEqual({
            ok: true,
            address: { host: "admin.example.com", path: "/" }
        });
        expect(parseAppAddress("https://admin.example.com/")).toEqual({
            ok: true,
            address: { host: "admin.example.com", path: "/" }
        });
        expect(parseAppAddress("https://admin.example.com/cms")).toEqual({
            ok: true,
            address: { host: "admin.example.com", path: "/cms" }
        });
    });

    it("lowercases the hostname but leaves the path as written", () => {
        expect(parseAppAddress("HTTPS://Admin.Example.COM/Cms")).toEqual({
            ok: true,
            address: { host: "admin.example.com", path: "/Cms" }
        });
    });

    it("does not let URL normalisation hide a path the path rules must see", () => {
        // `new URL` would resolve this to "/b"; the caller has to be shown the `..`.
        const result = parseAppAddress("https://admin.example.com/a/../b");
        expect(result).toEqual({ ok: true, address: { host: "admin.example.com", path: "/a/../b" } });
    });

    it("hands internationalised names back in punycode", () => {
        const result = parseAppAddress("https://bücher.example");
        expect(result).toEqual({ ok: true, address: { host: "xn--bcher-kva.example", path: "/" } });
    });

    it.each([
        ["http://admin.example.com", /must use https/],
        ["ftp://admin.example.com", /must use https/],
        ["https://user:pw@admin.example.com", /credentials/],
        ["https://admin.example.com:8443", /port/],
        // `new URL` drops a default port, so ":443" has to be caught on the text.
        ["https://admin.example.com:443", /port/],
        ["https://admin.example.com:", /port/],
        ["https://admin.example.com/?next=a:b", /query or fragment/],
        // `new URL` reads "\" as "/", and the path would be lost, not refused.
        ["https://admin.example.com\\cms", /backslashes/],
        // …and strips tabs and newlines, accepting a host that was never written.
        ["https://admin.exa\tmple.com", /control characters/],
        ["https://admin.example.com\n", /control characters/],
        ["https://admin.example.com/c ms", /spaces/],
        ["https://admin.example.com/?x=1", /query or fragment/],
        ["https://admin.example.com/#top", /query or fragment/],
        ["https://admin.example.com?", /query or fragment/],
        ["https://localhost", /not a public hostname/],
        ["https://intranet", /not a public hostname/],
        ["https://10.0.0.1", /not a public hostname/],
        ["https://[::1]", /not a public hostname/],
        ["https://", /not a valid URL/]
    ])("refuses %s", (value, reason) => {
        const result = parseAppAddress(value);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toMatch(reason);
    });

    it("names the fix for an http URL", () => {
        const result = parseAppAddress("http://admin.example.com/cms");
        expect(result).toEqual({ ok: false, reason: expect.stringContaining("\"https://admin.example.com/cms\"") });
    });

    it("recognises a bare hostname and says to write it as a URL", () => {
        expect(parseAppAddress("admin.example.com")).toEqual({
            ok: false,
            reason: "looks like a hostname — write it as a URL: \"https://admin.example.com\""
        });
        expect(parseAppAddress("admin.example.com/cms")).toEqual({
            ok: false,
            reason: "looks like a hostname — write it as a URL: \"https://admin.example.com/cms\""
        });
    });
});

describe("isValidAppHost", () => {
    it.each(["example.com", "admin.example.com", "a-b.c-d.example.co.uk", "xn--bcher-kva.example"])(
        "accepts %s",
        host => expect(isValidAppHost(host)).toBe(true)
    );

    it.each([
        "",
        "localhost",
        "example",
        "Example.com",
        "-admin.example.com",
        "admin-.example.com",
        "admin..example.com",
        "admin.example.com.",
        "under_score.example.com",
        "192.168.0.1",
        "a".repeat(64) + ".example.com",
        `${"a.".repeat(127)}com`
    ])("refuses %j", host => expect(isValidAppHost(host)).toBe(false));
});
