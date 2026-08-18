/**
 * The rule under test is libpq's, not a URL library's: at most one literal `=`
 * per query parameter. `new URL()` accepts the broken form happily, which is
 * precisely why the defect survived — see libpq-url.ts.
 */
import { describe, it, expect } from "vitest";
import { findUnparseableParams, encodeExtraEquals, scanTextForLibpqUrls } from "./libpq-url.js";

const BROKEN = "postgresql://rebase_app:pw@127.0.0.1:5435/rebase?options=-c%20search_path=public&sslmode=disable";
const FIXED = "postgresql://rebase_app:pw@127.0.0.1:5435/rebase?options=-c%20search_path%3Dpublic&sslmode=disable";

describe("findUnparseableParams", () => {
    it("flags the options parameter rebase init used to generate", () => {
        expect(findUnparseableParams(BROKEN)).toEqual([
            { name: "options", raw: "options=-c%20search_path=public" }
        ]);
    });

    it("accepts the encoded form", () => {
        expect(findUnparseableParams(FIXED)).toEqual([]);
    });

    it("accepts ordinary single-separator parameters", () => {
        expect(findUnparseableParams("postgresql://u:p@h:5432/db?sslmode=require&connect_timeout=10")).toEqual([]);
    });

    it("accepts a URL with no query at all", () => {
        expect(findUnparseableParams("postgresql://u:p@h:5432/db")).toEqual([]);
    });

    it("ignores a key/value DSN, which is not a URI and has different rules", () => {
        // "host=localhost dbname=app" is perfectly valid libpq input; applying
        // the URI rule to it would report every space-separated pair as broken.
        expect(findUnparseableParams("host=localhost port=5432 dbname=app options=-c search_path=public")).toEqual([]);
    });

    it("ignores non-Postgres URLs", () => {
        expect(findUnparseableParams("mongodb://h:27017/db?a=b=c")).toEqual([]);
    });

    it("reports every offending parameter, not just the first", () => {
        const url = "postgresql://u:p@h/db?options=-c%20a=1&other=x=y";
        expect(findUnparseableParams(url).map(p => p.name)).toEqual(["options", "other"]);
    });

    it("does not treat a fragment as part of the query", () => {
        expect(findUnparseableParams("postgresql://u:p@h/db?sslmode=require#a=b=c")).toEqual([]);
    });
});

describe("encodeExtraEquals", () => {
    it("encodes only the offending separator", () => {
        expect(encodeExtraEquals(BROKEN)).toBe(FIXED);
    });

    it("is a no-op on a URL that is already fine", () => {
        expect(encodeExtraEquals(FIXED)).toBe(FIXED);
        const plain = "postgresql://u:p@h:5432/db?sslmode=require";
        expect(encodeExtraEquals(plain)).toBe(plain);
    });

    it("produces something libpq would accept", () => {
        for (const part of encodeExtraEquals(BROKEN).split("?")[1].split("&")) {
            expect(part.split("=").length).toBe(2);
        }
    });

    it("preserves the meaning of the pin once decoded", () => {
        // Encoding must not change what Postgres is actually told.
        expect(new URL(encodeExtraEquals(BROKEN)).searchParams.get("options"))
            .toBe("-c search_path=public");
    });

    it("leaves %20 alone rather than re-serialising the query", () => {
        // URLSearchParams would write the space as `+`, which node-postgres
        // decodes and libpq does not — swapping one unparseable form for another.
        expect(encodeExtraEquals(BROKEN)).toContain("%20");
        expect(encodeExtraEquals(BROKEN)).not.toContain("+");
    });

    it("keeps parameter order", () => {
        expect(encodeExtraEquals(BROKEN).indexOf("options="))
            .toBeLessThan(encodeExtraEquals(BROKEN).indexOf("sslmode="));
    });
});

describe("scanTextForLibpqUrls", () => {
    it("finds the .env shape", () => {
        const findings = scanTextForLibpqUrls(".env", `JWT_SECRET=abc\nDATABASE_URL=${BROKEN}\nPORT=3001`);
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ file: ".env", variable: "DATABASE_URL", params: ["options"] });
        expect(findings[0].suggested).toBe(FIXED);
    });

    it("finds the docker-compose shape", () => {
        // A deployed stack is broken by this one even when .env has been fixed:
        // the compose file is what the container's backup cron reads.
        const yaml = `    environment:\n      DATABASE_URL: ${BROKEN}\n      NODE_ENV: production`;
        const findings = scanTextForLibpqUrls("docker-compose.yml", yaml);
        expect(findings).toHaveLength(1);
        expect(findings[0].variable).toBe("DATABASE_URL");
    });

    it("finds ADMIN_CONNECTION_STRING too", () => {
        const findings = scanTextForLibpqUrls("docker-compose.yml", `      ADMIN_CONNECTION_STRING: ${BROKEN}`);
        expect(findings.map(f => f.variable)).toEqual(["ADMIN_CONNECTION_STRING"]);
    });

    it("ignores commented-out examples", () => {
        // .env ships several commented sample URLs; a project does not run on them.
        expect(scanTextForLibpqUrls(".env", `# DATABASE_URL=${BROKEN}`)).toEqual([]);
        expect(scanTextForLibpqUrls(".env", `#   DATABASE_URL=${BROKEN}`)).toEqual([]);
    });

    it("handles quoted values", () => {
        expect(scanTextForLibpqUrls(".env", `DATABASE_URL="${BROKEN}"`)).toHaveLength(1);
        expect(scanTextForLibpqUrls(".env", `DATABASE_URL='${BROKEN}'`)).toHaveLength(1);
    });

    it("says nothing about a healthy file", () => {
        expect(scanTextForLibpqUrls(".env", `DATABASE_URL=${FIXED}\nPORT=3001`)).toEqual([]);
    });

    it("does not match a variable that merely ends with the name", () => {
        expect(scanTextForLibpqUrls(".env", `OLD_DATABASE_URL=${BROKEN}`)).toEqual([]);
    });
});
