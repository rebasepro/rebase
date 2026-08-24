import React from "react";
import { Badge, IconButton, Avatar, MailIcon } from "@rebasepro/ui";

export const Colors = () => (
    <div className="flex items-center gap-6 p-4">
        <Badge color="primary"><Avatar>A</Avatar></Badge>
        <Badge color="secondary"><Avatar>B</Avatar></Badge>
        <Badge color="warning"><Avatar>C</Avatar></Badge>
        <Badge color="error"><Avatar>D</Avatar></Badge>
    </div>
);

export const OnIconButton = () => (
    <div className="flex items-center gap-6 p-4">
        <Badge color="error">
            <IconButton size="medium" aria-label="Messages">
                <MailIcon size={18}/>
            </IconButton>
        </Badge>
        <Badge color="error" invisible>
            <IconButton size="medium" aria-label="Messages">
                <MailIcon size={18}/>
            </IconButton>
        </Badge>
    </div>
);
