// The schema change dialog — a separate entry point, so the plan/apply dialog
// stays out of the eager bundle: `useLiveSchemaEditing` loads it with
// `lazyChunk` the first time a schema edit is planned, and re-exporting it from
// the barrel would put it back.
//
// This entry used to carry the collection editor too (`CollectionEditorDialog`,
// `PropertyForm`, the Studio's Collections views). The editor is gone: a table's
// schema lives in `backend/schema`, and the admin panel renders what the server
// serves.

export { SchemaChangeDialog } from "./collection_editor/SchemaChangeDialog";
export type { SchemaChangeDialogProps } from "./collection_editor/SchemaChangeDialog";
