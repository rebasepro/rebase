import React from "react";
import { SearchBar } from "@rebasepro/ui";

// Ported from UIReferenceView's "Form Inputs" section.
export const Basic = () => (
    <div className="w-[380px] p-4">
        <SearchBar placeholder="Search entities…"/>
    </div>
);

export const Sizes = () => (
    <div className="flex flex-col gap-3 w-[380px] p-4">
        {(["medium", "small", "smallest"] as const).map(size => (
            <SearchBar key={size} size={size} placeholder={`Search — ${size}`}/>
        ))}
    </div>
);

export const States = () => (
    <div className="flex flex-col gap-3 w-[380px] p-4">
        <SearchBar initialValue="users" placeholder="Search entities…"/>
        <SearchBar loading placeholder="Searching…"/>
        <SearchBar disabled placeholder="Search disabled"/>
    </div>
);
