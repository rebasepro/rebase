import React from "react";
import { Label } from "@rebasepro/ui";

export const Basic = () => (
    <div className="flex flex-col gap-2 p-4">
        <Label htmlFor="email-field">Email address</Label>
        <Label htmlFor="role-field">Role</Label>
    </div>
);

export const Bordered = () => (
    <div className="flex flex-wrap gap-2 p-4">
        <Label border>Draft</Label>
        <Label border>Published</Label>
        <Label border>Archived</Label>
    </div>
);

export const Clickable = () => (
    <div className="flex flex-col gap-1 p-4 w-[220px]">
        <Label onClick={() => {}}>Enable email notifications</Label>
        <Label onClick={() => {}}>Enable SMS notifications</Label>
    </div>
);
