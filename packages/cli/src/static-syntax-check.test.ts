/**
 * The pre-deploy syntax check over a static app's output.
 *
 * The fixture is the shape of the site that went down: plain HTML and `.js`
 * copied into the output folder by a "build" that never parsed anything, one
 * file of which did not parse. Written to a temporary directory rather than
 * committed, because a committed file that does not parse is one the repo's own
 * lint would trip over.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkStaticSyntax, findSyntaxError, formatSyntaxErrors, inlineScripts } from "./static-syntax-check";

let project: string;

function write(relative: string, content: string): void {
    const file = path.join(project, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

function check(dir = "web") {
    return checkStaticSyntax(path.join(project, dir), project);
}

beforeEach(() => {
    project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-syntax-")));
});

afterEach(() => {
    fs.rmSync(project, { recursive: true,
force: true });
});

describe("a static site with a broken script", () => {
    beforeEach(() => {
        write("web/index.html", "<!doctype html>\n<script src=\"cloud.js\"></script>\n");
        write("web/app.js", "export function start() {\n    return 1;\n}\n");
        // The SongBuzz break: an edit that left a brace unclosed.
        write("web/cloud.js", [
            "const API = \"/api\";",
            "export async function connect() {",
            "    const res = await fetch(API;",
            "    return res.json();",
            "}",
            ""
        ].join("\n"));
    });

    it("fails, naming the file, line and column", () => {
        const { errors, checked } = check();

        expect(checked).toBe(2);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ file: "web/cloud.js",
line: 3,
column: 32 });
        expect(errors[0].message).toMatch(/Unexpected token/);
        expect(errors[0].excerpt).toBe("    const res = await fetch(API;");
    });

    it("prints file:line:column and the line itself", () => {
        expect(formatSyntaxErrors(check().errors)).toEqual([
            "web/cloud.js:3:32  Unexpected token",
            "    3 |     const res = await fetch(API;"
        ]);
    });
});

describe("what parses", () => {
    it("passes classic scripts, modules and CommonJS that are valid", () => {
        // Sloppy-mode only: a module parse alone would reject `with`.
        write("web/legacy.js", "with (Math) { var x = max(1, 2); }\n");
        write("web/esm.js", "import { a } from \"./a.js\";\nexport const b = await a();\n");
        write("web/lib.mjs", "export default 1;\n");
        write("web/node.cjs", "#!/usr/bin/env node\nif (!module) return;\nmodule.exports = 1;\n");

        expect(check()).toEqual({ checked: 4,
errors: [] });
    });

    it("reports a module's real mistake, not that `import` needs a module", () => {
        write("web/main.js", "import x from \"./x.js\";\nexport const y = ;\n");

        const [error] = check().errors;
        expect(error).toMatchObject({ file: "web/main.js",
line: 2,
column: 18 });
        expect(error.message).not.toMatch(/sourceType/);
    });

    it("parses .mjs as a module only", () => {
        write("web/a.mjs", "with (Math) {}\n");
        expect(check().errors).toHaveLength(1);
    });

    it("leaves node_modules alone", () => {
        write("web/node_modules/pkg/index.js", "this is not javascript");
        expect(check()).toEqual({ checked: 0,
errors: [] });
    });

    it("shows a neighbourhood of a minified line, not the whole of it", () => {
        write("web/bundle.js", `${"var a=1;".repeat(200)}var b=;${"var c=1;".repeat(200)}`);
        const [error] = check().errors;
        expect(error.line).toBe(1);
        expect(error.excerpt!.length).toBeLessThan(130);
        expect(error.excerpt).toContain("var b=;");
    });
});

describe("inline scripts", () => {
    it("are checked and located in the HTML file", () => {
        write("web/index.html", [
            "<!doctype html>",
            "<html>",
            "<body>",
            "  <script>",
            "    window.ok = true;",
            "    let broken = ;",
            "  </script>",
            "</body>",
            "</html>",
            ""
        ].join("\n"));

        const [error] = check().errors;
        expect(error).toMatchObject({ file: "web/index.html",
line: 6,
column: 18 });
        expect(error.message).toContain("inline <script>");
    });

    it("are located on the tag's own line when the error is there", () => {
        write("web/index.html", "<p>hi</p><script type=\"module\">import x from \"y\"; x(;</script>\n");
        const [error] = check().errors;
        expect(error).toMatchObject({ line: 1,
column: 53 });
        expect(error.message).toContain("type=\"module\"");
    });

    it("skip what a browser does not run as JavaScript", () => {
        write("web/index.html", [
            "<script type=\"application/json\">{\"a\": 1,}</script>",
            "<script type=\"importmap\">{ \"imports\": {} }</script>",
            "<script type=\"application/ld+json\">{ broken</script>",
            "<script type=\"text/template\"><div>{{ name }}</div></script>",
            "<script type=\"text/x-handlebars-template\">{{#each}}</script>",
            "<script src=\"a.js\">not run, so not checked</script>",
            "<script data-src=\"x\">window.checked = true;</script>",
            "<!-- <script>commented out (</script> -->",
            ""
        ].join("\n"));

        expect(check()).toEqual({ checked: 1,
errors: [] });
    });

    it("skip a script a server-side template has not rendered yet", () => {
        write("web/page.html", "<script>window.user = {{ user | json }};</script>\n");
        expect(check().errors).toEqual([]);
    });

    it("keep their line numbers past a multi-line comment", () => {
        const html = "<!--\none\ntwo\n-->\n<script>\nx(;\n</script>\n";
        expect(inlineScripts(html)).toEqual([{ source: "\nx(;\n",
kind: "script",
line: 5,
column: 8 }]);
    });
});

describe("findSyntaxError", () => {
    it("answers null for a valid source in either mode", () => {
        expect(findSyntaxError("var a = 1;", "auto")).toBeNull();
        expect(findSyntaxError("export {}", "auto")).toBeNull();
    });

    it("rejects module syntax in a classic script", () => {
        expect(findSyntaxError("export {}", "script")).not.toBeNull();
    });
});
