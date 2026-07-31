import React from "react";
import { Chip, TagIcon } from "@rebasepro/ui";

// The 15 real CHIP_COLORS keys. NOTE: UIReferenceView passes "purpleDark" /
// "blueDark", which are NOT keys of CHIP_COLORS — those chips fall through to
// the default scheme. Use the keys below.
const SCHEMES = ["blue", "teal", "red", "green", "yellow", "orange", "purple",
    "pink", "cyan", "indigo", "violet", "fuchsia", "rose", "emerald", "gray"] as const;

export const ColorSchemes = () => (
    <div className="flex flex-wrap gap-2 p-4 max-w-[520px]">
        {SCHEMES.map(s => <Chip key={s} colorScheme={s}>{s}</Chip>)}
    </div>
);

export const Sizes = () => (
    <div className="flex flex-wrap gap-2 items-center p-4">
        {(["smallest", "small", "medium", "large"] as const).map(sz => (
            <Chip key={sz} colorScheme="blue" size={sz}>{sz}</Chip>
        ))}
    </div>
);

export const Outlined = () => (
    <div className="flex flex-wrap gap-2 items-center p-4">
        <Chip colorScheme="red" outlined>Outlined red</Chip>
        <Chip colorScheme="blue" outlined>Outlined blue</Chip>
        <Chip outlined>Default outlined</Chip>
    </div>
);

export const Variants = () => (
    <div className="flex flex-wrap gap-2 items-center p-4">
        <Chip error>Error</Chip>
        <Chip error outlined>Error outlined</Chip>
        <Chip onClick={() => {}}>Clickable</Chip>
        <Chip icon={<TagIcon size={12}/>} colorScheme="teal">With icon</Chip>
        <Chip>Default</Chip>
    </div>
);

// How chips actually appear in the product: role tags in a table cell.
export const AsRoleTags = () => (
    <div className="flex flex-wrap gap-2 p-4">
        <Chip colorScheme="purple" size="small">Admin</Chip>
        <Chip colorScheme="blue" size="small">Editor</Chip>
        <Chip colorScheme="gray" size="small">Viewer</Chip>
    </div>
);
