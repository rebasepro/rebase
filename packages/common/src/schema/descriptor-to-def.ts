/**
 * From a {@link TableDescriptor} back to the definition that compiles to it.
 *
 * The printer reads descriptors and the lowering reads definitions; a
 * descriptor nobody authored — what `introspectTables` reports for a database
 * no project declared — reaches the lowering through here, at the same
 * boundary a declared table crosses at boot.
 *
 * The definition states every derived name explicitly (`localKey`,
 * `foreignKey`, `through`, …) rather than leaving it to be re-derived, so it
 * means exactly what the descriptor says. A foreign-key column the descriptor
 * marks `derived` is left to its relation, as the printer leaves it, with its
 * nullability and uniqueness on the relation.
 *
 * @module
 */
import {
    ColumnBuilder,
    defineTable,
    defineView,
    rel,
    type AnyColumn,
    type AnyTableDef,
    type AnyViewDef,
    type ColumnDef,
    type ColumnDescriptor,
    type RelationDef,
    type RelationDescriptor,
    type RlsDescriptor,
    type RlsPosture,
    type TableDescriptor
} from "@rebasepro/types";

import { SchemaDefinitionError, type SchemaDefinitionProblem } from "./errors";

/**
 * A descriptor column, as the definition that compiles to it.
 *
 * @group Schema
 */
export function columnDefOfDescriptor(column: ColumnDescriptor): ColumnDef {
    const def: ColumnDef = {
        type: column.type,
        column: column.column,
        notNull: !column.nullable,
        primaryKey: column.primaryKey === true,
        unique: column.unique === true,
        readOnly: column.readOnly === true,
        private: column.private === true
    };
    if (column.default !== undefined) def.default = column.default;
    if (column.generated !== undefined) def.generatedAs = column.generated.expression;
    if (column.access !== undefined) def.access = column.access;
    if (column.stamp !== undefined) def.stamp = column.stamp;
    if (column.validate !== undefined) def.validate = column.validate;
    if (column.oneOf !== undefined) def.oneOf = column.oneOf;
    if (column.description !== undefined) def.description = column.description;
    if (column.storage !== undefined) def.storage = column.storage;
    if (column.semantic !== undefined) def.semantic = column.semantic;
    if (column.vectorIndex !== undefined) def.vectorIndex = column.vectorIndex;
    if (column.json !== undefined) def.json = column.json;
    if (column.type.kind === "array") {
        const element: ColumnDef = {
            type: column.type.of,
            notNull: false,
            primaryKey: false,
            unique: false,
            readOnly: false,
            private: false
        };
        if (column.element?.validate !== undefined) element.validate = column.element.validate;
        if (column.element?.oneOf !== undefined) element.oneOf = column.element.oneOf;
        if (column.element?.storage !== undefined) element.storage = column.element.storage;
        if (column.element?.semantic !== undefined) element.semantic = column.element.semantic;
        def.element = element;
    }
    return def;
}

/**
 * Options of {@link tableDefsFromDescriptors}.
 *
 * @group Schema
 */
export interface TableDefsFromDescriptorsOptions {
    /**
     * The `rls` each definition is given in place of the one its descriptor
     * states. For a caller whose tables' access the database decides and that
     * lowers them only to serve them — introspection, where Rebase generates no
     * policy, so the request-time collection carries no rule (`"admin-only"`
     * lowers to none) while the descriptor keeps stating the catalogue's.
     */
    rls?: (descriptor: TableDescriptor) => RlsPosture;
}

/** A descriptor column as a builder, so `defineTable` accepts it. */
const builderOf = (column: ColumnDescriptor): AnyColumn => new ColumnBuilder(columnDefOfDescriptor(column));

/** Where a problem is, for the error. */
class ConversionProblem extends Error {
    constructor(readonly problem: SchemaDefinitionProblem) {
        super(problem.message);
    }
}

/**
 * A descriptor's row-level security as a definition's `rls` (and
 * `defaultPolicies`), or a problem when no definition can say it.
 */
function rlsOf(descriptor: TableDescriptor, rls: RlsDescriptor): { rls: RlsPosture; defaultPolicies?: false } {
    const rules = rls.rules;
    if (rls.posture === "admin-only") return { rls: "admin-only" };
    if (rules.length > 0) {
        const posture: RlsPosture = [rules[0], ...rules.slice(1)];
        return rls.defaultPolicies ? { rls: posture } : { rls: posture, defaultPolicies: false };
    }
    if (rls.defaultPolicies) return { rls: "admin-only" };
    throw new ConversionProblem({
        table: descriptor.name,
        message: "has row-level security with no rule and no admin baseline, so nobody may read a row. " +
            "`defineTable` does not write a table nobody may read: list the rules that grant access, or say \"admin-only\"."
    });
}

/** A descriptor relation as the `rel.*` definition that resolves to it. */
function relationOf(
    relation: RelationDescriptor,
    owner: TableDescriptor,
    target: () => AnyTableDef | AnyViewDef
): RelationDef {
    const access = {
        ...(relation.access !== undefined ? { access: relation.access } : {}),
        ...(relation.private === true ? { private: true } : {})
    };
    switch (relation.kind) {
        case "belongsTo": {
            const derived = owner.columns.find(column => column.key === relation.localField && column.derived === true);
            return rel.belongsTo(target, {
                localKey: relation.localKey,
                ...(derived && !derived.nullable ? { notNull: true } : {}),
                ...(derived?.unique ? { unique: true } : {}),
                ...(relation.onDelete !== undefined ? { onDelete: relation.onDelete } : {}),
                ...(relation.onUpdate !== undefined ? { onUpdate: relation.onUpdate } : {}),
                ...(relation.index ? {} : { index: false }),
                ...(relation.constraint ? {} : { constraint: false }),
                ...access
            });
        }
        case "hasOne":
            return rel.hasOne(target, {
                foreignKey: relation.foreignKey,
                ...(relation.sourceKey !== undefined ? { sourceKey: relation.sourceKey } : {}),
                ...access
            });
        case "hasMany":
            return rel.hasMany(target, {
                foreignKey: relation.foreignKey,
                ...(relation.sourceKey !== undefined ? { sourceKey: relation.sourceKey } : {}),
                ...(relation.orderBy !== undefined ? { orderBy: relation.orderBy } : {}),
                ...access
            });
        case "manyToMany": {
            const pivot: Record<string, AnyColumn> = {};
            for (const column of relation.through.pivot) pivot[column.key] = builderOf(column);
            return rel.manyToMany(target, {
                through: relation.through.table,
                sourceKey: relation.through.sourceKey,
                targetKey: relation.through.targetKey,
                ...(relation.through.pivot.length > 0 ? { pivot } : {}),
                ...(relation.onDelete !== undefined ? { onDelete: relation.onDelete } : {}),
                ...access
            });
        }
        case "via":
            return rel.via(target, { steps: relation.steps, cardinality: relation.cardinality, ...access });
    }
}

/** One descriptor as a definition, its relations' targets resolved through `resolve`. */
function defOf(descriptor: TableDescriptor, resolve: (slug: string) => AnyTableDef | AnyViewDef, options: TableDefsFromDescriptorsOptions): AnyTableDef | AnyViewDef {
    if (descriptor.auth !== undefined) {
        throw new ConversionProblem({
            table: descriptor.name,
            message: "is an auth table. `defineAuthTable` adds the auth columns and policies itself; print the descriptor instead of converting it."
        });
    }
    const declared = Object.keys(descriptor.hooks ?? {});
    if (declared.length > 0) {
        throw new ConversionProblem({
            table: descriptor.name,
            message: `declares hooks (${declared.join(", ")}), whose code never leaves the server; a descriptor cannot be turned back into them.`
        });
    }
    const columns: Record<string, AnyColumn> = {};
    for (const column of descriptor.columns) {
        if (column.derived === true) continue;
        columns[column.key] = builderOf(column);
    }
    const relations: Record<string, RelationDef> = {};
    for (const relation of descriptor.relations) {
        relations[relation.name] = relationOf(relation, descriptor, () => resolve(relation.target));
    }
    const common = {
        ...(descriptor.slug !== descriptor.name ? { slug: descriptor.slug } : {}),
        ...(descriptor.table !== descriptor.name ? { table: descriptor.table } : {}),
        ...(descriptor.schema !== "public" ? { schema: descriptor.schema } : {}),
        ...(descriptor.database !== undefined ? { database: descriptor.database } : {}),
        ...(descriptor.description !== undefined ? { description: descriptor.description } : {}),
        columns,
        ...(descriptor.relations.length > 0 ? { relations } : {}),
        ...(descriptor.indexes !== undefined ? { indexes: descriptor.indexes } : {}),
        ...(descriptor.metadata !== undefined ? { metadata: descriptor.metadata } : {})
    };
    if (descriptor.kind === "view") {
        const view = descriptor.view;
        if (view?.query === undefined) {
            throw new ConversionProblem({
                table: descriptor.name,
                message: "is a view whose descriptor carries no query (it is served to admins only). Convert a descriptor that includes it."
            });
        }
        return defineView(descriptor.name, {
            ...common,
            query: view.query,
            ...(view.materialized ? { materialized: true } : {}),
            ...(view.materialized && view.roles !== undefined ? { roles: view.roles } : {})
        });
    }
    const rls = options.rls ? { rls: options.rls(descriptor) } : rlsOf(descriptor, descriptor.rls);
    return defineTable(descriptor.name, {
        ...common,
        ...rls,
        ...(descriptor.tenant !== undefined ? { tenant: descriptor.tenant } : {}),
        ...(descriptor.softDelete !== undefined ? { softDelete: descriptor.softDelete } : {}),
        ...(descriptor.history !== undefined ? { history: descriptor.history } : {}),
        ...(descriptor.search !== undefined ? { search: descriptor.search } : {}),
        ...(descriptor.strictWrites === false ? { strictWrites: false } : {})
    });
}

/**
 * Definitions for a set of descriptors, in the order given: what
 * `compileTables` compiles back to the same descriptors (derived names and
 * defaults stated explicitly) and what `lowerTables` lowers.
 *
 * A relation's target is resolved by slug among `descriptors`, lazily, so two
 * tables may point at each other. Throws a {@link SchemaDefinitionError}
 * listing every descriptor no definition can state: an auth table, a table
 * with hooks, a view without its query, row-level security that grants nobody
 * anything (unless `options.rls` replaces it), and whatever `defineTable`
 * itself refuses. A target outside the set is a problem when the thunk is
 * called.
 *
 * @group Schema
 */
export function tableDefsFromDescriptors(
    descriptors: readonly TableDescriptor[],
    options: TableDefsFromDescriptorsOptions = {}
): (AnyTableDef | AnyViewDef)[] {
    const bySlug = new Map<string, AnyTableDef | AnyViewDef>();
    const resolve = (slug: string): AnyTableDef | AnyViewDef => {
        const def = bySlug.get(slug);
        if (!def) {
            throw new SchemaDefinitionError([{ table: slug, message: "is the target of a relation, and no descriptor in the set has that slug." }]);
        }
        return def;
    };
    const problems: SchemaDefinitionProblem[] = [];
    const out: (AnyTableDef | AnyViewDef)[] = [];
    for (const descriptor of descriptors) {
        try {
            const def = defOf(descriptor, resolve, options);
            bySlug.set(descriptor.slug, def);
            out.push(def);
        } catch (error) {
            if (error instanceof ConversionProblem) problems.push(error.problem);
            else problems.push({ table: descriptor.name, message: error instanceof Error ? error.message : String(error) });
        }
    }
    if (problems.length > 0) throw new SchemaDefinitionError(problems);
    return out;
}
