import React, { useContext, useMemo } from "react";
import type { Property } from "@rebasepro/types";
import { rowToViewModel } from "@rebasepro/common";

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
     * `client.data` and `context.data` return. ISO date strings, and a
     * belongsTo relation as its foreign key, under that key's own name. A row
     * in the admin's view model — a `Date`, an `EntityRelation` — is drawn the
     * same.
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
    // The row in the admin's view model, the values `PropertyPreview` reads:
    // a belongsTo found under its foreign key, a date as a `Date`, a
    // reference as an `EntityReference`.
    const value = useMemo(
        () => collection && property
            ? rowToViewModel(row, path, slug => slug === path ? collection : collectionRegistry.getCollection(slug))[field]
            : undefined,
        [row, field, path, property, collection, collectionRegistry]);

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
