import React, { useCallback, useEffect, useRef } from "react";

import {
    CircularProgress,
    cls,
    fieldBackgroundMixin,
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
import { PluginFormActionProps } from "@rebasepro/cms-types";
import { isPropertyBuilder, stripCollectionPath } from "@rebasepro/common";
import { useDataEnhancementController } from "./DataEnhancementControllerProvider";
import { AutofillReviewDialog } from "./AutofillReviewDialog";
import { SamplePrompt } from "../types/data_enhancement_controller";

export function FormEnhanceAction({
    path,
    status,
    collection,
    formContext
}: PluginFormActionProps) {

    const storageKey = createLocalStorageKey(path, status);

    const dataEnhancementController = useDataEnhancementController();

    const [samplePrompts, setSamplePrompts] = React.useState<SamplePrompt[] | undefined>(undefined);
    const [instructions, setInstructions] = React.useState<string>("");

    const getSamplePrompts = dataEnhancementController?.getSamplePrompts;

    /**
     * Driven by the controller rather than by local state.
     *
     * There is exactly one run at a time, and the review owns it — a second
     * `loading` flag here could disagree with the dialog about whether the
     * model is still writing.
     */
    const loading = dataEnhancementController?.review?.status === "generating";

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

    /**
     * Starts a run and opens the review. Nothing is written to the form here —
     * see {@link AutofillReviewDialog}.
     */
    const generate = (prompt?: string) => {
        if (!dataEnhancementController || !formContext?.values) return;
        if (prompt) {
            addRecentPrompt(storageKey, prompt);
            setSamplePrompts([{
                prompt,
                type: "recent"
            }, ...(samplePrompts ?? []).slice(0, 5)]);
        }
        // The controller records a failure in the review itself, so there is
        // nothing to catch here — but the promise is still explicitly handled
        // so a rejection can never surface as an unhandled one.
        dataEnhancementController.generate({
            values: formContext.values,
            instructions: prompt
        }).catch(() => undefined);
    };

    if (!dataEnhancementController?.enabled)
        return null;

    function submit() {
        generate(instructions);
    }

    return (
        <>
            <Menu
                align={"end"}
                sideOffset={8}
                className={"max-w-[100vw]"}
                // Never full width: this used to stretch to fill the form's
                // `w-80 2xl:w-96` side rail in full screen. That rail is gone, and
                // in the footer a stretched button reads as the primary action.
                // Icon only. The label is carried by `aria-label`/`title` — a
                // `Tooltip` here would swallow the menu: both it and
                // `DropdownMenu.Trigger` render `asChild`, and `Tooltip` drops
                // the props Radix clones onto it, so the menu never opens.
                trigger={<IconButton variant={"filled"}
                    size={"small"}
                    aria-label={"Autofill"}
                    title={"Autofill"}
                    disabled={loading}>
                    {!loading && <AIIcon size={"small"}/>}
                    {loading && <CircularProgress size={"small"}/>}
                </IconButton>}>

                <MenuItem className={"py-4"}
                    onClick={() => {
                        generate();
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
                            generate(samplePrompt.prompt);
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

                {/* `px-4` and `gap-4` are MenuItem's own paddings, so the input
                    row lines up with the items above it instead of sitting 8px
                    to their left — which is what `mx-2` on the textarea did. */}
                {/* `items-center` so the send button sits on the field's centre
                    line rather than pinned to its top edge as the textarea grows. */}
                <div
                    className={cls(
                        "my-2 px-4 py-2 gap-4 w-[500px] max-w-full flex items-center text-surface-700 dark:text-surface-200"
                    )}>

                    <div className={"relative w-full grow"}>
                        {/* `fieldBackgroundMixin`, the same surface every other input
                            in the codebase uses. It was `dark:bg-surface-950`, which
                            theme.css defines as literal `#000000` — a pure black
                            rectangle inside an already-dark menu. */}
                        <TextareaAutosize
                            className={cls("p-3 pr-12 rounded-lg resize-none w-full outline-hidden max-h-[300px] overflow-auto", fieldBackgroundMixin, focusedDisabled)}
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

                        {/* Inside the field and only when there is something to
                            clear — a permanently-visible X on an empty box is a
                            control that does nothing. Positioned exactly as
                            `TextFieldBinding` positions its own clearable X, so
                            it stays centred as the textarea grows. */}
                        {instructions.length > 0 && !loading && (
                            <div
                                className={"flex flex-row justify-center items-center absolute h-full right-0 top-0 mr-2"}>
                                <IconButton
                                    size={"small"}
                                    onClick={() => {
                                        setInstructions("");
                                    }}>
                                    <XIcon size={iconSize.small}/>
                                </IconButton>
                            </div>
                        )}
                    </div>

                    <IconButton
                        onClick={() => generate(instructions)}
                        size={"small"}
                        color={!instructions ? "primary" : undefined}
                        disabled={loading || !instructions}>
                        {loading &&
                            <CircularProgress size={"smallest"}/>}
                        {/* Sized, and no `color`. These icons are re-exported
                            straight from lucide, so `color` lands on the SVG as
                            a CSS colour — and `"primary"` is not one, which is
                            why this button rendered empty. Every other icon in
                            the codebase passes `size` alone and inherits
                            `currentColor` from the button. */}
                        {!loading &&
                            <SendIcon size={iconSize.small}/>}
                    </IconButton>

                </div>

            </Menu>

            <AutofillReviewDialog/>
        </>
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
