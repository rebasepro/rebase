/**
 * How the key panel words scopes: plane headings, "every collection", the
 * title over a minting refusal. One place, so the detail panel, the create
 * dialog and the secret confirmation cannot drift apart.
 *
 * Every string is a translation key. A built-in scope's label and description
 * are keys too, derived from the scope (`data:read` →
 * `studio_scope_data_read_label`); an app's own scopes are worded as the app
 * declared them, in the server's catalogue (`GET /auth/scopes`).
 *
 * @module
 */

import { DEFAULT_STORAGE_SOURCE_KEY, isBuiltInScope, type ScopeSummary } from "@rebasepro/types";

import type { HeldScope, KeyErrorCode, ScopePlane } from "./scopes";

/** The panel's `t`, from `useTranslation()`. */
export type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** `data:read` → `studio_scope_data_read_label`. */
export function scopeLabelKey(scope: string): string {
    return `studio_scope_${scope.replace(/[^a-z0-9]/g, "_")}_label`;
}

/** `data:read` → `studio_scope_data_read_description`. */
export function scopeDescriptionKey(scope: string): string {
    return `studio_scope_${scope.replace(/[^a-z0-9]/g, "_")}_description`;
}

/** The translation, or `fallback` when the catalogue has none — i18next answers a missing key with the key. */
function translatedOr(t: Translate, key: string, fallback: string): string {
    const text = t(key);
    return text && text !== key ? text : fallback;
}

/**
 * The catalogue in the panel's language. Built-in scopes are translated; an
 * app scope keeps the label its app declared, and a built-in scope this panel
 * has no key for (one the server added since) keeps the server's wording
 * rather than rendering blank or as a key.
 */
export function localizeScopes(t: Translate, catalogue: readonly ScopeSummary[]): ScopeSummary[] {
    return catalogue.map(summary => isBuiltInScope(summary.scope)
        ? {
            ...summary,
            label: translatedOr(t, scopeLabelKey(summary.scope), summary.label),
            description: translatedOr(t, scopeDescriptionKey(summary.scope), summary.description)
        }
        : summary);
}

export function planeLabel(t: Translate, plane: ScopePlane): string {
    switch (plane) {
        case "data": return t("studio_api_keys_plane_data");
        case "admin": return t("studio_api_keys_plane_admin");
        case "app": return t("studio_api_keys_plane_app");
    }
}

export function planeHint(t: Translate, plane: ScopePlane): string {
    switch (plane) {
        case "data": return t("studio_api_keys_plane_data_hint");
        case "admin": return t("studio_api_keys_plane_admin_hint");
        case "app": return t("studio_api_keys_plane_app_hint");
    }
}

/** "Every collection", "Every storage source", "Every function", "Any project". */
export function everyTargetLabel(t: Translate, targetKind: string): string {
    switch (targetKind) {
        case "collection": return t("studio_api_keys_target_all_collection");
        case "bucket": return t("studio_api_keys_target_all_bucket");
        case "function": return t("studio_api_keys_target_all_function");
        default: return t("studio_api_keys_target_all_other", { kind: targetKind });
    }
}

/** One target as a person reads it: the default storage source is "Default bucket", not `(default)`. */
export function targetLabel(t: Translate, targetKind: string | undefined, target: string): string {
    if (targetKind === "bucket" && target === DEFAULT_STORAGE_SOURCE_KEY) return t("studio_api_keys_bucket_default");
    return target;
}

/** A held scope as one line: "Read data — posts, authors", "Read data — every collection", "Read server logs". */
export function heldScopeLine(t: Translate, held: HeldScope): string {
    if (!held.targetKind && held.targets === "all") return held.label;
    const reach = held.targets === "all"
        ? everyTargetLabel(t, held.targetKind ?? "")
        : held.targets.map(target => targetLabel(t, held.targetKind, target)).join(", ");
    return `${held.label} — ${reach}`;
}

/** The title over a refused create; the server's own message goes underneath. */
export function keyErrorTitle(t: Translate, code: KeyErrorCode | null): string {
    switch (code) {
        case "INVALID_SCOPES": return t("studio_api_keys_error_invalid_scopes");
        case "SCOPE_EXCEEDS_CREATOR": return t("studio_api_keys_error_scope_exceeds_creator");
        case "ROLE_EXCEEDS_CREATOR": return t("studio_api_keys_error_role_exceeds_creator");
        case "UNKNOWN_SCOPE_TARGET": return t("studio_api_keys_error_unknown_scope_target");
        case "KEY_MANAGEMENT_SCOPE": return t("studio_api_keys_error_key_management_scope");
        case null: return t("studio_api_keys_error_generic");
    }
}
