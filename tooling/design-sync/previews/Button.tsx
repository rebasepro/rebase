import React from "react";
import { Button, PlusIcon, Trash2Icon, DownloadIcon } from "@rebasepro/ui";

// Variant × color grid — ported from UIReferenceView's "Buttons" section,
// extended with `outlined` (in ButtonProps but absent from the reference view).
export const Variants = () => (
    <div className="flex flex-col gap-5 p-4">
        {(["filled", "outlined", "text"] as const).map(variant => (
            <div key={variant}>
                <div className="text-xs font-mono text-surface-500 mb-2">variant=&quot;{variant}&quot;</div>
                <div className="flex flex-wrap gap-3 items-center">
                    {(["primary", "secondary", "error", "neutral", "text"] as const).map(color => (
                        <Button key={color} variant={variant} color={color}>
                            {color.charAt(0).toUpperCase() + color.slice(1)}
                        </Button>
                    ))}
                </div>
            </div>
        ))}
    </div>
);

export const Sizes = () => (
    <div className="flex flex-wrap items-end gap-3 p-4">
        {(["small", "medium", "large", "xl", "2xl"] as const).map(size => (
            <Button key={size} size={size}>
                {size.charAt(0).toUpperCase() + size.slice(1)}
            </Button>
        ))}
    </div>
);

export const WithIcons = () => (
    <div className="flex flex-wrap gap-3 items-center p-4">
        <Button><PlusIcon size={18}/> Add property</Button>
        <Button variant="outlined"><DownloadIcon size={18}/> Export</Button>
        <Button variant="text" color="error"><Trash2Icon size={18}/> Delete</Button>
    </div>
);

export const Disabled = () => (
    <div className="flex flex-wrap gap-3 items-center p-4">
        <Button disabled>Filled</Button>
        <Button variant="outlined" disabled>Outlined</Button>
        <Button variant="text" disabled>Text</Button>
    </div>
);

export const FullWidth = () => (
    <div className="w-[320px] p-4">
        <Button fullWidth>Save changes</Button>
    </div>
);
