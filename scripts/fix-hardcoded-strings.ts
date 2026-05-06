#!/usr/bin/env npx tsx
/**
 * Automated fixer for hardcoded user-facing strings.
 * Replaces known hardcoded strings with t() calls and
 * injects the useTranslation hook where needed.
 *
 * Usage:
 *   npx tsx scripts/fix-hardcoded-strings.ts [--dry-run]
 */

import * as fs from "fs";
import * as path from "path";

const DRY_RUN = process.argv.includes("--dry-run");

// ─── Mapping of hardcoded string → translation key ──────────────────────
// These are strings that already exist in en.ts or will be added.
const STRING_TO_KEY: Record<string, string> = {
    // ── Validation (already exist) ──
    "Min value": "min_value",
    "Max value": "max_value",
    "Less than": "less_than",
    "More than": "more_than",
    "Positive value": "positive_value",
    "Negative value": "negative_value",
    "Integer value": "integer_value",
    "Exact length": "exact_length",
    "Min length": "min_length",
    "Max length": "max_length",
    "Matches regex": "matches_regex",
    "Required message": "required_message",

    // ── PropertyEditView ──
    "Property edit view": "property_edit_view",
    "Delete this property?": "delete_this_property",
    "Select a property widget": "select_property_widget",
    "This property can\\'t be edited": "property_cant_be_edited",

    // ── Common fields ──
    "Default value": "default_value",
    "Click to edit": "click_to_edit",
    "Entity not found": "entity_not_found",
    "File not found": "file_not_found",
    "Reference not set": "reference_not_set",
    "Reference does not exist": "reference_does_not_exist",

    // ── Collection editor ──
    "Properties in this group": "properties_in_this_group",
    "Delete this subcollection?": "delete_this_subcollection",
    "Remove this view?": "remove_this_view",
    "Collection editor": "collection_editor",

    // ── Routes ──
    "You have unsaved changes in this entity.": "unsaved_changes_in_entity",

    // ── Errors ──
    "Value is not a reference.": "value_is_not_reference",
    "Data is not an array of references": "data_is_not_array_of_references",

    // ── NEW keys to add ──
    // PropertyEditView
    "You must specify an id for the field": "error_must_specify_id",
    "There is another field with this ID already": "error_id_already_exists",
    "You must specify a title for the field": "error_must_specify_title",
    "Invalid regular expression": "invalid_regular_expression",
    "You must specify a target collection for the field": "must_specify_target_collection",
    "You need to specify a repeat field": "need_specify_repeat_field",
    "You need to specify the properties of this block": "need_specify_block_properties",

    // Storage
    "File name": "storage_file_name",
    "Storage path": "storage_path",
    "Max size (in bytes)": "storage_max_size",
    "Resize mode": "storage_resize_mode",
    "Output format": "storage_output_format",
    "Max width (px)": "storage_max_width",
    "Max height (px)": "storage_max_height",
    "Quality (0-100)": "storage_quality",
    "File upload config": "storage_file_upload_config",
    "Image Resize Configuration": "storage_image_resize_config",
    "All file types allowed": "storage_all_file_types",
    "Allowed file types": "storage_allowed_file_types",
    "Include bucket URL (s3://...) in saved value": "storage_include_bucket_url",
    "Save URL instead of storage path": "storage_save_url",

    // Number
    "Database Column Type": "db_column_type",
    "Primary Key / Unique ID": "primary_key_unique_id",

    // Map
    "Spread children as columns": "spread_children_as_columns",

    // Admin errors
    "Failed to save role": "error_saving_role",
    "Failed to load users": "error_loading_users",
    "Failed to save user": "error_saving_user",

    // Relation
    "Relation not set": "relation_not_set",
    "Relation does not exist": "relation_does_not_exist",
    "Value is not a relation.": "value_is_not_relation",
    "Data is not an array of relations": "data_is_not_array_of_relations",
    "Target collection": "target_collection",
    "Relation name": "relation_name",

    // Studio
    "Run Query": "studio_sql_run",
    "Run Script": "studio_js_run_script",
    "Snippet saved": "studio_js_snippet_saved",
    "Save as snippet": "studio_js_save_as_snippet",
    "Execution Error": "studio_js_execution_error",
    "RLS enabled": "studio_schema_rls_enabled",
    "History enabled": "studio_schema_history_enabled",
    "Left to right layout": "studio_schema_left_to_right",
    "Primary Key": "studio_schema_primary_key",
    "Upload failed": "studio_storage_upload_failed",
    "Go up": "studio_storage_go_up",
    "Grid view": "studio_storage_grid_view",
    "List view": "studio_storage_list_view",
    "Branch Name": "studio_branch_name",
    "Create New Branch": "studio_create_new_branch",
    "Job triggered": "studio_cron_job_triggered",
    "Last Run": "studio_cron_last_run",
    "Next Run": "studio_cron_next_run",
    "Total Runs": "studio_cron_total_runs",
    "Path Parameters": "studio_api_path_parameters",
    "Query Parameters": "studio_api_query_parameters",
    "Custom Headers": "studio_api_custom_headers",
    "Access Control": "studio_access_control",

    // Auth
    "Sign in with email": "auth_sign_in_account",
    "Error loading auth": "error_loading_auth",
    "AI modified": "ai_modified",

    // Markdown editor
    "Strip HTML on paste": "markdown_strip_html",
    "Convert pasted text to markdown": "markdown_convert_pasted",

    // DateTime
    "Automatic value": "datetime_automatic_value",
    "On create": "datetime_on_create",
    "On any update": "datetime_on_update",

    // Condition Editor
    "Select field": "condition_select_field",
    "Select operator": "condition_select_operator",
    "Is equal to": "condition_is_equal_to",
    "Is not empty": "condition_is_not_empty",

    // Subcollections
    "Remove this action": "remove_this_action",

    // Plugin data enhancement
    "No fields were updated": "enhancement_no_fields_updated",
};

// ─── New keys that need to be added to en.ts ────────────────────────────
const NEW_EN_KEYS: Record<string, string> = {
    // Storage property
    storage_file_name: "File name",
    storage_path: "Storage path",
    storage_max_size: "Max size (in bytes)",
    storage_resize_mode: "Resize mode",
    storage_output_format: "Output format",
    storage_max_width: "Max width (px)",
    storage_max_height: "Max height (px)",
    storage_quality: "Quality (0-100)",
    storage_file_upload_config: "File upload config",
    storage_image_resize_config: "Image Resize Configuration",
    storage_all_file_types: "All file types allowed",
    storage_allowed_file_types: "Allowed file types",
    storage_include_bucket_url: "Include bucket URL (s3://...) in saved value",
    storage_save_url: "Save URL instead of storage path",
    storage_contain_mode: "Contain (fit within bounds)",
    storage_cover_mode: "Cover (fill bounds, may crop)",
    storage_original_format: "Original (keep same format)",
    storage_webp_format: "WebP (best compression)",
    storage_quality_hint: "Higher quality = larger file size. Recommended: 80-90 for photos, 90-100 for graphics",
    storage_resize_hint: "Automatically resize and optimize images before upload (JPEG, PNG, WebP only)",
    storage_placeholder_hint: "You can use the following placeholders in the file name and storage path values:",
    storage_bucket_url_hint: "Turn this setting on if you want to save a fully-qualified storage URL instead of just the storage path. You can only change this prop upon creation.",
    storage_store_url_hint: "Turn this setting on if you prefer to save the download URL of the uploaded file instead of the storage path. You can only change this prop upon creation.",

    // Number property
    db_column_type: "Database Column Type",
    db_column_type_hint: "Optional database override for this number field.",
    primary_key_unique_id: "Primary Key / Unique ID",
    primary_key_hint: "Set as Primary Key and configure ID generation strategy.",

    // Map property
    spread_children_as_columns: "Spread children as columns",
    spread_children_hint: "Set this flag to true if you want to display the children of this group as individual columns. This will only work for top level groups.",
    add_property_to_group: "Add property to {{name}}",
    add_first_property_to_group: "Add the first property to this group",

    // Admin errors
    error_loading_users: "Failed to load users",
    error_saving_user: "Failed to save user",

    // Relation
    relation_not_set: "Relation not set",
    relation_does_not_exist: "Relation does not exist",
    value_is_not_relation: "Value is not a relation.",
    data_is_not_array_of_relations: "Data is not an array of relations",
    target_collection: "Target collection",
    relation_name: "Relation name",

    // Studio
    studio_js_run_script: "Run Script",
    studio_js_snippet_saved: "Snippet saved",
    studio_js_save_as_snippet: "Save as snippet",
    studio_js_execution_error: "Execution Error",
    studio_schema_rls_enabled: "RLS enabled",
    studio_schema_history_enabled: "History enabled",
    studio_schema_left_to_right: "Left to right layout",
    studio_storage_upload_failed: "Upload failed",
    studio_storage_go_up: "Go up",
    studio_storage_grid_view: "Grid view",
    studio_storage_list_view: "List view",
    studio_branch_name: "Branch Name",
    studio_create_new_branch: "Create New Branch",
    studio_cron_job_triggered: "Job triggered",
    studio_cron_last_run: "Last Run",
    studio_cron_next_run: "Next Run",
    studio_cron_total_runs: "Total Runs",
    studio_api_path_parameters: "Path Parameters",
    studio_api_query_parameters: "Query Parameters",
    studio_api_custom_headers: "Custom Headers",
    studio_access_control: "Access Control",

    // Markdown
    markdown_strip_html: "Strip HTML on paste",
    markdown_convert_pasted: "Convert pasted text to markdown",

    // DateTime
    datetime_automatic_value: "Automatic value",
    datetime_on_create: "On create",
    datetime_on_update: "On any update",

    // Condition
    condition_select_field: "Select field",
    condition_select_operator: "Select operator",
    condition_is_equal_to: "Is equal to",
    condition_is_not_empty: "Is not empty",

    // Plugin
    enhancement_no_fields_updated: "No fields were updated",

    // PropertyEditView error strings
    property_not_editable_hint: "You may not have permission to edit it or it is defined in code and cannot be modified.",
    property_delete_no_data: "This will not delete any data, only modify the collection.",
    widget_type_change_warning: "This widget uses a different data type than the initially selected widget. This can cause errors with existing data.",
};

// ─── New keys that need to be added to translations type ─────────────────
const NEW_TYPE_KEYS = Object.keys(NEW_EN_KEYS);

interface FileReplacement {
    file: string;
    replacements: Array<{
        from: string | RegExp;
        to: string;
    }>;
    needsImport: boolean;
    needsHook: boolean;
}

// Files that need replacement
const FILE_REPLACEMENTS: FileReplacement[] = [
    // ─── PropertyEditView.tsx ────────────────────────────────────
    {
        file: "packages/admin/src/collection_editor/ui/collection_editor/PropertyEditView.tsx",
        needsImport: false, // already imports from @rebasepro/core
        needsHook: false,   // validation functions aren't components
        replacements: [
            // These are in validation (non-component) functions, so they can't use hooks
            // We'll handle them differently - they should stay as-is or be parameterized
        ]
    },
    // ─── NumberPropertyField.tsx ──────────────────────────────────
    {
        file: "packages/admin/src/collection_editor/ui/collection_editor/properties/NumberPropertyField.tsx",
        needsImport: true,
        needsHook: true,
        replacements: [
            { from: 'label={"Database Column Type"}', to: 'label={t("db_column_type")}' },
            { from: 'label={"Primary Key / Unique ID"}', to: 'label={t("primary_key_unique_id")}' },
            { from: 'label={"Default value"}', to: 'label={t("default_value")}' },
        ]
    },
    // ─── MapPropertyField.tsx ────────────────────────────────────
    {
        file: "packages/admin/src/collection_editor/ui/collection_editor/properties/MapPropertyField.tsx",
        needsImport: true,
        needsHook: true,
        replacements: [
            { from: '>Properties in this group<', to: '>{t("properties_in_this_group")}<' },
            { from: 'label="Spread children as columns"', to: 'label={t("spread_children_as_columns")}' },
        ]
    },
    // ─── StoragePropertyField.tsx ────────────────────────────────
    {
        file: "packages/admin/src/collection_editor/ui/collection_editor/properties/StoragePropertyField.tsx",
        needsImport: true,
        needsHook: true,
        replacements: [
            { from: '>File upload config<', to: '>{t("storage_file_upload_config")}<' },
            { from: 'label={"File name"}', to: 'label={t("storage_file_name")}' },
            { from: 'label={"Storage path"}', to: 'label={t("storage_path")}' },
            { from: 'label={"Max size (in bytes)"}', to: 'label={t("storage_max_size")}' },
            { from: 'label={"Resize mode"}', to: 'label={t("storage_resize_mode")}' },
            { from: 'label={"Output format"}', to: 'label={t("storage_output_format")}' },
            { from: 'label={"Max width (px)"}', to: 'label={t("storage_max_width")}' },
            { from: 'label={"Max height (px)"}', to: 'label={t("storage_max_height")}' },
            { from: 'label={"Quality (0-100)"}', to: 'label={t("storage_quality")}' },
            { from: 'label={"Include bucket URL (s3://...) in saved value"}', to: 'label={t("storage_include_bucket_url")}' },
            { from: 'label={"Save URL instead of storage path"}', to: 'label={t("storage_save_url")}' },
            { from: '>Image Resize Configuration<', to: '>{t("storage_image_resize_config")}<' },
        ]
    },
];

// ─── Main ───────────────────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, "..");

let totalReplacements = 0;
let filesModified = 0;

for (const entry of FILE_REPLACEMENTS) {
    if (entry.replacements.length === 0) continue;

    const filePath = path.join(ROOT, entry.file);
    if (!fs.existsSync(filePath)) {
        console.warn(`⚠ File not found: ${entry.file}`);
        continue;
    }

    let content = fs.readFileSync(filePath, "utf-8");
    let changed = false;
    let replacementCount = 0;

    // Apply replacements
    for (const { from, to } of entry.replacements) {
        if (typeof from === "string") {
            if (content.includes(from)) {
                content = content.replace(from, to);
                replacementCount++;
                changed = true;
            }
        } else {
            const match = content.match(from);
            if (match) {
                content = content.replace(from, to);
                replacementCount++;
                changed = true;
            }
        }
    }

    // Inject useTranslation import if needed
    if (changed && entry.needsImport && !content.includes("useTranslation")) {
        // Find a good place to add the import
        if (content.includes('from "@rebasepro/core"')) {
            content = content.replace(
                /from "@rebasepro\/core"/,
                'useTranslation } from "@rebasepro/core"'
            );
            // Fix: need to also add to the import destructuring
            content = content.replace(
                /import \{ (.*?)useTranslation \} from "@rebasepro\/core"/,
                'import { $1useTranslation } from "@rebasepro/core"'
            );
        } else {
            // Add new import line after last import
            const lastImportIndex = content.lastIndexOf("\nimport ");
            const lineEnd = content.indexOf("\n", lastImportIndex + 1);
            const importLine = '\nimport { useTranslation } from "@rebasepro/core";';
            content = content.slice(0, lineEnd) + importLine + content.slice(lineEnd);
        }
    }

    // Inject const { t } = useTranslation() if needed
    if (changed && entry.needsHook && !content.includes("useTranslation()")) {
        // Find the first useFormex() call and add after it
        const formexMatch = content.match(/} = useFormex\(?.*?\)\(?.*?\)?;/);
        if (formexMatch && formexMatch.index !== undefined) {
            const insertPos = formexMatch.index + formexMatch[0].length;
            content = content.slice(0, insertPos) + "\n    const { t } = useTranslation();" + content.slice(insertPos);
        }
    }

    if (changed) {
        if (DRY_RUN) {
            console.log(`[DRY RUN] Would modify ${entry.file} (${replacementCount} replacements)`);
        } else {
            fs.writeFileSync(filePath, content, "utf-8");
            console.log(`✓ Modified ${entry.file} (${replacementCount} replacements)`);
        }
        totalReplacements += replacementCount;
        filesModified++;
    }
}

console.log(`\n${DRY_RUN ? "[DRY RUN] " : ""}Done: ${totalReplacements} replacements across ${filesModified} files`);
