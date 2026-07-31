import React from "react";
import { Avatar, Typography } from "@rebasepro/ui";

export const Initials = () => (
    <div className="flex items-center gap-4 p-4">
        <Avatar>A</Avatar>
        <Avatar>MJ</Avatar>
        <Avatar>RK</Avatar>
    </div>
);

export const WithImage = () => (
    <div className="flex items-center gap-4 p-4">
        <Avatar src="https://i.pravatar.cc/80?img=12" alt="Alice Johnson"/>
        <Avatar src="https://i.pravatar.cc/80?img=33" alt="Marcus Reyes"/>
    </div>
);

export const BrokenImageFallback = () => (
    <div className="flex flex-col items-center gap-2 p-4">
        <Avatar src="https://broken.example/not-found.png" alt="Fallback">DJ</Avatar>
        <Typography variant="caption" color="secondary">falls back to initials on load error</Typography>
    </div>
);

export const InAccountMenuTrigger = () => (
    <div className="flex items-center justify-between p-4 rounded-lg border border-surface-200 dark:border-surface-700 w-64">
        <div>
            <Typography variant="body2" className="font-medium">Alice Johnson</Typography>
            <Typography variant="caption" color="secondary">alice@example.com</Typography>
        </div>
        <Avatar hover>A</Avatar>
    </div>
);
