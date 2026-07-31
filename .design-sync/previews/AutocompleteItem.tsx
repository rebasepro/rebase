import React from "react";
import { Autocomplete, AutocompleteItem, TextField } from "@rebasepro/ui";

export const Basic = () => (
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

// Richer row content — the item is a plain flex container, so it can carry
// more than a label (here: a table name plus its row count).
export const WithMeta = () => (
    <div className="p-4 h-[320px]">
        <div className="relative w-[320px]">
            <TextField label="Search tables" value="use" onChange={() => {}}/>
            <Autocomplete open setOpen={() => {}}>
                <AutocompleteItem>
                    <div className="px-4 flex justify-between w-full">
                        <span>users</span>
                        <span className="text-text-secondary dark:text-text-secondary-dark">1,204 rows</span>
                    </div>
                </AutocompleteItem>
                <AutocompleteItem>
                    <div className="px-4 flex justify-between w-full">
                        <span>user_roles</span>
                        <span className="text-text-secondary dark:text-text-secondary-dark">3 rows</span>
                    </div>
                </AutocompleteItem>
            </Autocomplete>
        </div>
    </div>
);
