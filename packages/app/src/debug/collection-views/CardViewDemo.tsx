import React, { useState, useMemo } from "react";
import {
    Card, Typography, Chip, cls, defaultBorderMixin, SearchBar, ToggleButtonGroup,
    LayoutGridIcon, ListIcon, FolderKanbanIcon
} from "@rebasepro/ui";
import { SAMPLE_PROJECTS, STATUS_CONFIG, PRIORITY_CONFIG } from "./sample_data";
import type { SampleProject } from "./sample_data";

type CardSize = "sm" | "md" | "lg";

export function CardViewDemo() {
    const [searchTerm, setSearchTerm] = useState("");
    const [cardSize, setCardSize] = useState<CardSize>("md");

    const filtered = useMemo(() => {
        if (!searchTerm) return SAMPLE_PROJECTS;
        const lower = searchTerm.toLowerCase();
        return SAMPLE_PROJECTS.filter(p =>
            p.name.toLowerCase().includes(lower) || p.assignee.toLowerCase().includes(lower) || p.tags.some(t => t.toLowerCase().includes(lower))
        );
    }, [searchTerm]);

    const gridClass = useMemo(() => {
        switch (cardSize) {
            case "sm": return "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5";
            case "md": return "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4";
            case "lg": return "grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3";
        }
    }, [cardSize]);

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
                <SearchBar onTextSearch={(term) => setSearchTerm(term ?? "")} placeholder="Search cards…" size="small" />
                <ToggleButtonGroup value={cardSize} onValueChange={setCardSize} options={[
                    { value: "sm" as const, label: "Small", icon: <LayoutGridIcon size={14} /> },
                    { value: "md" as const, label: "Medium", icon: <ListIcon size={14} /> },
                    { value: "lg" as const, label: "Large", icon: <FolderKanbanIcon size={14} /> }
                ]} />
                <Typography variant="caption" color="secondary" className="ml-auto">{filtered.length} projects</Typography>
            </div>
            <div className={cls("grid gap-4", gridClass)}>
                {filtered.map(project => <ProjectCard key={project.id} project={project} compact={cardSize === "sm"} />)}
            </div>
            {filtered.length === 0 && <div className="flex items-center justify-center py-8"><Typography variant="label" color="secondary">No projects match your search</Typography></div>}
        </div>
    );
}

function ProjectCard({ project, compact }: { project: SampleProject; compact?: boolean }) {
    const statusCfg = STATUS_CONFIG[project.status];
    const priorityCfg = PRIORITY_CONFIG[project.priority];
    const isOverdue = new Date(project.dueDate) < new Date() && project.status !== "done";

    return (
        <Card className={cls("cursor-pointer overflow-hidden group relative", "transition-all duration-200", "hover:shadow-lg hover:-translate-y-0.5")}>
            <div className={cls("relative overflow-hidden bg-surface-100 dark:bg-surface-900", compact ? "h-20" : "aspect-[5/2]")}>
                <div className="absolute inset-0 opacity-20 transition-all duration-300" style={{ background: `linear-gradient(90deg, var(--color-primary) ${project.progress}%, transparent ${project.progress}%)` }} />
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
                    <FolderKanbanIcon size={compact ? 20 : 28} className="text-surface-400 dark:text-surface-500" />
                    {!compact && <Typography variant="caption" color="secondary" className="font-mono text-[10px]">{project.progress}% complete</Typography>}
                </div>
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-200" />
                <div className="absolute top-2 right-2"><Chip colorScheme={priorityCfg.color} size="smallest" outlined>{priorityCfg.label}</Chip></div>
            </div>
            <div className={compact ? "p-2" : "p-3"}>
                <Typography variant="caption" color="disabled" className="font-mono truncate block text-[10px]">{project.id}</Typography>
                <div className="truncate my-1"><Typography variant={compact ? "caption" : "body2"} className="font-medium">{project.name}</Typography></div>
                {!compact && <Typography variant="caption" color="secondary" className="line-clamp-2 mb-2">{project.description}</Typography>}
                <div className="flex items-center gap-1.5 flex-wrap">
                    <Chip colorScheme={statusCfg.color} size="smallest">{statusCfg.label}</Chip>
                    {!compact && project.tags.slice(0, 2).map(tag => <Chip key={tag} size="smallest" colorScheme="cyan" className="!text-[10px]">{tag}</Chip>)}
                    {!compact && project.tags.length > 2 && <span className="text-[10px] text-surface-400">+{project.tags.length - 2}</span>}
                </div>
                {!compact && (
                    <div className={cls("flex items-center justify-between mt-2 pt-2 border-t", defaultBorderMixin)}>
                        <div className="flex items-center gap-1.5">
                            <div className="w-5 h-5 rounded-full bg-surface-200 dark:bg-surface-700 text-surface-500 flex items-center justify-center text-[9px] font-semibold">{project.assignee[0]}</div>
                            <Typography variant="caption" color="secondary" className="truncate max-w-[100px]">{project.assignee}</Typography>
                        </div>
                        <Typography variant="caption" className={cls("font-mono text-[10px]", isOverdue ? "text-red-500 font-semibold" : "text-surface-400")}>{project.dueDate}</Typography>
                    </div>
                )}
            </div>
        </Card>
    );
}
