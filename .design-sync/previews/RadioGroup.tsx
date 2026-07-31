import React from "react";
import { RadioGroup, RadioGroupItem, Label } from "@rebasepro/ui";

// RadioGroupItem only renders inside a RadioGroup, and needs a paired Label
// to be a plausible field — the canonical Radix composition.
export const Basic = () => (
    <RadioGroup value="pro" onValueChange={() => {}} className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
            <RadioGroupItem value="free" id="plan-free"/>
            <Label htmlFor="plan-free">Free — 1 project</Label>
        </div>
        <div className="flex items-center gap-2">
            <RadioGroupItem value="pro" id="plan-pro"/>
            <Label htmlFor="plan-pro">Pro — unlimited projects</Label>
        </div>
        <div className="flex items-center gap-2">
            <RadioGroupItem value="team" id="plan-team"/>
            <Label htmlFor="plan-team">Team — shared workspaces</Label>
        </div>
    </RadioGroup>
);

export const DisabledGroup = () => (
    <RadioGroup value="weekly" onValueChange={() => {}} disabled className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
            <RadioGroupItem value="daily" id="freq-daily"/>
            <Label htmlFor="freq-daily">Daily digest</Label>
        </div>
        <div className="flex items-center gap-2">
            <RadioGroupItem value="weekly" id="freq-weekly"/>
            <Label htmlFor="freq-weekly">Weekly digest</Label>
        </div>
    </RadioGroup>
);

export const CustomLayout = () => (
    <RadioGroup value="yes" onValueChange={() => {}} className="grid grid-cols-3 gap-4 p-4 w-[320px]">
        <div className="flex items-center gap-2">
            <RadioGroupItem value="yes" id="confirm-yes"/>
            <Label htmlFor="confirm-yes">Yes</Label>
        </div>
        <div className="flex items-center gap-2">
            <RadioGroupItem value="no" id="confirm-no"/>
            <Label htmlFor="confirm-no">No</Label>
        </div>
        <div className="flex items-center gap-2">
            <RadioGroupItem value="maybe" id="confirm-maybe"/>
            <Label htmlFor="confirm-maybe">Maybe</Label>
        </div>
    </RadioGroup>
);
