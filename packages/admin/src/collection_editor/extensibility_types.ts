/**
 * Extension point types for the collection editor UI.
 *
 * These types define props that let external consumers customize the editor
 * without forking the UI: property type presets, type filtering,
 * custom form field slots, and tab visibility.
 *
 * All extension points are additive and optional — the standard Rebase
 * editor experience is unchanged when these props are not provided.
 *
 * @module
 */

import type React from "react";
import type { SerializableProperty, SerializableCollectionConfig } from "./serializable_types";

// ═══════════════════════════════════════════════════════════════════════
// PROPERTY TYPE PRESETS
// ═══════════════════════════════════════════════════════════════════════

/**
 * The base property data types supported by Rebase.
 * Derived from the `type` discriminant on `SerializableProperty`.
 */
export type PropertyType = SerializableProperty["type"];

/**
 * A higher-level "preset" that maps to a base Rebase property type
 * with pre-filled configuration. Presets replace the default type picker
 * in the property form when provided.
 *
 * @example
 * ```typescript
 * const emailPreset: PropertyTypePreset = {
 *     id: "email",
 *     label: "Email",
 *     baseType: "string",
 *     icon: "Mail",
 *     defaults: { email: true },
 *     detect: (p) => p.type === "string" && "email" in p && p.email === true,
 * };
 * ```
 */
export interface PropertyTypePreset {
    /** Unique identifier for this preset (e.g. "email", "phone", "currency"). */
    id: string;

    /** Display label shown in the type picker. */
    label: string;

    /** The underlying Rebase property type this maps to. */
    baseType: PropertyType;

    /** Icon to show in the picker (Lucide icon name string or React node). */
    icon?: string | React.ReactNode;

    /** Default property config applied when this preset is selected. */
    defaults: Partial<SerializableProperty>;

    /**
     * Optional: detect this preset from an existing property.
     * Used when loading existing schemas to show the correct preset label
     * instead of the raw base type. First match wins.
     * If not provided, falls back to matching by `baseType` alone.
     */
    detect?: (property: SerializableProperty) => boolean;
}

// ═══════════════════════════════════════════════════════════════════════
// TAB VISIBILITY
// ═══════════════════════════════════════════════════════════════════════

/**
 * The tabs available in the collection editor.
 */
export type CollectionEditorTab = "general" | "display" | "properties" | "rls";

// ═══════════════════════════════════════════════════════════════════════
// CUSTOM FORM FIELD SLOTS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Parameters passed to the `renderExtraPropertyFields` render prop.
 */
export interface ExtraPropertyFieldsParams {
    /** Current metadata values from `property.metadata`. */
    metadata: Record<string, unknown>;
    /** Callback to update a single metadata key. Triggers dirty-state tracking. */
    onMetadataChange: (key: string, value: unknown) => void;
    /** The full current property being edited (serializable form). */
    property: SerializableProperty;
    /** The collection this property belongs to (serializable form). */
    collection: SerializableCollectionConfig;
}

/**
 * Parameters passed to the `renderExtraCollectionFields` render prop.
 */
export interface ExtraCollectionFieldsParams {
    /** Current metadata values from `collection.metadata`. */
    metadata: Record<string, unknown>;
    /** Callback to update a single metadata key. Triggers dirty-state tracking. */
    onMetadataChange: (key: string, value: unknown) => void;
    /** The full current collection being edited (serializable form). */
    collection: SerializableCollectionConfig;
}

// ═══════════════════════════════════════════════════════════════════════
// COMBINED EXTENSION PROPS
// ═══════════════════════════════════════════════════════════════════════

/**
 * All extension props for the collection editor UI.
 *
 * This interface groups every customization point into a single type
 * that can be intersected with component props interfaces for clean threading.
 *
 * All fields are optional — when not provided, the standard Rebase
 * editor experience is unchanged (backward compatible).
 */
export interface CollectionEditorExtensionProps {
    /**
     * Custom property type presets. When provided, these REPLACE the default
     * type picker entirely. To include standard Rebase types alongside custom
     * ones, include them explicitly in the array.
     *
     * When not provided, the standard Rebase widget picker is shown.
     */
    propertyTypePresets?: PropertyTypePreset[];

    /**
     * Property types to hide from the type picker.
     * Only applies when `propertyTypePresets` is NOT provided.
     * When `propertyTypePresets` IS provided, this prop is ignored.
     */
    hiddenPropertyTypes?: PropertyType[];

    /**
     * Render additional form fields below the standard property configuration.
     * Metadata is stored in `property.metadata`.
     */
    renderExtraPropertyFields?: (params: ExtraPropertyFieldsParams) => React.ReactNode;

    /**
     * Render additional form fields in the collection editor's General tab.
     * Metadata is stored in `collection.metadata`.
     */
    renderExtraCollectionFields?: (params: ExtraCollectionFieldsParams) => React.ReactNode;

    /**
     * Which tabs to show in the collection editor.
     * Default: all tabs are shown (current behavior).
     */
    visibleTabs?: CollectionEditorTab[];

    /**
     * When true, the editor runs in standalone mode — all Rebase-specific
     * context dependencies (snackbar, auth, collection registry, import,
     * navigation state, URL controller) use safe defaults instead of
     * reading from React contexts.
     *
     * Use this when embedding the collection editor outside of the Rebase
     * admin, where the Rebase context providers are not available.
     *
     * Default: false (standard Rebase mode).
     */
    standalone?: boolean;
}
