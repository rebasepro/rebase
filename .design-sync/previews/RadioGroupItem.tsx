import React from "react";
import { RadioGroup, RadioGroupItem, Label } from "@rebasepro/ui";

// RadioGroupItem only renders inside a RadioGroup — full parent composition,
// focused on item-level render states rather than group-level layout.
export const CheckedAndUnchecked = () => (
    <RadioGroup value="email" onValueChange={() => {}} className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
            <RadioGroupItem value="email" id="notify-email"/>
            <Label htmlFor="notify-email">Email</Label>
        </div>
        <div className="flex items-center gap-2">
            <RadioGroupItem value="sms" id="notify-sms"/>
            <Label htmlFor="notify-sms">SMS</Label>
        </div>
    </RadioGroup>
);

// Item-level disabled — one item disabled inside an otherwise enabled group.
export const DisabledItem = () => (
    <RadioGroup value="visa" onValueChange={() => {}} className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
            <RadioGroupItem value="visa" id="card-visa"/>
            <Label htmlFor="card-visa">Visa ····4242</Label>
        </div>
        <div className="flex items-center gap-2">
            <RadioGroupItem value="amex" id="card-amex" disabled/>
            <Label htmlFor="card-amex">Amex ····1000 (expired)</Label>
        </div>
    </RadioGroup>
);
