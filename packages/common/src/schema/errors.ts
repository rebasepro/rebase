/**
 * What is wrong with one table definition.
 *
 * @group Schema
 */
export interface SchemaDefinitionProblem {
    /** The table (or view) the problem is in, by the name it was defined under. */
    table: string;
    /** The column or relation key, when the problem is about one. */
    key?: string;
    /** What is wrong and what to write instead. */
    message: string;
}

/**
 * A schema that cannot be compiled.
 *
 * Thrown by every door that reads `backend/schema` — `rebase db generate`,
 * `db push`, the doctor and server boot — so a definition that would leave a
 * table unprotected or unservable stops all of them the same way. Carries every
 * problem found, not only the first.
 *
 * @group Schema
 */
export class SchemaDefinitionError extends Error {

    readonly code = "SCHEMA_DEFINITION_INVALID";

    constructor(
        /** Every problem found, in declaration order. */
        readonly problems: readonly SchemaDefinitionProblem[]
    ) {
        super(SchemaDefinitionError.describe(problems));
        this.name = "SchemaDefinitionError";
    }

    private static describe(problems: readonly SchemaDefinitionProblem[]): string {
        const lines = problems.map(problem => {
            const where = problem.key ? `${problem.table}.${problem.key}` : problem.table;
            return `  - ${where}: ${problem.message}`;
        });
        const count = problems.length === 1 ? "1 problem" : `${problems.length} problems`;
        return `The schema cannot be used (${count}):\n${lines.join("\n")}`;
    }
}

/**
 * Whether an error is a {@link SchemaDefinitionError}, from this copy of the
 * package or another.
 *
 * @group Schema
 */
export function isSchemaDefinitionError(error: unknown): error is SchemaDefinitionError {
    return typeof error === "object" && error !== null && "code" in error && error.code === "SCHEMA_DEFINITION_INVALID";
}
