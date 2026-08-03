import React, { PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import {
    AutofillReview,
    DataEnhancementController,
    GenerateParams,
    InputProperty,
    ProposedField
} from "../types/data_enhancement_controller";
import { CollectionConfig } from "@rebasepro/types";
import { PluginFormActionProps } from "@rebasepro/admin-types";
import { autofillStream, fetchAiStatus, fetchPromptSuggestions } from "../api";
import { getSimplifiedProperties } from "../utils/properties";
import { flatMapEntityValues } from "../utils/values";
import { useEditorAIController } from "../editor/useEditorAIController";
import { getValueInPath } from "@rebasepro/utils";

const DataEnhancementControllerContext = React.createContext<DataEnhancementController>(null! as DataEnhancementController);

type DataEnhancementControllerProviderProps = {

    getConfigForPath?: (props: {
        path: string,
        collection: CollectionConfig
    }) => boolean;

    endpoint?: string;
}

export const useDataEnhancementController = (): DataEnhancementController => useContext(DataEnhancementControllerContext);

function getPropertyFromKey(properties: Record<string, InputProperty>, propertyKey: string): InputProperty | undefined {
    if (propertyKey in properties) {
        return properties[propertyKey];
    }
    const split = propertyKey.split(".");
    if (split.length === 1) return undefined;
    return getPropertyFromKey(properties, split.slice(0, -1).join("."));
}

/**
 * Convert a value off the wire into what the form field expects.
 *
 * Only dates need converting: the service answers ISO-8601 strings because JSON
 * has no date type, and handing a date field a string stores the wrong type
 * without complaining. Everything else — strings, numbers, booleans, arrays of
 * scalars — is already the shape the field wants, which is the point of having
 * the service constrain its answer to a schema derived from these properties.
 */
function coerceToProperty(value: unknown, property: InputProperty | undefined): unknown {
    if (property?.type === "date" && typeof value === "string") {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? undefined : date;
    }
    return value;
}

export function DataEnhancementControllerProvider({
    getConfigForPath,
    children,
    endpoint,
    path,
    collection,
    formContext
}: PropsWithChildren<DataEnhancementControllerProviderProps & PluginFormActionProps>) {

    const [allowedHere, setAllowedHere] = useState(false);
    const [serviceAvailable, setServiceAvailable] = useState(false);
    const [review, setReview] = useState<AutofillReview | null>(null);

    const properties = useMemo(
        () => getSimplifiedProperties(collection.properties, formContext?.values ?? {}),
        [collection.properties, formContext?.values]
    );

    /**
     * Read inside the streaming callbacks, which outlive the render that
     * started the run.
     *
     * The operator is free to keep typing while the model works — nothing here
     * writes to the form — so the callbacks must not close over a stale
     * property map from whichever render happened to kick the run off.
     */
    const propertiesRef = useRef(properties);
    propertiesRef.current = properties;

    /** The host app's own opt-out. */
    useEffect(() => {
        if (!getConfigForPath) {
            setAllowedHere(true);
            return;
        }
        setAllowedHere(Boolean(getConfigForPath({ path,
collection })));
    }, [getConfigForPath, path, collection]);

    /**
     * The service's own availability.
     *
     * Nothing renders until this comes back true. An unreachable host, an
     * unconfigured provider key or an exhausted daily quota all land here, and
     * all of them mean the same thing to the operator: no Autofill button,
     * rather than a button that fails when clicked.
     */
    useEffect(() => {
        if (!allowedHere) return;
        const abort = new AbortController();
        fetchAiStatus({ endpoint,
signal: abort.signal })
            .then((status) => setServiceAvailable(status.available))
            .catch(() => setServiceAvailable(false));
        return () => abort.abort();
    }, [allowedHere, endpoint]);

    const enabled = allowedHere && serviceAvailable;

    /** Add or update one row in the review, preserving arrival order. */
    const upsertField = useCallback((key: string, update: (existing: ProposedField | undefined) => ProposedField) => {
        setReview((current) => {
            if (!current) return current;
            const index = current.fields.findIndex((f) => f.key === key);
            const next = update(index === -1 ? undefined : current.fields[index]);
            const fields = index === -1
                ? [...current.fields, next]
                : current.fields.map((f, i) => (i === index ? next : f));
            return { ...current,
fields };
        });
    }, []);

    const generate = useCallback(async (params: GenerateParams<Record<string, unknown>>): Promise<void> => {

        const currentProperties = propertiesRef.current;
        const flatValues = flatMapEntityValues(params.values ?? {}) as Record<string, unknown>;

        setReview({
            status: "generating",
            fields: [],
            instructions: params.instructions
        });

        const labelFor = (key: string) => currentProperties[key]?.name ?? key;

        try {
            await autofillStream({
                endpoint,
                request: {
                    entityName: collection.singularName ?? collection.name,
                    entityDescription: collection.description,
                    // Flattened to dotted paths so the keys line up with the
                    // property map: the service is told about `seo.title`, so it
                    // has to be told the value of `seo.title` too, not of `seo`.
                    values: flatValues,
                    properties: currentProperties,
                    propertyKey: params.propertyKey,
                    propertyInstructions: params.propertyInstructions,
                    instructions: params.instructions
                },
                onDelta: (key, text) => {
                    upsertField(key, (existing) => existing
                        ? { ...existing,
proposed: String(existing.proposed ?? "") + text }
                        : {
                            key,
                            label: labelFor(key),
                            currentValue: getValueInPath(params.values, key),
                            proposed: text,
                            pending: true,
                            selected: true
                        });
                },
                onValue: (key, value) => {
                    const coerced = coerceToProperty(value, getPropertyFromKey(currentProperties, key));
                    upsertField(key, (existing) => ({
                        key,
                        label: existing?.label ?? labelFor(key),
                        currentValue: existing?.currentValue ?? getValueInPath(params.values, key),
                        proposed: coerced,
                        pending: false,
                        // A row the operator already deselected mid-stream stays
                        // deselected when its final value lands.
                        selected: existing?.selected ?? true
                    }));
                }
            });

            setReview((current) => current && {
                ...current,
                status: "ready",
                // Fields still pending when the run ended never received a final
                // value — the model's JSON was cut off mid-string, so all we
                // hold is a half-written sentence. Marking them complete would
                // make that sentence applicable, which is the exact outcome the
                // review exists to prevent. They are dropped instead: the review
                // only ever offers what the service actually finished.
                fields: current.fields.filter((f) => !f.pending)
            });
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : "Autofill could not be completed";
            // Kept in the review rather than fired into a snackbar: a run that
            // produced three good fields and then failed should still let the
            // operator apply the three.
            setReview((current) => current && {
                ...current,
                status: "failed",
                error: message,
                // Same rule as the success path: a field interrupted mid-write
                // is not something the operator can be offered.
                fields: current.fields.filter((f) => !f.pending)
            });
        }
    }, [collection, endpoint, upsertField]);

    const toggleField = useCallback((key: string) => {
        setReview((current) => current && {
            ...current,
            fields: current.fields.map((f) => (f.key === key ? { ...f,
selected: !f.selected } : f))
        });
    }, []);

    const toggleAll = useCallback((selected: boolean) => {
        setReview((current) => current && {
            ...current,
            fields: current.fields.map((f) => ({ ...f,
selected }))
        });
    }, []);

    const dismissReview = useCallback(() => setReview(null), []);

    const applyReview = useCallback(() => {
        setReview((current) => {
            if (!current) return null;
            for (const field of current.fields) {
                if (!field.selected || field.pending) continue;
                if (field.proposed === undefined || field.proposed === null) continue;
                formContext?.setFieldValue(field.key, field.proposed);
            }
            return null;
        });
    }, [formContext]);

    const editorAIController = useEditorAIController({ endpoint });

    const getSamplePrompts = useCallback(
        (entityName: string, input?: string) => fetchPromptSuggestions({
            endpoint,
            entityName,
            entityDescription: collection.description,
            input
        }),
        [endpoint, collection.description]
    );

    const dataEnhancementController: DataEnhancementController = useMemo(() => ({
        enabled,
        review,
        generate,
        toggleField,
        toggleAll,
        applyReview,
        dismissReview,
        getSamplePrompts,
        editorAIController
    }), [
        enabled,
        review,
        generate,
        toggleField,
        toggleAll,
        applyReview,
        dismissReview,
        getSamplePrompts,
        editorAIController
    ]);

    return (
        <DataEnhancementControllerContext.Provider
            value={dataEnhancementController}>
            {children}
        </DataEnhancementControllerContext.Provider>
    );
}
