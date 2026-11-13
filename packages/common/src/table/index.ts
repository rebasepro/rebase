/**
 * Pure functions over the table model's descriptors (`TableDescriptor`,
 * `ColumnDescriptor`, `RelationDescriptor`): one helper per question the
 * backend asks of a table, no drizzle and no Node APIs, so the server, the
 * Postgres driver and the CMS projector all ask it the same way.
 *
 * @module
 */
export * from "./columns";
export * from "./column-types";
export * from "./codecs";
export * from "./keys";
export * from "./write-values";
// Listed, not `export *`: `isPrivateRelation` is this package's own helper.
export {
    apiHiddenKeys,
    boundKeyColumn,
    canReadColumn,
    canReadRelation,
    canWriteColumn,
    canWriteRelation,
    columnAccess,
    hasColumnAccessRules,
    hasJoinAccessRules,
    relationJoinColumns,
    restrictedKeys,
    UNSERVED_TABLE,
    viaJoinTableNames,
    type RelatedTables
} from "./access";
export * from "./relations";
export * from "./table-options";
// Only the path printer crosses the package boundary; the walkers are internal.
export { formatJsonPath } from "./json-shape";
export * from "./field-operations";
export * from "./field-operation-bounds";
// Listed, not `export *`: `sameValueKey` is `firstDuplicate`'s own helper.
export { firstDuplicate, textMaxLength, validationPattern } from "./validation";
export * from "./query-names";
export * from "./junction";
export * from "./storage";
export * from "./rls";
export * from "./users";
export * from "./order";
