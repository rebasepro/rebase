import React, { useContext, useMemo } from "react";
import type { AdminCollection } from "@rebasepro/cms-types";
import type { Property, RelationProperty, ResolvedRelation } from "@rebasepro/types";
import { EntityReference, EntityRelation } from "@rebasepro/types";
import { fieldKeyForColumn, getRelationTargetPath, normalizeToEntityRelation, resolveCollectionRelations } from "@rebasepro/common";

import type { PreviewSize } from "../types/components/PropertyPreviewProps";
import { PropertyPreview } from "../preview/PropertyPreview";
import { useCollectionRegistryController } from "../hooks/navigation/contexts/CollectionRegistryContext";
import { useNavigationStateController } from "../hooks/navigation/contexts/NavigationStateContext";
import { CollectionsScopeContext, isRegistered } from "./CollectionsScopeContext";

/**
 * Props for {@link FieldValue}.
 *
 * @group Preview components
 */
export interface FieldValueProps {
    /**
     * The record, as the server sends it: what `useRows`, `useRow`,
     * `client.data` and a callback's `context.data` return. ISO date strings,
     * and a belongsTo relation as its foreign key, under that key's own name.
     */
    row: Record<string, unknown>;
    /** The property to draw, by its key in the collection. */
    field: string;
    /** The collection's slug, or a subcollection's full path. */
    collection: string;
    /** Defaults to `"medium"`. */
    size?: PreviewSize;
}

/**
 * One value of a row, drawn exactly as the admin draws it: an enum as its
 * chip, a date in the property's timezone, a relation as its target's title,
 * an image as its thumbnail, and a property with its own `admin.Preview`
 * through that.
 *
 * It takes the whole row because a belongsTo relation does not arrive under
 * its property's key: a row of `orders` carries its customer as `customerId`,
 * and `field="customer"` finds it there.
 *
 * Needs the collection registered above it — `<RebaseCMS>`, or a
 * `<CollectionsProvider>` around your page. An unknown collection or field
 * throws, naming it.
 *
 * @example
 * ```tsx
 * const { rows } = useRows("orders", { limit: 20 });
 * return rows.map(row => <div key={row.id}>
 *     <FieldValue row={row} collection="orders" field="customer"/>
 *     <FieldValue row={row} collection="orders" field="status"/>
 * </div>);
 * ```
 *
 * @group Preview components
 */
export function FieldValue({ row, field, collection: path, size = "medium" }: FieldValueProps) {
    const inScope = useContext(CollectionsScopeContext);
    const collectionRegistry = useCollectionRegistryController();
    const navigationState = useNavigationStateController();

    const settled = !navigationState.loading;
    const registered = inScope && (collectionRegistry.initialised || settled)
        && isRegistered(collectionRegistry.collections, path);
    // One lookup per registry: each builds a new object.
    const collection = useMemo(
        () => registered ? collectionRegistry.getCollection(path) : undefined,
        [registered, collectionRegistry, path]);

    const property = collection?.properties?.[field] as Property | undefined;
    const value = useMemo(
        () => collection && property ? previewValue(row, field, property, collection) : undefined,
        [row, field, property, collection]);

    if (!inScope) {
        throw new Error(`<FieldValue collection="${path}">: no collections are registered above it. Render it inside <RebaseCMS>, or wrap your page in a <CollectionsProvider collections={[…]}>.`);
    }
    if (!collection) {
        if (!settled) return null;
        throw new Error(`<FieldValue collection="${path}">: no collection is registered at "${path}".`);
    }
    if (!property) {
        const known = Object.keys(collection.properties ?? {}).join(", ");
        throw new Error(`<FieldValue collection="${path}" field="${field}">: the collection has no property "${field}". Its properties: ${known}.`);
    }

    return <PropertyPreview propertyKey={field}
        property={property}
        value={value}
        size={size}/>;
}

/**
 * A wire row's value for one property, in the form `PropertyPreview` reads.
 *
 * Only the relational kinds need anything: everything else the server sends —
 * an ISO date, a number, an enum key, a map, a string — `PropertyPreview`
 * already reads as it comes.
 */
function previewValue(row: Record<string, unknown>, field: string, property: Property, collection: AdminCollection): unknown {
    if (property.type === "relation") {
        const target = getRelationTargetPath(property);
        const raw = relationValue(row, field, property, collection);
        return Array.isArray(raw)
            ? raw.map(item => toRelation(item, target))
            : toRelation(raw, target);
    }
    if (property.type === "reference") {
        return toReference(row[field], property.path);
    }
    if (property.type === "array" && !Array.isArray(property.of) && property.of?.type === "reference") {
        const targetPath = property.of.path;
        const raw = row[field];
        return Array.isArray(raw) ? raw.map(item => toReference(item, targetPath)) : raw;
    }
    return row[field];
}

/**
 * A relation's value in the row: for a belongsTo, its foreign key, under the
 * name the server gives that column (`customer_id` → `customerId`); for any
 * other kind, or a row that carries the related record itself, the property's
 * own key.
 */
function relationValue(row: Record<string, unknown>, field: string, property: RelationProperty, collection: AdminCollection): unknown {
    const relation = resolvedRelationOf(field, property, collection);
    if (relation?.kind === "belongsTo" && relation.localKey) {
        const key = fieldKeyForColumn(collection, relation.localKey);
        if (row[key] !== undefined) return row[key];
    }
    return row[field];
}

function resolvedRelationOf(field: string, property: RelationProperty, collection: AdminCollection): ResolvedRelation | undefined {
    if (property.resolvedRelation) return property.resolvedRelation;
    try {
        return resolveCollectionRelations(collection)[field];
    } catch {
        // A target the relation cannot reach from here: no foreign key to
        // read, so the value is read under the property's own key.
        return undefined;
    }
}

/**
 * A relation's value as an `EntityRelation`, which carries the target the
 * preview fetches the title from. A value that is no relation passes through,
 * so the preview reports it as the wrong type rather than as empty.
 */
function toRelation(value: unknown, target: string | undefined): unknown {
    if (value === null || value === undefined || value === "") return null;
    const relation = normalizeToEntityRelation(value, "relation", target);
    if (relation) return relation;
    // The related record itself, as a row carries an included relation: no
    // `path` of its own, since the property names it. Its flat values are not
    // the record a relation's `data` holds, so the preview reads it by id.
    if (target && isRecord(value) && (typeof value.id === "string" || typeof value.id === "number")) {
        return new EntityRelation(value.id, target);
    }
    return value;
}

/** The same for a `reference` property, whose value is the referenced id. */
function toReference(value: unknown, path: string | undefined): unknown {
    if (value === null || value === undefined || value === "") return null;
    if (value instanceof EntityReference) return value;
    if ((typeof value === "string" || typeof value === "number") && path) {
        return new EntityReference({
            id: String(value),
            path
        });
    }
    if (isRecord(value) && (typeof value.id === "string" || typeof value.id === "number")) {
        const referencePath = typeof value.path === "string" ? value.path : path;
        if (referencePath) {
            return new EntityReference({
                id: String(value.id),
                path: referencePath
            });
        }
    }
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
