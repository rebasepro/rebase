import React from "react";

/**
 * Look up a collection's config by slug.
 */
export type CollectionResolver = (slug: string) => { properties?: Record<string, unknown> } | undefined;

/**
 * Lets the layer that owns the collections hand a resolver *up* to the data
 * layer, which needs a collection's primary keys to give its rows an address.
 *
 * The inversion is forced by the composition: `<Rebase client>` builds the data
 * layer, and `<RebaseCMS collections>` sits inside it — so the collections are
 * not in scope where the data is created, and `Rebase` cannot take them as a
 * prop without giving every headless BaaS app a collections argument it has no
 * use for.
 *
 * Registration is a ref write, so it is safe to call during render — and it has
 * to be. The views that fetch rows are *below* the registrar, and child effects
 * run before parent effects, so registering in an effect would bind after the
 * first page of rows had already been converted.
 */
export const CollectionResolverRegistrationContext =
    React.createContext<(resolver: CollectionResolver | undefined) => void>(() => undefined);
