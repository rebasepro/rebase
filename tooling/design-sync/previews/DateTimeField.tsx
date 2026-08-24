import React from "react";
import { DateTimeField } from "@rebasepro/ui";

export const Modes = () => (
    <div className="flex flex-col gap-3 w-[320px] p-4">
        <DateTimeField mode="date" label="Published on" value={new Date("2026-07-31")} onChange={() => {}}/>
        <DateTimeField mode="date_time" label="Scheduled for" value={new Date("2026-07-31T14:30:00")} onChange={() => {}}/>
    </div>
);

export const States = () => (
    <div className="flex flex-col gap-3 w-[320px] p-4">
        <DateTimeField label="Error state" error value={new Date("2026-07-31")} onChange={() => {}}/>
        <DateTimeField label="Disabled" disabled value={new Date("2026-07-31")} onChange={() => {}}/>
        <DateTimeField label="Clearable" clearable value={new Date("2026-07-31")} onChange={() => {}}/>
    </div>
);

export const Sizes = () => (
    <div className="flex flex-col gap-3 w-[320px] p-4">
        <DateTimeField size="large" label="Large" value={new Date("2026-07-31")} onChange={() => {}}/>
        <DateTimeField size="medium" label="Medium" value={new Date("2026-07-31")} onChange={() => {}}/>
        <DateTimeField size="small" label="Small" value={new Date("2026-07-31")} onChange={() => {}}/>
        <DateTimeField size="smallest" label="Smallest" value={new Date("2026-07-31")} onChange={() => {}}/>
    </div>
);
