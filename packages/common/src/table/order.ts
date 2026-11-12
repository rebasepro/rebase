/**
 * The order every generated file is written in.
 *
 * @module
 */

/**
 * The tables in slug order (`localeCompare`), as a new array.
 *
 * Slug order is part of the generated output, not a nicety: the schema files,
 * the policy file and the boot plan emit in input order (enums and junction
 * tables interleave with the tables that declare them), so a planner caller
 * sorts with this before it plans. Generic over anything carrying a
 * descriptor — a `CompiledTable`, a server-postgres `RuntimeTable`.
 *
 * @param tables the tables, in any order.
 * @returns the same tables, sorted by `descriptor.slug`.
 * @group Schema
 */
export function sortTablesBySlug<T extends { descriptor: { slug: string } }>(tables: readonly T[]): T[] {
    return [...tables].sort((a, b) => a.descriptor.slug.localeCompare(b.descriptor.slug));
}
