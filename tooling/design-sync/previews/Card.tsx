import React from "react";
import { Card, Typography, Chip, FolderKanbanIcon, cls } from "@rebasepro/ui";

export const ProjectCard = () => (
    <div className="p-4 w-72">
        <Card className="overflow-hidden">
            <div className="relative h-20 bg-surface-100 dark:bg-surface-900 flex items-center justify-center">
                <FolderKanbanIcon size={26} className="text-surface-400 dark:text-surface-500"/>
                <div className="absolute top-2 right-2">
                    <Chip colorScheme="orange" size="smallest" outlined>High</Chip>
                </div>
            </div>
            <div className="p-3">
                <Typography variant="caption" color="disabled" className="font-mono text-[10px] block">PRJ-104</Typography>
                <Typography variant="body2" className="font-medium my-1">Q3 marketing site refresh</Typography>
                <div className="flex items-center gap-1.5 flex-wrap">
                    <Chip colorScheme="blue" size="smallest">In progress</Chip>
                    <Chip colorScheme="cyan" size="smallest">design</Chip>
                </div>
            </div>
        </Card>
    </div>
);

export const Clickable = () => (
    <div className="p-4 flex gap-4">
        <Card className={cls("p-4 w-48 cursor-pointer hover:shadow-md")} onClick={() => {}}>
            <Typography variant="body2" className="font-medium">Clickable card</Typography>
            <Typography variant="caption" color="secondary">Responds to click and Enter/Space</Typography>
        </Card>
        <Card className="p-4 w-48">
            <Typography variant="body2" className="font-medium">Static card</Typography>
            <Typography variant="caption" color="secondary">No onClick supplied</Typography>
        </Card>
    </div>
);
