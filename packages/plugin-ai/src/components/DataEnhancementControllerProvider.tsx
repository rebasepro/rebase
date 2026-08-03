import React, { PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import {
    AutofillResult,
    DataEnhancementController,
    EnhanceParams,
    InputProperty
} from "../types/data_enhancement_controller";
import { useAuthController, useSnackbarController } from "@rebasepro/app";
import { CollectionConfig } from "@rebasepro/types";
import { PluginFormActionProps } from "@rebasepro/admin-types";
import { autofillStream, fetchAiStatus, fetchPromptSuggestions } from "../api";
import { getAppendableSuggestion } from "../utils/suggestions";
import { getSimplifiedProperties } from "../utils/properties";
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
    } else {
        //split the property key
        const split = propertyKey.split(".");
        if (split.length === 1) {
            return undefined;
        }
        const parentKey = split.slice(0, split.length - 1).join(".");
        return getPropertyFromKey(properties, parentKey);

    }
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
    const [suggestions, setSuggestions] = useState<Record<string, string | number>>({});
    const [loadingSuggestions, setLoadingSuggestions] = useState<string[]>([]);

    const enhancingInProgress = useRef(false);

    const authController = useAuthController();
    const snackbarController = useSnackbarController();

    const properties = useMemo(() => getSimplifiedProperties(collection.properties, formContext?.values ?? {}), [formContext?.values]);
    const valuesRef = React.useRef(formContext?.values ?? {});
    useEffect(() => {
        if (!enhancingInProgress.current)
            valuesRef.current = formContext?.values ?? {};
    }, [formContext?.values]);

    const allowReferenceDataSelection = false;

    /**
     * The host app's own opt-out.
     *
     * The previous version of this only ever called `setEnabled(true)` — there
     * was no `else` — so a `getConfigForPath` that returned `false` after
     * having returned `true` for another collection left the plugin switched on.
     */
    useEffect(() => {
        if (!getConfigForPath) {
            setAllowedHere(true);
            return;
        }
        setAllowedHere(Boolean(getConfigForPath({ path, collection })));
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
        fetchAiStatus({ endpoint, signal: abort.signal })
            .then((status) => setServiceAvailable(status.available))
            .catch(() => setServiceAvailable(false));
        return () => abort.abort();
    }, [allowedHere, endpoint]);

    const enabled = allowedHere && serviceAvailable;

    const clearSuggestion = useCallback((propertyKey: string) => {
        setSuggestions((prev) => {
            //remove propertyKey from prev
            const {
                [propertyKey]: _,
                ...rest
            } = prev;
            return rest;
        });
    }, []);

    const appendValueDelta = useCallback((propertyKey: string, delta: string) => {

        const property = getPropertyFromKey(properties, propertyKey);
        if (delta === null || property?.disabled) {
            return;
        }

        const value = getValueInPath(valuesRef.current, propertyKey);

        const currentValue = value ? (value as string) + "" : "";
        const updatedValue = currentValue + delta;
        valuesRef.current = {
            ...valuesRef.current,
            [propertyKey]: updatedValue
        };
        formContext?.setFieldValue(propertyKey, updatedValue, false);
        setSuggestions(prev => ({
            ...prev,
            [propertyKey]: (prev[propertyKey] ?? "") + delta
        }));
    }, [properties, formContext]);

    /**
     * Apply one completed field.
     *
     * The append-vs-replace dance below is what makes autofill feel additive
     * rather than destructive: when the generated text starts with what the
     * operator already typed, their words are kept and the rest is appended.
     */
    const applyValue = useCallback((propertyKey: string, rawValue: unknown, replaceValues: boolean) => {

        setLoadingSuggestions((prev) => prev.filter(p => p !== propertyKey));

        const property = getPropertyFromKey(properties, propertyKey);
        if (!property || property.disabled) return;

        const suggestion = coerceToProperty(rawValue, property);
        if (suggestion === null || suggestion === undefined) return;

        const value = getValueInPath(valuesRef.current, propertyKey);

        // Only text can be appended to. A number, a boolean, a date or an array
        // of tags is a whole value or nothing — the old code ran all of them
        // through the string-append path, which stringified them into the field.
        if (typeof suggestion !== "string" || replaceValues) {
            formContext?.setFieldValue(propertyKey, suggestion);
            if (typeof suggestion === "string" || typeof suggestion === "number") {
                setSuggestions(prev => ({ ...prev, [propertyKey]: suggestion }));
            }
            return;
        }

        const appendableValue = getAppendableSuggestion(suggestion, value);
        const currentValue = value ? (value as string) + "" : "";

        if (appendableValue) {
            formContext?.setFieldValue(propertyKey, suggestion);
        } else {
            const multiline = property.fieldConfigId === "multiline" || property.fieldConfigId === "markdown";
            const trimmedValue = currentValue.trimEnd();
            if (multiline && (trimmedValue.endsWith(".") || trimmedValue.endsWith("?") || trimmedValue.endsWith("!") || trimmedValue.endsWith(":"))) {
                formContext?.setFieldValue(propertyKey, trimmedValue + "\n\n" + suggestion.trimStart());
            } else {
                formContext?.setFieldValue(propertyKey, trimmedValue + (trimmedValue.length > 0 ? " " : "") + suggestion);
            }
        }

        setSuggestions(prev => ({
            ...prev,
            [propertyKey]: appendableValue ?? suggestion
        }));
    }, [properties, formContext]);

    const editorAIController = useEditorAIController({ endpoint });

    const clearAllSuggestions = useCallback(() => {
        setSuggestions({});
    }, []);

    const enhance = useCallback(async (props: EnhanceParams<Record<string, unknown>>): Promise<AutofillResult | null> => {

        if (!authController.user) {
            snackbarController.open({
                type: "warning",
                message: "You need to be logged in to use autofill"
            });
            return Promise.reject(new Error("Not logged in"));
        }

        if (props.propertyKey) {
            clearSuggestion(props.propertyKey);
        } else {
            clearAllSuggestions();
        }

        setLoadingSuggestions((prev) => [...prev, ...(props.propertyKey ? [props.propertyKey] : Object.keys(properties))]);
        enhancingInProgress.current = true;

        try {
            const result = await autofillStream({
                endpoint,
                request: {
                    entityName: collection.singularName ?? collection.name,
                    entityDescription: collection.description,
                    values: (props.values ?? {}) as Record<string, unknown>,
                    properties,
                    propertyKey: props.propertyKey,
                    propertyInstructions: props.propertyInstructions,
                    instructions: props.instructions
                },
                onDelta: appendValueDelta,
                onValue: (key, value) => applyValue(key, value, props.replaceValues ?? false)
            });

            if (Object.keys(result.suggestions).length === 0) {
                snackbarController.open({
                    type: "info",
                    autoHideDuration: 1800,
                    message: "No fields were updated"
                });
            }
            return result;
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : "Autofill could not be completed";
            snackbarController.open({
                type: "error",
                message
            });
            throw e;
        } finally {
            setLoadingSuggestions([]);
            enhancingInProgress.current = false;
        }
    }, [
        authController.user, clearSuggestion, clearAllSuggestions, properties, endpoint,
        collection, appendValueDelta, applyValue, snackbarController
    ]);

    const getSamplePrompts = useCallback(async (entityName: string, input?: string) => {
        return fetchPromptSuggestions({
            endpoint,
            entityName,
            input
        });
    }, [endpoint]);

    const dataEnhancementController: DataEnhancementController = useMemo(() => ({
        enabled,
        suggestions,
        clearSuggestion,
        enhance,
        allowReferenceDataSelection,
        clearAllSuggestions,
        getSamplePrompts,
        loadingSuggestions,
        editorAIController
    }), [
        enabled,
        suggestions,
        clearSuggestion,
        enhance,
        allowReferenceDataSelection,
        clearAllSuggestions,
        getSamplePrompts,
        loadingSuggestions,
        editorAIController
    ]);

    return (
        <DataEnhancementControllerContext.Provider
            value={dataEnhancementController}>
            {children}
        </DataEnhancementControllerContext.Provider>
    );
}
