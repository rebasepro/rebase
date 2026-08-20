import React, { useState, useMemo } from "react";
import {
    Typography, Chip, cls, defaultBorderMixin,
    Table, TableHeader, TableBody, TableRow, TableCell,
    SearchBar, IconButton, Tooltip, Checkbox, iconSize,
    Select, SelectItem,
    Trash2Icon, PencilIcon, ArrowUpDownIcon, ArrowUpIcon, ArrowDownIcon
} from "@rebasepro/ui";
import { SAMPLE_PROJECTS, STATUS_CONFIG, PRIORITY_CONFIG } from "./sample_data";
import type { ProjectStatus } from "./sample_data";

type SortField = "name" | "status" | "priority" | "dueDate";
type SortDirection = "asc" | "desc";

export function CollectionTableDemo() {
    const [searchTerm, setSearchTerm] = useState("");
    const [sortField, setSortField] = useState<SortField>("name");
    const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [statusFilter, setStatusFilter] = useState<string>("all");

    const filteredAndSorted = useMemo(() => {
        let results = SAMPLE_PROJECTS.filter(p => {
            const matchesSearch = !searchTerm ||
                p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                p.assignee.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesStatus = statusFilter === "all" || p.status === statusFilter;
            return matchesSearch && matchesStatus;
        });
        results = [...results].sort((a, b) => {
            const cmp = String(a[sortField]).localeCompare(String(b[sortField]));
            return sortDirection === "asc" ? cmp : -cmp;
        });
        return results;
    }, [searchTerm, sortField, sortDirection, statusFilter]);

    const toggleSort = (field: SortField) => {
        if (sortField === field) setSortDirection(d => d === "asc" ? "desc" : "asc");
        else { setSortField(field); setSortDirection("asc"); }
    };

    const toggleSelect = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = (checked: boolean) => {
        setSelectedIds(checked ? new Set(filteredAndSorted.map(p => p.id)) : new Set());
    };

    const allSelected = filteredAndSorted.length > 0 && filteredAndSorted.every(p => selectedIds.has(p.id));

    const SortIcon = ({ field }: { field: SortField }) => {
        if (sortField !== field) return <ArrowUpDownIcon size={12} className="text-surface-400" />;
        return sortDirection === "asc"
            ? <ArrowUpIcon size={12} className="text-primary" />
            : <ArrowDownIcon size={12} className="text-primary" />;
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
                <SearchBar onTextSearch={(term) => setSearchTerm(term ?? "")} placeholder="Search projects…" size="small" />
                <Select value={statusFilter} onValueChange={setStatusFilter} size="small" placeholder="Status">
                    <SelectItem value="all">All Statuses</SelectItem>
                    {(Object.entries(STATUS_CONFIG) as [ProjectStatus, { label: string }][]).map(([key, { label }]) => (
                        <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                </Select>
                {selectedIds.size > 0 && <Typography variant="caption" color="secondary">{selectedIds.size} selected</Typography>}
            </div>
            <div className={cls("rounded-lg border overflow-hidden", defaultBorderMixin)}>
                <Table className="w-full">
                    <TableHeader>
                        <TableCell header style={{ width: "40px" }}><Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} size="small" /></TableCell>
                        <TableCell header><button onClick={() => toggleSort("name")} className="flex items-center gap-1 cursor-pointer"><Typography variant="caption" className="font-semibold">Name</Typography><SortIcon field="name" /></button></TableCell>
                        <TableCell header><button onClick={() => toggleSort("status")} className="flex items-center gap-1 cursor-pointer"><Typography variant="caption" className="font-semibold">Status</Typography><SortIcon field="status" /></button></TableCell>
                        <TableCell header><button onClick={() => toggleSort("priority")} className="flex items-center gap-1 cursor-pointer"><Typography variant="caption" className="font-semibold">Priority</Typography><SortIcon field="priority" /></button></TableCell>
                        <TableCell header><Typography variant="caption" className="font-semibold">Assignee</Typography></TableCell>
                        <TableCell header><Typography variant="caption" className="font-semibold">Tags</Typography></TableCell>
                        <TableCell header><button onClick={() => toggleSort("dueDate")} className="flex items-center gap-1 cursor-pointer"><Typography variant="caption" className="font-semibold">Due Date</Typography><SortIcon field="dueDate" /></button></TableCell>
                        <TableCell header style={{ width: "80px" }}><Typography variant="caption" className="font-semibold">Actions</Typography></TableCell>
                    </TableHeader>
                    <TableBody>
                        {filteredAndSorted.map(project => (
                            <TableRow key={project.id} className={cls(selectedIds.has(project.id) && "bg-primary/[0.03] dark:bg-primary/[0.06]")}>
                                <TableCell style={{ width: "40px" }}><Checkbox checked={selectedIds.has(project.id)} onCheckedChange={() => toggleSelect(project.id)} size="small" /></TableCell>
                                <TableCell><div><Typography variant="body2" className="font-medium">{project.name}</Typography><Typography variant="caption" color="secondary" className="line-clamp-1">{project.description}</Typography></div></TableCell>
                                <TableCell><Chip colorScheme={STATUS_CONFIG[project.status].color} size="small">{STATUS_CONFIG[project.status].label}</Chip></TableCell>
                                <TableCell><Chip colorScheme={PRIORITY_CONFIG[project.priority].color} size="smallest" outlined>{PRIORITY_CONFIG[project.priority].label}</Chip></TableCell>
                                <TableCell><div className="flex items-center gap-2"><div className="w-6 h-6 rounded-full bg-surface-200 dark:bg-surface-700 text-surface-500 flex items-center justify-center text-[10px] font-semibold shrink-0">{project.assignee[0]}</div><Typography variant="body2" className="truncate">{project.assignee}</Typography></div></TableCell>
                                <TableCell><div className="flex flex-wrap gap-1">{project.tags.map(tag => (<Chip key={tag} size="smallest" colorScheme="cyan">{tag}</Chip>))}</div></TableCell>
                                <TableCell><Typography variant="body2" className="font-mono text-xs">{project.dueDate}</Typography></TableCell>
                                <TableCell style={{ width: "80px" }}><div className="flex gap-1"><Tooltip title="Edit" asChild><IconButton size="smallest"><PencilIcon size={iconSize.smallest} /></IconButton></Tooltip><Tooltip title="Delete" asChild><IconButton size="smallest"><Trash2Icon size={iconSize.smallest} /></IconButton></Tooltip></div></TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
                {filteredAndSorted.length === 0 && <div className="flex items-center justify-center py-8"><Typography variant="label" color="secondary">No projects match your filters</Typography></div>}
            </div>
            <Typography variant="caption" color="secondary">{filteredAndSorted.length} of {SAMPLE_PROJECTS.length} projects</Typography>
        </div>
    );
}
