import React from "react";
import { PopoverPrimitive, cls, defaultBorderMixin, TextField, Typography, SearchIcon } from "@rebasepro/ui";

// PopoverPrimitive is the raw @radix-ui/react-popover namespace re-exported
// (Root/Trigger/Portal/Content/Arrow/...), unstyled by itself — the `Popover`
// component wraps it with DS chrome. This is how internal DS consumers
// (e.g. RelationSelector) build custom popover surfaces on top of it.
// Root passes straight through to Radix, so `open` is a real controlled
// prop even though PopoverPrimitiveProps is `{[key: string]: unknown}`.
// Content still portals to <body> and escapes the card — needs
// cfg.overrides.PopoverPrimitive = { cardMode: "single", primaryStory: "Default" }.

export const Default = () => (
    <div className="p-4 h-[320px] flex items-center justify-center">
        <PopoverPrimitive.Root open onOpenChange={() => {}} modal={false}>
            <PopoverPrimitive.Trigger asChild>
                <button
                    type="button"
                    className={cls("px-3 py-1.5 text-sm rounded-md border bg-white dark:bg-surface-900", defaultBorderMixin)}
                >
                    Select table…
                </button>
            </PopoverPrimitive.Trigger>
            <PopoverPrimitive.Content
                align="start"
                sideOffset={8}
                className={cls("z-50 overflow-hidden border bg-white dark:bg-surface-900 rounded-lg w-64", defaultBorderMixin)}
            >
                <div className="p-2 border-b border-surface-200 dark:border-surface-700 flex items-center gap-2">
                    <SearchIcon size={14} className="text-text-disabled dark:text-text-disabled-dark"/>
                    <TextField invisible value="" onChange={() => {}} placeholder="Search tables…" size="small"/>
                </div>
                <div className="py-1">
                    {["users", "orders", "products"].map(t => (
                        <div key={t} className="px-3 py-1.5 text-sm cursor-pointer hover:bg-surface-100 dark:hover:bg-surface-900">
                            {t}
                        </div>
                    ))}
                </div>
                <PopoverPrimitive.Arrow className="fill-white dark:fill-surface-900"/>
            </PopoverPrimitive.Content>
        </PopoverPrimitive.Root>
    </div>
);

export const WithAnchorText = () => (
    <div className="p-4 h-[280px] flex items-center justify-center">
        <PopoverPrimitive.Root open onOpenChange={() => {}} modal={false}>
            <PopoverPrimitive.Trigger asChild>
                <button
                    type="button"
                    className={cls("px-3 py-1.5 text-sm rounded-md border bg-white dark:bg-surface-900", defaultBorderMixin)}
                >
                    Column type
                </button>
            </PopoverPrimitive.Trigger>
            <PopoverPrimitive.Content
                side="right"
                align="start"
                sideOffset={8}
                className={cls("z-50 border bg-white dark:bg-surface-900 rounded-lg w-56 p-3", defaultBorderMixin)}
            >
                <Typography variant="caption" color="secondary">
                    <code className="font-mono">uuid</code> — auto-generated primary key, immutable after insert.
                </Typography>
                <PopoverPrimitive.Arrow className="fill-white dark:fill-surface-900"/>
            </PopoverPrimitive.Content>
        </PopoverPrimitive.Root>
    </div>
);
