import React from "react";
import { Collapse, Typography, Chip } from "@rebasepro/ui";

// Ported from FavouritesView: a row of pinned-collection chips that collapses
// away entirely when the list is empty.
export const Expanded = () => (
    <div className="p-4 w-72">
        <Typography variant="caption" color="secondary" className="block mb-1">Favourites</Typography>
        <Collapse in>
            <div className="flex flex-row flex-wrap gap-2 pb-2 min-h-[32px]">
                <Chip size="small" colorScheme="blue">Posts</Chip>
                <Chip size="small" colorScheme="teal">Authors</Chip>
                <Chip size="small" colorScheme="purple">Products</Chip>
            </div>
        </Collapse>
    </div>
);

export const CollapsedEmpty = () => (
    <div className="p-4 w-72">
        <Typography variant="caption" color="secondary" className="block mb-1">Favourites (none pinned)</Typography>
        <div className="border border-dashed border-surface-300 dark:border-surface-700 rounded-md px-2">
            <Collapse in={false}>
                <div className="flex flex-row flex-wrap gap-2 pb-2 min-h-[32px]">
                    <Chip size="small" colorScheme="blue">Posts</Chip>
                </div>
            </Collapse>
            <Typography variant="caption" color="disabled" className="block py-2 text-center">height animates to 0 when `in` is false</Typography>
        </div>
    </div>
);
