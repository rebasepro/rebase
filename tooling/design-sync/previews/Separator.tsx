import React from "react";
import { Separator, Typography } from "@rebasepro/ui";

export const Horizontal = () => (
    <div className="p-4 w-64">
        <Typography variant="body2">Account</Typography>
        <Separator orientation="horizontal"/>
        <Typography variant="body2">Billing</Typography>
    </div>
);

export const Vertical = () => (
    <div className="flex items-center p-4 h-10">
        <Typography variant="body2" color="secondary">Overview</Typography>
        <Separator orientation="vertical"/>
        <Typography variant="body2" color="secondary">Members</Typography>
        <Separator orientation="vertical"/>
        <Typography variant="body2" color="secondary">Settings</Typography>
    </div>
);
