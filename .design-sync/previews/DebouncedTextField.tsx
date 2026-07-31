import React from "react";
import { DebouncedTextField } from "@rebasepro/ui";

// Same contract as TextField (fixed shape from the orchestrator config —
// generics dropped by the .d.ts extractor); commits its value on a debounce,
// so it's typically used for live-filter/search inputs.
export const LiveSearch = () => (
    <div className="w-[320px] p-4">
        <DebouncedTextField
            label="Search records"
            value="analytics"
            onChange={() => {}}
            placeholder="Type to filter…"
        />
    </div>
);

export const Sizes = () => (
    <div className="flex flex-col gap-3 w-[320px] p-4">
        <DebouncedTextField size="large" label="Large" placeholder="Type to filter…"/>
        <DebouncedTextField size="medium" label="Medium" placeholder="Type to filter…"/>
        <DebouncedTextField size="small" label="Small" placeholder="Type to filter…"/>
        <DebouncedTextField size="smallest" label="Smallest" value="42" onChange={() => {}}/>
    </div>
);

export const States = () => (
    <div className="flex flex-col gap-3 w-[320px] p-4">
        <DebouncedTextField label="Error state" error value="Bad value" onChange={() => {}}/>
        <DebouncedTextField label="Disabled" disabled value="Read only" onChange={() => {}}/>
    </div>
);
