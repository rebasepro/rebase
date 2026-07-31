import React from "react";
import { InfoLabel } from "@rebasepro/ui";

export const Modes = () => (
    <div className="flex flex-col gap-3 p-4 w-[420px]">
        <InfoLabel mode="info">
            Policies are evaluated per row, for every read and write.
        </InfoLabel>
        <InfoLabel mode="warn">
            This action cannot be undone once the migration has run.
        </InfoLabel>
    </div>
);

export const InFormContext = () => (
    <div className="flex flex-col gap-2 p-4 w-[420px]">
        <div className="text-sm font-medium">Delete collection</div>
        <InfoLabel mode="warn">
            Deleting <strong>products</strong> removes all 1,204 rows and cannot be reversed.
        </InfoLabel>
    </div>
);
