/**
 * find-hardcoded-strings.ts
 *
 * Scans all .tsx files under packages/ (excluding node_modules, dist, __tests__)
 * for hardcoded user-facing strings that should be translated via useTranslation().
 *
 * Usage:
 *   npx tsx scripts/find-hardcoded-strings.ts
 *   npx tsx scripts/find-hardcoded-strings.ts --json   # machine-readable output
 */

import * as fs from "fs";
import * as path from "path";

// ─── Configuration ──────────────────────────────────────────────────────────

const SCAN_ROOT = path.resolve(__dirname, "../packages");

const EXCLUDE_DIRS = new Set([
    "node_modules",
    "dist",
    "__tests__",
    "__mocks__",
    ".turbo",
    "test",
    "tests",
]);

const FILE_EXTENSIONS = [".tsx"];

/**
 * Strings that are NOT user-facing and should be ignored.
 * These are things like CSS class names, HTML attributes, log keys, etc.
 */
const IGNORE_PATTERNS: RegExp[] = [
    // Import/require strings
    /^import\s/,
    /^export\s/,
    /from\s+["']/,
    /require\(/,

    // Console / debug
    /console\.(log|warn|error|info|debug)\(/,

    // CSS / className / style
    /className[=:{]/,
    /style[=:{]/,
    /tw`/,

    // Data attributes, HTML attributes
    /data-[\w-]+=/,
    /aria-[\w-]+=/,
    /role="/,
    /type="/,
    /htmlFor="/,
    /target="/,
    /rel="/,
    /href="/,
    /src="/,

    // Key / ID props (not user-facing)
    /\bkey\s*=\s*{?"/,
    /\bid\s*=\s*"/,
    /\bname\s*=\s*"/,
    /\bsize\s*=\s*"/,
    /\bvariant\s*=\s*"/,
    /\bcolor\s*=\s*"/,
    /\bcomponent\s*=\s*"/,
    /\bposition\s*=\s*"/,
    /\banchor\s*=\s*"/,
    /\bplaceholder\s*=\s*"/,  // Sometimes user-facing, but often technical

    // Event handlers
    /\bon[A-Z]\w+\s*=\s*{/,

    // Type annotations / interfaces
    /:\s*(string|number|boolean|any|void|never|unknown)/,
    /interface\s/,
    /type\s+\w+/,

    // Comparisons with technical values
    /===?\s*["'](undefined|null|true|false|GET|POST|PUT|DELETE|PATCH)/,

    // Translation key already used
    /\bt\(["']/,
    /\bt\s*\(\s*["']/,

    // Object keys / property access (very common in configs)
    /\w+:\s*["'][\w._-]+["']\s*[,}]/,
];

/**
 * Common technical-only string values that aren't user-facing.
 */
const TECHNICAL_VALUES = new Set([
    "div", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6",
    "button", "input", "form", "label", "select", "option", "textarea",
    "ul", "ol", "li", "a", "img", "svg", "path",
    "text", "number", "password", "email", "checkbox", "radio", "submit",
    "flex", "block", "inline", "grid", "none", "auto", "inherit",
    "left", "right", "center", "top", "bottom",
    "small", "medium", "large", "xs", "sm", "md", "lg", "xl",
    "primary", "secondary", "error", "warning", "info", "success",
    "default", "outlined", "contained", "filled", "standard",
    "row", "column", "wrap",
    "absolute", "relative", "fixed", "sticky",
    "pointer", "text", "default", "move",
    "GET", "POST", "PUT", "DELETE", "PATCH",
    "asc", "desc", "ASC", "DESC",
    "true", "false", "null", "undefined",
    "px", "em", "rem", "%", "vh", "vw",
    "rgb", "rgba", "hsl", "hsla",
    "utf-8", "UTF-8",
    "application/json",
    "mousedown", "mouseup", "mousemove", "click", "keydown", "keyup",
    "en", "es", "de", "fr", "it", "pt", "hi",
    "rebase_core",
    "string", "number", "boolean", "map", "array", "date", "timestamp",
    "firestore", "rtdb", "storage",
    "table", "board", "cards", "list",
]);

// ─── String Extraction ─────────────────────────────────────────────────────

interface HardcodedString {
    file: string;
    line: number;
    column: number;
    value: string;
    context: string;   // the surrounding line content
    category: "jsx-text" | "jsx-attr" | "template-literal" | "string-literal";
}

function walkDir(dir: string, files: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (EXCLUDE_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walkDir(full, files);
        } else if (FILE_EXTENSIONS.some(ext => entry.name.endsWith(ext))) {
            files.push(full);
        }
    }
    return files;
}

function isUserFacingString(value: string): boolean {
    const trimmed = value.trim();
    if (trimmed.length < 2) return false;

    // Ignore purely numeric/symbolic strings
    if (/^[\d\s.,;:!?#@$%^&*()\-+=\[\]{}|\\/<>~`]+$/.test(trimmed)) return false;

    // Ignore technical values
    if (TECHNICAL_VALUES.has(trimmed)) return false;
    if (TECHNICAL_VALUES.has(trimmed.toLowerCase())) return false;

    // Ignore camelCase / snake_case identifiers (likely code keys, not UI strings)
    if (/^[a-z][a-zA-Z0-9]*$/.test(trimmed) && trimmed.length < 30) return false; // camelCase
    if (/^[a-z][a-z0-9_]*$/.test(trimmed) && trimmed.length < 30) return false; // snake_case
    if (/^[A-Z][A-Z0-9_]*$/.test(trimmed) && trimmed.length < 30) return false; // CONSTANT_CASE
    if (/^[A-Z][a-zA-Z0-9]*$/.test(trimmed) && trimmed.length < 15) return false; // PascalCase (component names)

    // Ignore CSS-like values
    if (/^-?\d+(\.\d+)?(px|em|rem|%|vh|vw|deg|s|ms)$/.test(trimmed)) return false;
    if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return false;
    if (/^(rgb|rgba|hsl|hsla)\(/.test(trimmed)) return false;

    // Ignore URLs
    if (/^https?:\/\//.test(trimmed)) return false;
    if (/^mailto:/.test(trimmed)) return false;
    if (/^\/[\w-]/.test(trimmed) && !trimmed.includes(" ")) return false; // path-like

    // Ignore file extensions / mime types
    if (/^\.\w+$/.test(trimmed)) return false;
    if (/^[\w]+\/[\w\-+.]+$/.test(trimmed)) return false;

    // Ignore template literal expressions only (like `${foo}`)
    if (/^\$\{.*\}$/.test(trimmed)) return false;

    // Ignore dot-path accessors (e.g. "some.nested.key")
    if (/^[\w]+\.[\w]+/.test(trimmed) && !trimmed.includes(" ")) return false;

    // Good heuristic: contains at least one space OR starts with uppercase and has >3 chars
    // (most user-facing strings are natural language)
    const hasSpaces = trimmed.includes(" ");
    const startsWithUpper = /^[A-Z]/.test(trimmed);
    const hasLowercase = /[a-z]/.test(trimmed);

    if (hasSpaces && hasLowercase) return true;
    if (startsWithUpper && hasLowercase && trimmed.length > 3) return true;

    // Single words that start with uppercase and are long enough
    if (startsWithUpper && trimmed.length >= 4 && hasLowercase) return true;

    return false;
}

function findHardcodedStringsInFile(filePath: string): HardcodedString[] {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const results: HardcodedString[] = [];
    const relPath = path.relative(SCAN_ROOT, filePath);

    // Check if file already imports useTranslation
    const hasTranslation = /useTranslation/.test(content);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;

        // Skip comment lines
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith("//") || trimmedLine.startsWith("*") || trimmedLine.startsWith("/*")) continue;

        // Skip lines matching ignore patterns
        if (IGNORE_PATTERNS.some(p => p.test(trimmedLine))) continue;

        // ─── 1. JSX text content: >Some text here< ───────────────────────
        // Match text between JSX closing > and opening <
        const jsxTextMatches = line.matchAll(/>\s*([A-Z][^<>{}\n]*?)\s*</g);
        for (const match of jsxTextMatches) {
            const value = match[1].trim();
            if (isUserFacingString(value) && !value.includes("{")) {
                results.push({
                    file: relPath,
                    line: lineNum,
                    column: (match.index ?? 0) + 1,
                    value,
                    context: trimmedLine,
                    category: "jsx-text",
                });
            }
        }

        // ─── 2. JSX string attributes: title="Some text" / label="Some text" ──
        // Focus on attributes likely to contain user-facing text
        const userFacingAttrs = [
            "title", "label", "placeholder", "helperText", "helper_text",
            "tooltip", "description", "message", "errorMessage", "error",
            "confirmText", "cancelText", "text", "caption", "subtitle",
            "heading", "subheading", "noEntriesText", "emptyText",
            "dialogTitle", "dialogBody", "submitLabel", "buttonText",
            "aria-label", "alt",
        ];
        const attrPattern = new RegExp(
            `(?:${userFacingAttrs.join("|")})\\s*=\\s*"([^"]*)"`,
            "g"
        );
        const attrMatches = line.matchAll(attrPattern);
        for (const match of attrMatches) {
            const value = match[1].trim();
            if (isUserFacingString(value)) {
                results.push({
                    file: relPath,
                    line: lineNum,
                    column: (match.index ?? 0) + 1,
                    value,
                    context: trimmedLine,
                    category: "jsx-attr",
                });
            }
        }

        // ─── 3. String literals in JSX expressions: {"Some text"} ─────────
        const jsxExprStrMatches = line.matchAll(/\{["']([^"']+)["']\}/g);
        for (const match of jsxExprStrMatches) {
            const value = match[1].trim();
            if (isUserFacingString(value)) {
                // Check it's not already inside t()
                const before = line.substring(0, match.index ?? 0);
                if (!/\bt\s*\(\s*$/.test(before)) {
                    results.push({
                        file: relPath,
                        line: lineNum,
                        column: (match.index ?? 0) + 1,
                        value,
                        context: trimmedLine,
                        category: "string-literal",
                    });
                }
            }
        }

        // ─── 4. Common patterns: snackbar messages, alert text, etc. ──────
        const messagePatterns = [
            /(?:snackbar|toast|alert|notify|message)\s*\(\s*["']([^"']+)["']/gi,
            /(?:setError|setMessage|setTitle|setLabel)\s*\(\s*["']([^"']+)["']/gi,
            /(?:error|message|title|label)\s*:\s*["']([^"']+)["']/gi,
        ];
        for (const pattern of messagePatterns) {
            const matches = line.matchAll(pattern);
            for (const match of matches) {
                const value = match[1].trim();
                if (isUserFacingString(value)) {
                    // Check it's not already inside t()
                    const before = line.substring(0, match.index ?? 0);
                    if (!/\bt\s*\(\s*$/.test(before)) {
                        results.push({
                            file: relPath,
                            line: lineNum,
                            column: (match.index ?? 0) + 1,
                            value,
                            context: trimmedLine,
                            category: "string-literal",
                        });
                    }
                }
            }
        }
    }

    return results;
}

// ─── Deduplication ──────────────────────────────────────────────────────────

function dedup(results: HardcodedString[]): HardcodedString[] {
    const seen = new Set<string>();
    return results.filter(r => {
        const key = `${r.file}:${r.line}:${r.value}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
    const jsonMode = process.argv.includes("--json");
    const files = walkDir(SCAN_ROOT);

    let allResults: HardcodedString[] = [];

    for (const file of files) {
        const results = findHardcodedStringsInFile(file);
        allResults.push(...results);
    }

    allResults = dedup(allResults);

    // Sort by file, then line
    allResults.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

    if (jsonMode) {
        console.log(JSON.stringify(allResults, null, 2));
        return;
    }

    // ─── Pretty output ────────────────────────────────────────────────
    const byFile = new Map<string, HardcodedString[]>();
    for (const r of allResults) {
        const arr = byFile.get(r.file) ?? [];
        arr.push(r);
        byFile.set(r.file, arr);
    }

    console.log(`\n🔍 Hardcoded String Scanner`);
    console.log(`${"═".repeat(60)}`);
    console.log(`Scanned ${files.length} files, found ${allResults.length} potential hardcoded strings in ${byFile.size} files.\n`);

    for (const [file, items] of byFile) {
        console.log(`\n📄 ${file}`);
        console.log(`${"─".repeat(60)}`);
        for (const item of items) {
            const tag = `[${item.category}]`.padEnd(18);
            console.log(`  L${String(item.line).padStart(4)}  ${tag}  "${item.value}"`);
        }
    }

    console.log(`\n${"═".repeat(60)}`);
    console.log(`Total: ${allResults.length} hardcoded strings across ${byFile.size} files.`);
    console.log(`\nTo get JSON output: npx tsx scripts/find-hardcoded-strings.ts --json\n`);
}

main();
