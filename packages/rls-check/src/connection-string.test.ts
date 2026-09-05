/**
 * The libpq keyword form has to reach the host it names.
 *
 * `pg` cannot read `host=… dbname=…` at all: `pg-connection-string` only parses
 * URLs, so handing the raw string to `new Client({ connectionString })` opened a
 * connection to the *default* host while the report named the host the user
 * typed — "the host in the connection string does not resolve (127.0.0.1:1)"
 * for a failure that never went near 127.0.0.1. These pin the translation, and
 * pin that a keyword we cannot express is refused rather than dropped.
 */
import { describe, it, expect } from "vitest";

import { clientConfigFromKeywords, unsupportedConnectionKeywords } from "./introspect";
import { parseConnectionString, parseKeywordConnectionString } from "./redact";

const keywords = (raw: string): Map<string, string> => {
    const parsed = parseKeywordConnectionString(raw);
    if (!parsed) throw new Error(`not a keyword string: ${raw}`);

    return parsed;
};

describe("parseKeywordConnectionString", () => {
    it("reads a keyword string", () => {
        expect([...keywords("host=127.0.0.1 port=1 dbname=x user=u password=p")]).toEqual([
            ["host", "127.0.0.1"],
            ["port", "1"],
            ["dbname", "x"],
            ["user", "u"],
            ["password", "p"]
        ]);
    });

    it("unquotes a value with spaces in it", () => {
        expect(keywords("host=db.example.com password='s3 cret'").get("password")).toBe("s3 cret");
    });

    it("is null for a URL", () => {
        expect(parseKeywordConnectionString("postgresql://u:p@db.example.com:5432/app")).toBeNull();
    });

    it("is null for something that is neither", () => {
        expect(parseKeywordConnectionString("just some text")).toBeNull();
    });
});

describe("clientConfigFromKeywords", () => {
    it("sends the connection to the host and port that were named", () => {
        const config = clientConfigFromKeywords(keywords("host=127.0.0.1 port=1 dbname=x user=u password=p"));

        expect(config.host).toBe("127.0.0.1");
        expect(config.port).toBe(1);
        expect(config.database).toBe("x");
        expect(config.user).toBe("u");
        expect(config.password).toBe("p");
        // The raw string must never reach `pg`: it would silently win over these.
        expect(config.connectionString).toBeUndefined();
    });

    it("defaults the host to localhost, the way libpq does", () => {
        expect(clientConfigFromKeywords(keywords("dbname=app")).host).toBe("localhost");
    });

    it("turns connect_timeout seconds into milliseconds", () => {
        expect(clientConfigFromKeywords(keywords("host=db dbname=app connect_timeout=5")).connectionTimeoutMillis).toBe(
            5000
        );
    });

    it("refuses a keyword it cannot honour rather than dropping it", () => {
        expect(() => clientConfigFromKeywords(keywords("host=db dbname=app sslrootcert=/etc/ca.pem"))).toThrow(
            /sslrootcert/
        );
    });
});

describe("unsupportedConnectionKeywords", () => {
    it("is empty for a keyword string that translates in full", () => {
        expect(unsupportedConnectionKeywords("host=db port=5432 dbname=app user=u password=p sslmode=require")).toEqual(
            []
        );
    });

    it("is empty for a URL, whatever parameters it carries", () => {
        expect(unsupportedConnectionKeywords("postgresql://u:p@db:5432/app?sslrootcert=/etc/ca.pem")).toEqual([]);
    });

    it("names every keyword that would change where the scan goes or how it verifies", () => {
        expect(unsupportedConnectionKeywords("host=db dbname=app hostaddr=10.0.0.1 sslrootcert=/etc/ca.pem")).toEqual([
            "hostaddr",
            "sslrootcert"
        ]);
    });
});

/**
 * Which unencoded characters in a password are handled, and which are refused.
 *
 * The README used to say all five of `@ : / ? #` made the URL ambiguous and
 * were refused. Two of them are not: the userinfo splits at the LAST `@` and
 * the user at the FIRST `:`, which is what `pg` does too, so those passwords
 * connect. A documented refusal that does not happen sends people
 * percent-encoding a string that already worked — and teaches them not to trust
 * the refusal that is real.
 */
describe("unencoded characters in a password", () => {
    it("splits at the last @ and the first :, so both work unencoded", () => {
        expect(parseConnectionString("postgresql://u:pa@ss@127.0.0.1:5432/db")).toMatchObject({
            host: "127.0.0.1",
            port: 5432,
            database: "db",
            user: "u",
            password: "pa@ss"
        });

        expect(parseConnectionString("postgresql://u:pa:ss@127.0.0.1:5432/db")).toMatchObject({
            host: "127.0.0.1",
            password: "pa:ss"
        });
    });

    it.each(["/", "?", "#"])("refuses the string when the password contains %s", (char) => {
        // These end the authority, so the split lands inside the credential.
        // Refusing is the only safe answer: printing the pieces would print
        // part of the password.
        expect(parseConnectionString(`postgresql://u:pa${char}ss@127.0.0.1:5432/db`)).toBeNull();
    });
});
