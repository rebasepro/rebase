/**
 * Shapes describing the introspected schema the SQL editor works against.
 * They live here rather than in SQLEditor.tsx because the sidebar, the schema
 * browser and utils/sql_utils all need them, and importing them from the
 * component would close a cycle back through it.
 */

export interface SQLEditorColumnInfo {
    name: string;
    dataType: string;
    isPrimaryKey: boolean;
}

export interface TableInfo {
    schemaName: string;
    tableName: string;
    columns: SQLEditorColumnInfo[];
}
