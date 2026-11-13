/**
 * What a `col.custom()` type may be: the shape of a Postgres type name, which
 * DDL writes verbatim. Shared by the compiler (`checkColumnDef`) and the
 * planner, which refuses it again for a definition no compiler checked.
 */

// ── A custom type, as DDL may name it ────────────────────────────────────────

/** One token of a type name: a word, a quoted identifier, `.`, a modifier list, `[]`. */
const CUSTOM_TYPE_TOKEN = /\s*(?:([A-Za-z_][A-Za-z0-9_$]*)|("(?:[^"]|"")+")|(\.)|(\(\s*[A-Za-z0-9_+\-.]+\s*(?:,\s*[A-Za-z0-9_+\-.]+\s*)*\))|(\[\d*\]))/y;

/**
 * Why a `col.custom(sqlType)` type cannot be written into DDL, or `undefined`
 * when it can.
 *
 * The type is written verbatim — into `CREATE TABLE`, `ADD COLUMN` and the
 * Drizzle file — so only the shape of a Postgres type name is accepted, and
 * nothing in it can end the statement or open a string:
 *
 * - words, separated by spaces (`timestamp without time zone`,
 *   `double precision`), or double-quoted identifiers (`"My Type"`);
 * - one schema qualifier (`public.citext`, `"geo"."point3"`);
 * - a modifier list after a word, of words, numbers and signs separated by
 *   commas (`geometry(Point, 4326)`, `numeric(10, 2)`, `timestamp(3)`);
 * - array brackets at the end (`inet[]`, `int4range[][]`, `text[3]`).
 *
 * Anything else is refused: a single quote, a semicolon, a comment, an
 * operator, an unbalanced bracket, more than 200 characters. A column clause
 * written after the name (`inet DEFAULT x`, `inet NOT NULL`) has the shape of
 * more words, so the words that begin one are refused by name.
 *
 * @group Schema
 */
export function customSqlTypeProblem(sqlType: string): string | undefined {
    const text = sqlType.trim();
    if (text.length === 0) return "is empty";
    if (text.length > 200) return "is longer than 200 characters";
    let state: "start" | "name" | "dot" | "modified" | "array" = "start";
    const words: string[] = [];
    CUSTOM_TYPE_TOKEN.lastIndex = 0;
    let position = 0;
    while (position < text.length) {
        CUSTOM_TYPE_TOKEN.lastIndex = position;
        const match = CUSTOM_TYPE_TOKEN.exec(text);
        if (!match || match[0].length === 0) return `cannot be read as a type name at "${text.slice(position)}"`;
        position = CUSTOM_TYPE_TOKEN.lastIndex;
        const [, word, quoted, dot, modifiers, brackets] = match;
        if (word !== undefined || quoted !== undefined) {
            if (state === "array") return "has a word after its array brackets";
            if (word !== undefined) words.push(word.toLowerCase());
            state = "name";
        } else if (dot !== undefined) {
            if (state !== "name") return "has a `.` that does not separate a schema from a type";
            state = "dot";
        } else if (modifiers !== undefined) {
            if (state !== "name") return "has a modifier list that follows no type name";
            state = "modified";
        } else if (brackets !== undefined) {
            if (state === "start" || state === "dot") return "has array brackets that follow no type name";
            state = "array";
        }
    }
    if (state === "start" || state === "dot") return "ends without a type name";
    const clause = words.find(word => CLAUSE_WORDS.has(word));
    if (clause !== undefined) return `holds \`${clause}\`, which starts a column clause, not a type`;
    return undefined;
}

/** Words that begin a column clause after a type — never part of a type name. */
const CLAUSE_WORDS: ReadonlySet<string> = new Set([
    "default", "not", "null", "constraint", "references", "check", "unique", "primary", "generated", "collate", "using"
]);
