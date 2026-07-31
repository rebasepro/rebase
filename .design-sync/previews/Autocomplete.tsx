import React from "react";
import { Autocomplete, AutocompleteItem, TextField } from "@rebasepro/ui";

// Autocomplete is a controlled dropdown surface (`open`/`setOpen`) meant to
// sit directly under a text input, positioned via its own
// `absolute top-full left-0 right-0` — the parent needs `position: relative`
// and enough room below for the panel.
export const TableSearch = () => (
    <div className="p-4 h-[320px]">
        <div className="relative w-[320px]">
            <TextField label="Search tables" value="use" onChange={() => {}}/>
            <Autocomplete open setOpen={() => {}}>
                <AutocompleteItem>
                    <div className="px-4">users</div>
                </AutocompleteItem>
                <AutocompleteItem>
                    <div className="px-4">user_roles</div>
                </AutocompleteItem>
                <AutocompleteItem>
                    <div className="px-4">user_sessions</div>
                </AutocompleteItem>
            </Autocomplete>
        </div>
    </div>
);

// Empty state — the surface is still authored open, just with a single
// non-interactive row instead of matches.
export const NoResults = () => (
    <div className="p-4 h-[260px]">
        <div className="relative w-[320px]">
            <TextField label="Search tables" value="zzz" onChange={() => {}}/>
            <Autocomplete open setOpen={() => {}}>
                <div className="px-4 h-[48px] flex items-center text-text-secondary dark:text-text-secondary-dark text-sm">
                    No tables match "zzz"
                </div>
            </Autocomplete>
        </div>
    </div>
);

// Closed — the input on its own, before focus opens the panel.
export const Closed = () => (
    <div className="p-4">
        <div className="relative w-[320px]">
            <TextField label="Search tables" placeholder="Search…"/>
            <Autocomplete open={false} setOpen={() => {}}>
                <AutocompleteItem><div className="px-4">users</div></AutocompleteItem>
            </Autocomplete>
        </div>
    </div>
);
