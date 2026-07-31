import React from "react";
import { TextField } from "@rebasepro/ui";

// Ported from UIReferenceView's "Form Inputs" section.
export const States = () => (
    <div className="flex flex-col gap-3 w-[320px] p-4">
        <TextField label="Default" placeholder="Type something…"/>
        <TextField label="With value" value="Filled value" onChange={() => {}}/>
        <TextField label="Error state" error value="Bad value" onChange={() => {}}/>
        <TextField label="Disabled" disabled value="Read only" onChange={() => {}}/>
    </div>
);

// All four sizes. The reference view keeps these together deliberately: a
// labelled `small` field once shipped with its label on top of its placeholder.
export const Sizes = () => (
    <div className="flex flex-col gap-3 w-[320px] p-4">
        <TextField size="large" label="Large" placeholder="Placeholder under the label"/>
        <TextField size="medium" label="Medium" placeholder="Placeholder under the label"/>
        <TextField size="small" label="Small" placeholder="Placeholder under the label"/>
        <TextField size="smallest" label="Smallest" value="Filled value" onChange={() => {}}/>
    </div>
);

export const Multiline = () => (
    <div className="w-[380px] p-4">
        <TextField
            label="Description"
            multiline
            minRows={4}
            value={"Policies are evaluated per row, for every read and write.\nThe API never filters in application code."}
            onChange={() => {}}/>
    </div>
);

export const Types = () => (
    <div className="flex flex-col gap-3 w-[320px] p-4">
        <TextField type="email" label="Email" value="alice@example.com" onChange={() => {}}/>
        <TextField type="password" label="Password" value="hunter2hunter2" onChange={() => {}}/>
        <TextField type="number" label="Max rows" value={100} onChange={() => {}}/>
        <TextField type="date" label="Published on" value="2026-07-31" onChange={() => {}}/>
    </div>
);
