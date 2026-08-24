import React from "react";
import { BooleanSwitchWithLabel } from "@rebasepro/ui";

export const States = () => (
    <div className="flex flex-col gap-3 w-[340px] p-4">
        <BooleanSwitchWithLabel value label="Enable row level security" onValueChange={() => {}}/>
        <BooleanSwitchWithLabel value={false} label="Allow public sign-up" onValueChange={() => {}}/>
        <BooleanSwitchWithLabel value disabled label="Managed by the platform" onValueChange={() => {}}/>
        <BooleanSwitchWithLabel value={false} error label="Requires a valid encryption key" onValueChange={() => {}}/>
    </div>
);

export const LabelPosition = () => (
    <div className="flex flex-col gap-3 w-[340px] p-4">
        <BooleanSwitchWithLabel value position="end" label='position="end"' onValueChange={() => {}}/>
        <BooleanSwitchWithLabel value position="start" label='position="start"' onValueChange={() => {}}/>
    </div>
);
