/**
 * `pg/lib/utils`, which pg exports (`./lib/*` in its `exports`) and
 * `@types/pg` does not describe: how pg turns a JS value into the text it
 * sends for a parameter. `pipelined-transaction.ts` serializes with it so a
 * value means the same in a batch as in any other query.
 */
declare module "pg/lib/utils.js" {
    /** A parameter value as pg sends it: text, bytes for a Buffer, or SQL NULL. */
    export function prepareValue(value: unknown): string | Buffer | null;
}
