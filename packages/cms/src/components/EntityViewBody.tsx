import type { ComponentRef } from "@rebasepro/types";
import type { AdminCollection, EntityCustomViewParams } from "@rebasepro/cms-types";
import React, { Suspense, useMemo } from "react";
import { Entity } from "@rebasepro/types";
import { hasEntityId } from "@rebasepro/common";
import { CircularProgressCenter, cls, ErrorBoundary } from "@rebasepro/ui";
import { createFormexStub, resolveComponentRef } from "@rebasepro/app";

import type { FormContext } from "../types/fields";
import { EntityViewBinding } from "./EntityViewBinding";

type OpenEntityMode = "side_panel" | "full_screen" | "split" | "dialog";

/**
 * The context a read-only record hands what it renders but does not own — an
 * `additionalFields` entry, the collection's `formView.Builder`, a custom
 * entity view, a plugin slot. Every write on it throws: nothing on a page that
 * reads a record may change it. Undefined without an id to read by.
 */
export function useReadOnlyFormContext<M extends Record<string, unknown>>({
    entityId,
    entity,
    collection,
    path,
    openEntityMode
}: {
    entityId?: string | number;
    entity?: Entity<M>;
    collection: AdminCollection<M>;
    path: string;
    openEntityMode: OpenEntityMode;
}): FormContext<M> | undefined {
    return useMemo<FormContext<M> | undefined>(() => {
        if (!hasEntityId(entityId)) return undefined;
        const values = entity?.values ?? ({} as M);
        return {
            entityId,
            disabled: true,
            readOnly: true,
            openEntityMode,
            status: "existing",
            values,
            setFieldValue: () => {
                throw new Error("Cannot update values in read-only detail view");
            },
            save: () => {
                throw new Error("Cannot save in read-only detail view");
            },
            submit: () => {
                throw new Error("Cannot submit in read-only detail view");
            },
            collection,
            path,
            entity,
            savingError: undefined,
            formex: createFormexStub<M>(values)
        };
    }, [entityId, openEntityMode, entity, collection, path]);
}

export interface EntityViewBodyProps<M extends Record<string, unknown>> {
    entity: Entity<M>;
    collection: AdminCollection<M>;
    path: string;
    /** See {@link useReadOnlyFormContext}. */
    formContext?: FormContext<M>;
    /** See `EntityViewBinding`'s `fields`. Wins over the collection's `formView.Builder`, which cannot be told which fields to draw. */
    fields?: string[];
    openEntityMode?: OpenEntityMode;
    parentCollectionSlugs?: string[];
    parentEntityIds?: string[];
    className?: string;
}

/**
 * A record's values as a page: the collection's `formView.Builder` when it
 * has one, otherwise the generated read-only grid.
 *
 * `EntityViewPanel` and the CMS's own detail view both draw a record's body
 * here, so a record reads the same in a page of your app as in the admin.
 */
export function EntityViewBody<M extends Record<string, unknown>>({
    entity,
    collection,
    path,
    formContext,
    fields,
    openEntityMode = "full_screen",
    parentCollectionSlugs = [],
    parentEntityIds = [],
    className
}: EntityViewBodyProps<M>) {

    const builderRef = fields ? undefined : collection.formView?.Builder;
    const FormViewBuilder = builderRef
        ? resolveComponentRef<EntityCustomViewParams>(builderRef as ComponentRef<EntityCustomViewParams>)
        : undefined;

    if (FormViewBuilder) {
        // The Builder replaces the generated display, in the centred column
        // the grid lays itself out in.
        return <div className={cls("@container/form flex-1 min-w-0 overflow-y-auto flex justify-center items-start", className)}>
            <div className={cls(
                // Same widths as the default form (see EntityForm).
                "w-full max-w-3xl @7xl/form:max-w-4xl 2xl:max-w-4xl flex flex-col",
                openEntityMode === "dialog"
                    ? "pt-5 pb-12 px-6 sm:px-8"
                    : "pt-6 pb-16 px-5 sm:px-8"
            )}>
                <ErrorBoundary>
                    <Suspense fallback={<CircularProgressCenter/>}>
                        <FormViewBuilder
                            collection={collection}
                            parentCollectionSlugs={parentCollectionSlugs}
                            parentEntityIds={parentEntityIds}
                            entity={entity}
                            modifiedValues={entity.values}
                            formContext={formContext as FormContext<Record<string, unknown>>}
                        />
                    </Suspense>
                </ErrorBoundary>
            </div>
        </div>;
    }

    return <EntityViewBinding
        entity={entity}
        collection={collection}
        path={path}
        asPage
        openEntityMode={openEntityMode}
        formContext={formContext}
        fields={fields}
        className={className}
    />;
}
