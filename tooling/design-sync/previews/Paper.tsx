import React from "react";
import { Paper, Typography, Separator } from "@rebasepro/ui";

export const Basic = () => (
    <div className="p-4 w-72">
        <Paper className="p-4">
            <Typography variant="body2" className="font-medium">Billing details</Typography>
            <Typography variant="caption" color="secondary">Next invoice on Aug 1, 2026</Typography>
        </Paper>
    </div>
);

export const Sectioned = () => (
    <div className="p-4 w-80">
        <Paper className="p-4">
            <Typography variant="subtitle2" className="font-medium">Workspace settings</Typography>
            <Separator orientation="horizontal"/>
            <div className="flex flex-col gap-1">
                <Typography variant="body2">Name</Typography>
                <Typography variant="caption" color="secondary">Rebase Analytics</Typography>
            </div>
        </Paper>
    </div>
);
