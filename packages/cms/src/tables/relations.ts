/**
 * A table's relations as the panel's relation properties.
 *
 * Each relation becomes a `type: "relation"` property keyed by the relation's
 * name — the documented way an authored collection declares one, and the key
 * saved layouts, `include` and the entity tabs address it by. The panel then
 * does what it does for an authored collection: a to-one relation is a
 * reference picker, a to-many one is a tab in the entity view
 * (`getEntityChildViews`), with the redundant picker beside it hidden.
 */
import type {
    ColumnDescriptor,
    RelationDescriptor,
    TableDescriptor
} from "@rebasepro/types";
import type {
    AnyCollectionConfig,
    Properties,
    Relation,
    RelationProperty
} from "@rebasepro/cms-types";
import { labelFromIdentifier } from "@rebasepro/utils";

import { propertyFromColumn } from "./column_property";

/**
 * The tables a relation may point at: whether one was served, and the
 * collection it projects to. `has` must not project anything, so a table can
 * point at itself.
 */
export interface TargetResolver {
    has(slug: string): boolean;
    get(slug: string): AnyCollectionConfig | undefined;
}

/**
 * A relation, projected: its property, and — for a `belongsTo` — the key of
 * the foreign-key column it stands in for.
 */
export interface ProjectedRelation {
    /** The relation's name: the property key. */
    key: string;
    property: RelationProperty;
    /**
     * The column the relation replaces in the form and the table. Set for a
     * `belongsTo` whose foreign key is not part of the primary key: the picker
     * edits that column, so the raw key is not rendered as a second field.
     */
    replacesColumn?: string;
}

function pivotProperties(pivot: readonly ColumnDescriptor[]): Properties {
    const properties: Properties = {};
    for (const column of pivot) {
        const property = propertyFromColumn(column, { primaryKey: [] });
        if (property) properties[column.key] = property;
    }
    return properties;
}

function relationFrom(relation: RelationDescriptor, target: () => AnyCollectionConfig): Relation {
    const shared = { relationName: relation.name, target };
    switch (relation.kind) {
        case "belongsTo":
            return {
                ...shared,
                kind: "belongsTo",
                localKey: relation.localKey,
                index: relation.index,
                ...(relation.onDelete ? { onDelete: relation.onDelete } : {}),
                ...(relation.onUpdate ? { onUpdate: relation.onUpdate } : {})
            };
        case "hasOne":
            return {
                ...shared,
                kind: "hasOne",
                foreignKeyOnTarget: relation.foreignKey,
                ...(relation.sourceKey ? { sourceKey: relation.sourceKey } : {})
            };
        case "hasMany":
            return {
                ...shared,
                kind: "hasMany",
                foreignKeyOnTarget: relation.foreignKey,
                ...(relation.sourceKey ? { sourceKey: relation.sourceKey } : {})
            };
        case "manyToMany":
            return {
                ...shared,
                kind: "manyToMany",
                through: {
                    table: relation.through.table,
                    sourceColumn: relation.through.sourceKey,
                    targetColumn: relation.through.targetKey,
                    properties: pivotProperties(relation.through.pivot)
                },
                ...(relation.onDelete ? { onDelete: relation.onDelete } : {})
            };
        case "via":
            return {
                ...shared,
                kind: "via",
                cardinality: relation.cardinality,
                joinPath: relation.steps.map(step => ({ ...step }))
            };
    }
}

/**
 * The relations of a table the caller can follow, as properties.
 *
 * A relation whose target is not among the tables the caller was served is
 * left out: the panel cannot open a table it does not have. A `belongsTo`
 * then leaves its foreign-key column in place as a plain key field, so the
 * value stays visible and editable. A `belongsTo` whose foreign-key column did
 * not arrive (the caller may not read it) is left out too: there is nothing to
 * pick a row into.
 */
export function projectRelations(table: TableDescriptor, resolveTarget: TargetResolver): ProjectedRelation[] {
    const columnsByKey = new Map(table.columns.filter(c => !c.private).map(c => [c.key, c]));
    const out: ProjectedRelation[] = [];

    for (const relation of table.relations) {
        if (!resolveTarget.has(relation.target)) continue;
        const targetSlug = relation.target;
        const target = (): AnyCollectionConfig => {
            const collection = resolveTarget.get(targetSlug);
            if (!collection) {
                throw new Error(`Relation "${relation.name}" on "${table.slug}" points at "${targetSlug}", which is not among the tables this panel was served.`);
            }
            return collection;
        };

        const property: RelationProperty = {
            type: "relation",
            name: labelFromIdentifier(relation.name),
            relation: relationFrom(relation, target)
        };

        if (relation.kind === "belongsTo") {
            const foreignKey = columnsByKey.get(relation.localField);
            if (!foreignKey) continue;
            const required = !foreignKey.nullable && !foreignKey.default && !foreignKey.readOnly && !foreignKey.generated;
            if (required) property.validation = { required: true };
            if (foreignKey.description) property.description = foreignKey.description;
            if (foreignKey.access) {
                property.access = {
                    ...(foreignKey.access.read ? { read: [...foreignKey.access.read] } : {}),
                    ...(foreignKey.access.write ? { write: [...foreignKey.access.write] } : {})
                };
            }
            if (foreignKey.readOnly || foreignKey.generated || foreignKey.stamp) property.admin = { readOnly: true };
            const inKey = table.primaryKey.includes(foreignKey.key);
            out.push({ key: relation.name, property, ...(inKey ? {} : { replacesColumn: foreignKey.key }) });
            continue;
        }

        if (relation.kind === "via" && !relation.writable) property.admin = { readOnly: true };
        out.push({ key: relation.name, property });
    }

    return out;
}
