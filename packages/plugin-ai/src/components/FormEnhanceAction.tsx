
import React, { useCallback, useDeferredValue, useEffect, useRef } from "react";

import {
    Button,
    CircularProgress,
    cls,
    focusedDisabled,
    IconButton,
    iconSize,
    Menu,
    MenuItem,
    SendIcon,
    Separator,
    TextareaAutosize,
    XIcon
} from "@rebasepro/ui";
import {
    AIIcon
} from "@rebasepro/app";
import { EntityStatus, Properties, Property } from "@rebasepro/types";
import { PluginFormActionProps } from "@rebasepro/admin-types";
import { isPropertyBuilder, stripCollectionPath } from "@rebasepro/common";
import { useDataEnhancementController } from "./DataEnhancementControllerProvider";
import { SamplePrompt } from "../types/data_enhancement_controller";

export function FormEnhanceAction({
    entityId,
    path,
    status,
    collection,
    formContext,
    openEntityMode
}: PluginFormActionProps) {


    const storageKey = createLocalStorageKey(path, status);

    const [loading, setLoading] = React.useState(false);
    const dataEnhancementController = useDataEnhancementController();

    const [samplePrompts, setSamplePrompts] = React.useState<SamplePrompt[] | undefined>(undefined);
    const [instructions, setInstructions] = React.useState<string>("");

    const getSamplePrompts = dataEnhancementController?.getSamplePrompts;

    const loadingPrompts = useRef(false);
    const updateSuggestedPrompts = useCallback(async function updateSuggestedPrompts(instructions?: string) {
        if (!getSamplePrompts) return;
        if (loadingPrompts.current) return;
        loadingPrompts.current = true;
        const prompts = status === "new"
            ? (await getSamplePrompts(collection.singularName ?? collection.name, instructions)).prompts
            : getPromptsForExistingEntities(collection.properties);

        const recentPromptsFromStorage = getRecentPromptsFromStorage(storageKey);
        const recentPrompts = recentPromptsFromStorage.map(prompt => prompt.prompt);
        setSamplePrompts([...recentPromptsFromStorage, ...prompts.filter(p => !recentPrompts.includes(p.prompt))].slice(0, 5));
        loadingPrompts.current = false;
    },
        [collection.name, collection.singularName, getSamplePrompts, status]);

    const deferredValues = useDeferredValue(formContext?.values);
    // const enoughData = countStringCharacters(deferredValues, collection.properties) > 20;

    useEffect(() => {
        if (!dataEnhancementController) return;
        if (!samplePrompts) {
            setSamplePrompts(getRecentPromptsFromStorage(storageKey));
            updateSuggestedPrompts().then();
        }
    }, [dataEnhancementController, samplePrompts, storageKey, updateSuggestedPrompts, instructions, status]);

    useEffect(() => {
        if (!dataEnhancementController) return;
        updateSuggestedPrompts().then();
    }, [dataEnhancementController, status]);

    const enhance = (prompt?: string) => {
        if (!dataEnhancementController || !formContext?.values) return;
        setLoading(true);
        if (prompt) {
            addRecentPrompt(storageKey, prompt);
            setSamplePrompts([{
                prompt,
                type: "recent"
            }, ...(samplePrompts ?? []).slice(0, 5)]);
        }
        return dataEnhancementController.enhance({
            entityId,
            values: formContext!.values,
            instructions: prompt,
            replaceValues: true
        }).catch(() => {
            // The controller has already shown the failure in a snackbar. This
            // handler exists so the rejection is not left unhandled: nothing
            // awaits the click, so an uncaught one surfaces as a console error
            // on top of the message the operator has already been given.
            return null;
        }).finally(() => {
            setLoading(false);
        });
    };

    if (!dataEnhancementController?.enabled)
        return null;

    const suggestions = dataEnhancementController.suggestions;
    const hasSuggestions = Object.values(suggestions).filter(Boolean).length > 0;

    const disabledSuggestionActions = !hasSuggestions;
    const promptSuggestionsEnabled = (samplePrompts ?? []).length > 0 && instructions.length === 0;

    // const noIdSet = !formContext?.entityId;

    function submit() {
        enhance(instructions);
    }

    return (
        <Menu
            align={"end"}
            sideOffset={8}
            className={"max-w-[100vw]"}
            // Never full width: this used to stretch to fill the form's
            // `w-80 2xl:w-96` side rail in full screen. That rail is gone, and
            // in the footer a stretched button reads as the primary action.
            trigger={<Button variant={"filled"}
                color={"neutral"}
                size={"small"}
                disabled={loading}>
                {!loading && <AIIcon size={"small"}/>}
                {loading && <CircularProgress size={"small"}/>}
                Autofill
            </Button>}>

            <MenuItem className={"py-4"}
                onClick={() => {
                    enhance();
                }}>
                <AIIcon size={"small"}/>
                Autofill based on the current content
            </MenuItem>

            <Separator orientation={"horizontal"} className={"mt-2"}/>

            {samplePrompts?.map((samplePrompt, index) => {
                return <MenuItem
                    key={index + "_" + samplePrompt.prompt}
                    onClick={() => {
                        setInstructions(samplePrompt.prompt);
                        enhance(samplePrompt.prompt);
                    }}
                >
                    <div className={"pl-9 grow text-text-secondary dark:text-text-secondary-dark"}>
                        {samplePrompt.prompt}
                    </div>

                    {samplePrompt.type === "recent" && <IconButton
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            removeRecentPrompt(storageKey, samplePrompt.prompt);
                            setSamplePrompts((samplePrompts ?? []).filter(p => p.prompt !== samplePrompt.prompt));
                        }}
                        size={"smallest"}
                    >
                        <XIcon size={iconSize.smallest}/>
                    </IconButton>
                    }
                </MenuItem>;
            })}

            <Separator orientation={"horizontal"}/>

            <div
                className={cls(
                    "my-2 w-[500px] max-w-full flex items-start text-surface-700 dark:text-surface-200"
                )}>

                <TextareaAutosize
                    className={cls("p-4 rounded-lg resize-none bg-surface-100 dark:bg-surface-950 mx-2 w-full grow outline-hidden max-h-[300px] overflow-auto", focusedDisabled)}
                    value={instructions}
                    autoFocus={status === "new"}
                    disabled={loading}
                    onFocus={(event) => {
                        event.stopPropagation();
                    }}
                    placeholder={"...or provide instructions"}
                    onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            submit();
                        }

                    }}
                    onChange={(e) => {
                        setInstructions(e.target.value);
                    }}
                />

                <IconButton
                    size={"small"}
                    onClick={() => {
                        setInstructions("");
                    }}
                    color={!instructions ? "primary" : undefined}
                    disabled={loading || !instructions}>
                    <XIcon size={iconSize.small}/>
                </IconButton>

                <IconButton
                    onClick={() => enhance(instructions)}
                    size={"small"}
                    color={!instructions ? "primary" : undefined}
                    disabled={loading || !instructions}>
                    {loading &&
                        <CircularProgress size={"smallest"}/>}
                    {!loading &&
                        <SendIcon color={"primary"}/>}
                </IconButton>

            </div>

        </Menu>
    );
}

function getPromptsForExistingEntities(properties: Properties): SamplePrompt[] {

    const multilineProperties = Object.values(properties).filter((p: Property) => {
        if (isPropertyBuilder(p)) {
            return false;
        }
        return p.type === "string" && (p.admin?.markdown || p.admin?.multiline);
    });

    const multilinePrompt: Property | undefined = multilineProperties.length > 0
        ? multilineProperties[Math.floor(Math.random() * multilineProperties.length)] as Property
        : undefined;

    const prompts = [
        "Fill the missing fields",
        "Translate the missing content"
    ];
    if (multilinePrompt) {
        prompts.push(`Add 2 paragraphs to '${multilinePrompt.name}'`);
    }
    return prompts.map(p => ({
        prompt: p,
        type: "sample"
    }));
}

const createLocalStorageKey = (path: string, status: EntityStatus) => {
    const statusString = status === "new" ? "new" : "existing";
    return `data_enhancement::${statusString}::${stripCollectionPath(path)}`;
};

const getRecentPromptsFromStorage = (storageKey: string): SamplePrompt[] => {
    const item = localStorage.getItem(storageKey);
    return item ? JSON.parse(item).map((e: string) => ({
        prompt: e,
        type: "recent"
    })) : [];
};

const addRecentPrompt = (storageKey: string, prompt: string) => {
    if (!prompt || prompt.trim().length === 0) {
        return;
    }
    const recentPrompts = getRecentPromptsFromStorage(storageKey);
    localStorage.setItem(storageKey, JSON.stringify([prompt, ...recentPrompts
        .map(e => e.prompt)
        .filter(e => e !== prompt)
        .slice(0, 5)]));
};

const removeRecentPrompt = (storageKey: string, prompt: string) => {
    localStorage.setItem(storageKey, JSON.stringify(getRecentPromptsFromStorage(storageKey)
        .map(e => e.prompt)
        .filter(e => e !== prompt)));
};
