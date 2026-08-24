
/**
 * UIReferenceView — hidden debug route at /debug/ui
 *
 * This file is a STATIC reference of the real UI patterns used across the app.
 * Markup / styles are copied from source files where a section mirrors a real
 * screen. DO NOT add invented styles — copy from actual source files, or from
 * the components in @rebasepro/ui.
 *
 * Sections named after a component mirror that component. Sections named after
 * a pattern (e.g. "Management Screen", "Form Dialog") are illustrative
 * compositions of kit components and are not tied to a specific screen.
 *
 * Do not cite source line numbers here — they rot silently. Name the file only.
 *
 * Sources:
 *   DefaultDrawer.tsx, DefaultAppBar.tsx, DrawerNavigationItem.tsx,
 *   DrawerNavigationGroup.tsx
 */
import React, { useState } from "react";
import {
    Alert,
    AlertCircleIcon,
    Avatar,
    AppWindow,
    BooleanSwitch,
    Button,
    Checkbox,
    ChevronDownIcon,
    ChevronsLeftIcon,
    ChevronsRightIcon,
    Chip,
    CircleUserIcon,
    CircularProgress,
    cls,
    ColumnsIcon,
    defaultBorderMixin,
    FileIcon,
    FileTextIcon,
    FilterChip,
    FilterIcon,
    FolderIcon,
    IconButton,
    iconSize,
    KanbanIcon,
    LayoutGridIcon,
    ListIcon,
    LoadingButton,
    LogOutIcon,
    Menu,
    MenuItem,
    MoonIcon,
    MultiSelect,
    MultiSelectItem,
    PanelLeftIcon,
    PencilIcon,
    PlusIcon,
    SearchBar,
    Select,
    SelectItem,
    Separator,
    SettingsIcon,
    Skeleton,
    SunIcon,
    SunMoonIcon,
    Tab,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableRow,
    Tabs,
    TagIcon,
    TextField,
    Tooltip,
    Trash2Icon,
    TypeIcon,
    Typography,
    UserIcon
} from "@rebasepro/ui";
import { RebaseLogo } from "../RebaseLogo";
import { CrmDashboardDemo } from "./crm-dashboard/CrmDashboardDemo";
import { CollectionTableDemo, CardViewDemo, KanbanBoardDemo } from "./collection-views";

const SECTIONS = [
    { id: "drawer", label: "Drawer", icon: PanelLeftIcon },
    { id: "appbar", label: "App Bar", icon: AppWindow },
    { id: "tabs", label: "Tabs", icon: ListIcon },
    { id: "editor-sidebar", label: "Editor Sidebar", icon: ColumnsIcon },
    { id: "empty-states", label: "Empty States", icon: FileIcon },
    { id: "typography", label: "Typography", icon: TypeIcon },
    { id: "buttons", label: "Buttons", icon: PlusIcon },
    { id: "inputs", label: "Form Inputs", icon: FileTextIcon },
    { id: "chips-alerts", label: "Chips & Alerts", icon: AlertCircleIcon },
    { id: "users", label: "Management", icon: UserIcon },
    { id: "user-dialog", label: "Form Dialog", icon: CircleUserIcon },
    { id: "crm-dashboard", label: "CRM Dashboard", icon: LayoutGridIcon },
    { id: "collection-table", label: "Collection Table", icon: ListIcon },
    { id: "card-view", label: "Card View", icon: LayoutGridIcon },
    { id: "kanban-board", label: "Kanban Board", icon: KanbanIcon }
];

export function UIReferenceView() {
    const [activeSection, setActiveSection] = useState("drawer");
    const scrollContainerRef = React.useRef<HTMLDivElement>(null);

    const scrollTo = (id: string) => {
        const el = document.getElementById(id);
        const container = scrollContainerRef.current;
        if (el && container) {
            const offsetTop = el.offsetTop - container.offsetTop;
            container.scrollTo({ top: offsetTop, behavior: "smooth" });
        }
        setActiveSection(id);
    };

    return (
        <div className="flex w-full">

            {/* ── Sidebar nav (same structure as DefaultDrawer) ─────────────── */}
            {/* 232px, not 200px. The icon rail is 56px and the label is uppercase
                at 12px, which left ~128px — one character short of "COLLECTION
                TABLE", so the longest entry in the list rendered as
                "COLLECTION TA…". This is the reference's own nav, not the shared
                DefaultDrawer, so widening it costs no copy-fidelity. */}
            <div className={cls("flex flex-col sticky top-0 h-screen grow-0 shrink-0 w-[232px] border-r", defaultBorderMixin)}>
                {/* DrawerLogo */}
                <div className="flex flex-row items-center shrink-0 pt-4 pb-2 px-2">
                    <div className="shrink-0 flex items-center justify-center w-[56px] h-[40px]">
                        <RebaseLogo width="28px" height="28px"/>
                    </div>
                    <Typography variant="subtitle1" noWrap className="truncate">UI Ref</Typography>
                </div>

                {/* Nav entries */}
                <div className="mt-3 flex-grow overflow-scroll no-scrollbar">
                    <div className="my-2 mx-2 flex flex-col">
                        {/* Group header — from DrawerNavigationGroup */}
                        <div className={cls("pl-4 pr-2 py-1 flex flex-row items-center transition-colors cursor-pointer hover:bg-surface-100 dark:hover:bg-surface-700/50 rounded-t-lg bg-surface-50 dark:bg-surface-950/30")}>
                            <ChevronDownIcon size={iconSize.smallest} className="text-surface-500 dark:text-surface-400 transition-transform duration-200 mr-1"/>
                            <Typography variant="caption" color="secondary" className="font-medium flex-grow line-clamp-1">
                                SECTIONS
                            </Typography>
                        </div>
                        {/* Nav items — from DrawerNavigationItem */}
                        <div className="overflow-hidden bg-surface-50 dark:bg-surface-950/30 rounded-b-lg">
                            {SECTIONS.map(s => {
                                const IconComponent = s.icon;
                                return (
                                    <div key={s.id}>
                                        <div
                                            onClick={() => scrollTo(s.id)}
                                            className={cls(
                                                "rounded-lg truncate group/nav",
                                                "hover:bg-primary/5 dark:hover:bg-primary/5 text-text-primary dark:text-surface-200 hover:text-surface-900 dark:hover:text-white",
                                                "flex flex-row items-center",
                                                "pr-4 h-10",
                                                "font-medium text-xs cursor-pointer",
                                                activeSection === s.id ? "bg-primary/8 dark:bg-primary/10 text-primary dark:text-primary" : ""
                                            )}
                                        >
                                            <div className={cls("shrink-0 flex items-center justify-center w-[56px] h-[40px] text-surface-500 dark:text-text-secondary-dark transition-colors duration-150 group-hover/nav:text-primary", activeSection === s.id && "text-primary dark:text-primary")}>
                                                <IconComponent size={iconSize.small}/>
                                            </div>
                                            <div className="text-text-primary dark:text-surface-200 opacity-100 font-inherit truncate space-x-2">
                                                {s.label.toUpperCase()}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* DrawerToggle — from DefaultDrawer */}
                <div className={cls("shrink-0 mt-auto border-t px-2 py-2", defaultBorderMixin)}>
                    <div className={cls(
                        "flex flex-row items-center rounded-lg cursor-pointer",
                        "hover:bg-surface-accent-100 dark:hover:bg-surface-800",
                        "transition-colors duration-150",
                        "py-2"
                    )}>
                        <div className="shrink-0 flex items-center justify-center w-[56px] h-[24px] text-surface-500 dark:text-surface-400">
                            <ChevronsLeftIcon size={iconSize.small}/>
                        </div>
                        <Typography variant="body2" className="text-surface-500 dark:text-surface-400 select-none whitespace-nowrap">
                            Collapse
                        </Typography>
                    </div>
                </div>
            </div>

            {/* ── Main content area ───────────────────────────────────────────── */}
            {/* `min-w-0` is required, not cosmetic. A flex item defaults to
                `min-width: auto`, so this column sized itself to its widest
                descendant — the 1451px CRM dashboard — and pushed the whole page
                past the viewport, cutting the collection table's last columns
                off screen. With `min-w-0` the column can shrink to the space
                available and the `overflow-x-auto` on the wide mocks actually
                engages instead of being overruled from above. */}
            <div ref={scrollContainerRef} className="flex-1 min-w-0">

                {/* ═══════════════════════════════════════════════
                    SECTION: Drawer
                ═══════════════════════════════════════════════ */}
                <SectionBlock id="drawer" title="Drawer — DefaultDrawer.tsx">
                    <Typography variant="body2" color="secondary" className="mb-4">
                        The drawer wraps <code className="font-mono text-xs">DrawerLogo</code>, scrollable <code className="font-mono text-xs">DrawerNavigationGroup</code>s,
                        and <code className="font-mono text-xs">DrawerToggle</code>. Two visual states: collapsed (icon only, 72px) and expanded (280px).
                    </Typography>
                    <div className="flex gap-6 flex-wrap">

                        {/* Collapsed — exact markup from DefaultDrawer + DrawerNavigationItem */}
                        <div>
                            <Typography variant="caption" color="secondary" className="block mb-1">Collapsed (72px)</Typography>
                            <div className={cls("flex flex-col h-72 relative w-[72px] border rounded-lg overflow-hidden bg-white dark:bg-surface-900", defaultBorderMixin)}>
                                <div className="flex flex-row items-center shrink-0 pt-4 pb-2 px-2">
                                    <div className="shrink-0 flex items-center justify-center w-[56px] h-[40px]">
                                        <RebaseLogo width="28px" height="28px"/>
                                    </div>
                                </div>
                                <div className="mt-3 flex-grow overflow-hidden">
                                    <div className="my-2 mx-2 flex flex-col">
                                        <div className="overflow-hidden rounded-lg bg-surface-50 dark:bg-surface-950/30">
                                            {[<FolderIcon key="folder" size={iconSize.small}/>, <UserIcon key="user" size={iconSize.small}/>, <TagIcon key="tag" size={iconSize.small}/>].map((icon, i) => (
                                                <div key={i} className="rounded-lg truncate hover:bg-primary/5 dark:hover:bg-primary/5 flex flex-row items-center h-10">
                                                    <div className="shrink-0 flex items-center justify-center w-[56px] h-[40px] text-text-secondary dark:text-text-secondary-dark">
                                                        {icon}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                                <div className={cls("shrink-0 mt-auto border-t px-2 py-2", defaultBorderMixin)}>
                                    <div className="flex flex-row items-center rounded-lg cursor-pointer hover:bg-surface-accent-100 dark:hover:bg-surface-800 transition-colors duration-150 py-2">
                                        <div className="shrink-0 flex items-center justify-center w-[56px] h-[24px] text-surface-500 dark:text-surface-400">
                                            <ChevronsRightIcon size={iconSize.small}/>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Expanded — exact markup from DefaultDrawer + DrawerNavigationGroup + DrawerNavigationItem */}
                        <div>
                            <Typography variant="caption" color="secondary" className="block mb-1">Expanded (280px)</Typography>
                            <div className={cls("flex flex-col h-72 relative w-[280px] border rounded-lg overflow-hidden bg-white dark:bg-surface-900", defaultBorderMixin)}>
                                {/* DrawerLogo */}
                                <div className="flex flex-row items-center shrink-0 pt-4 pb-2 px-2">
                                    <div className="shrink-0 flex items-center justify-center w-[56px] h-[40px]">
                                        <RebaseLogo width="28px" height="28px"/>
                                    </div>
                                    <div className="flex flex-row items-center overflow-hidden transition-all duration-200 ease-in-out opacity-100 w-full ml-1">
                                        <Typography variant="subtitle1" noWrap className="truncate">Rebase</Typography>
                                    </div>
                                </div>
                                {/* DrawerNavigationGroup */}
                                <div className="mt-3 flex-grow overflow-hidden">
                                    <div className="my-2 mx-2 flex flex-col">
                                        <div className="pl-4 pr-2 py-1 flex flex-row items-center transition-colors cursor-pointer hover:bg-surface-100 dark:hover:bg-surface-700/50 rounded-t-lg bg-surface-50 dark:bg-surface-950/30">
                                            <ChevronDownIcon size={iconSize.smallest} className="text-surface-500 dark:text-surface-400 mr-1"/>
                                            <Typography variant="caption" color="secondary" className="font-medium flex-grow line-clamp-1">CONTENT</Typography>
                                        </div>
                                        <div className="overflow-hidden bg-surface-50 dark:bg-surface-950/30 rounded-b-lg">
                                            {[
                                                { label: "Posts",
icon: <FolderIcon size={iconSize.small}/>,
active: true },
                                                { label: "Authors",
icon: <UserIcon size={iconSize.small}/>,
active: false },
                                                { label: "Tags",
icon: <TagIcon size={iconSize.small}/>,
active: false }
                                            ].map(({ label, icon, active }) => (
                                                <div key={label} className={cls(
                                                    "rounded-lg truncate hover:bg-primary/5 dark:hover:bg-primary/5 text-text-primary dark:text-surface-200 hover:text-surface-900 dark:hover:text-white flex flex-row items-center pr-4 h-10 font-medium text-xs cursor-pointer",
                                                    active ? "bg-primary/8 dark:bg-primary/10 text-primary dark:text-primary" : ""
                                                )}>
                                                    <div className={cls("shrink-0 flex items-center justify-center w-[56px] h-[40px] transition-colors duration-150", active ? "text-primary dark:text-primary" : "text-surface-500 dark:text-text-secondary-dark")}>
                                                        {icon}
                                                    </div>
                                                    <div className="text-text-primary dark:text-surface-200 font-inherit truncate">
                                                        {label.toUpperCase()}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                                {/* DrawerToggle */}
                                <div className={cls("shrink-0 mt-auto border-t px-2 py-2", defaultBorderMixin)}>
                                    <div className="flex flex-row items-center rounded-lg cursor-pointer hover:bg-surface-accent-100 dark:hover:bg-surface-800 transition-colors duration-150 py-2">
                                        <div className="shrink-0 flex items-center justify-center w-[56px] h-[24px] text-surface-500 dark:text-surface-400">
                                            <ChevronsLeftIcon size={iconSize.small}/>
                                        </div>
                                        <div className="overflow-hidden transition-all duration-200 ease-in-out opacity-100 w-auto">
                                            <Typography variant="body2" className="text-surface-500 dark:text-surface-400 select-none whitespace-nowrap">
                                                Collapse
                                            </Typography>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </SectionBlock>

                {/* ═══════════════════════════════════════════════
                    SECTION: AppBar
                ═══════════════════════════════════════════════ */}
                <SectionBlock id="appbar" title="App Bar — DefaultAppBar.tsx">
                    <Typography variant="body2" color="secondary" className="mb-4">
                        Fixed at top (<code className="font-mono text-xs">h-16 absolute top-0</code>). Contains breadcrumbs (caption + body2), Content/Studio pill toggle,
                        theme menu, and user avatar menu via <code className="font-mono text-xs">Menu</code>.
                    </Typography>
                    {/* Exact classes from DefaultAppBar */}
                    <div className={cls("w-full h-16 flex flex-row gap-2 px-4 items-center border rounded-lg relative", defaultBorderMixin)}>
                        {/* Breadcrumbs — from DefaultAppBar */}
                        <div className="mr-8 hidden lg:block">
                            <div className="flex flex-row gap-2 items-center">
                                <Typography variant="caption" color="secondary">/</Typography>
                                <div className="flex flex-row items-center gap-2 whitespace-nowrap">
                                    <Typography variant="body2">Posts</Typography>
                                    <span className="text-xs text-surface-accent-500 dark:text-surface-accent-400 bg-surface-100 dark:bg-surface-700 px-1 py-0 rounded">42</span>
                                </div>
                                <Typography variant="caption" color="secondary">/</Typography>
                                <div className="flex flex-row items-center gap-2 whitespace-nowrap">
                                    <Typography variant="body2">My Post</Typography>
                                </div>
                            </div>
                        </div>
                        <div className="grow"/>
                        {/* Content/Studio toggle — from DefaultAppBar */}
                        <div className={cls("mr-2 hidden sm:flex bg-surface-100 dark:bg-surface-950 rounded-lg p-0.5 border", defaultBorderMixin)}>
                            <button className={cls("px-3 py-1 text-xs font-semibold rounded-md transition-all", "bg-white dark:bg-surface-900 shadow-sm text-primary dark:text-primary-400")}>
                                Content
                            </button>
                            <button className={cls("px-3 py-1 text-xs font-semibold rounded-md transition-all", "text-surface-500 hover:text-surface-900 dark:hover:text-white")}>
                                Studio
                            </button>
                        </div>
                        {/* Theme menu — from DefaultAppBar */}
                        <Menu trigger={
                            <IconButton color="inherit">
                                <MoonIcon/>
                            </IconButton>
                        }>
                            <MenuItem><MoonIcon size={iconSize.smallest}/> Dark</MenuItem>
                            <MenuItem><SunIcon size={iconSize.smallest}/> Light</MenuItem>
                            <MenuItem><SunMoonIcon size={iconSize.smallest}/> System</MenuItem>
                        </Menu>
                        {/* Avatar menu — from DefaultAppBar */}
                        <Menu trigger={<Avatar>A</Avatar>}>
                            <div className="px-4 py-2 mb-2">
                                <Typography variant="body1" color="secondary">Alice Johnson</Typography>
                                <Typography variant="body2" color="secondary">alice@example.com</Typography>
                            </div>
                            <MenuItem><SettingsIcon/> Account Settings</MenuItem>
                            <MenuItem><LogOutIcon/> Log Out</MenuItem>
                        </Menu>
                    </div>
                </SectionBlock>

                {/* ═══════════════════════════════════════════════
                    SECTION: Tabs
                ═══════════════════════════════════════════════ */}
                <SectionBlock id="tabs" title="Tabs — Tabs.tsx">
                    <Typography variant="body2" color="secondary" className="mb-4">
                        All editor components use <code className="font-mono text-xs">variant=&quot;boxy&quot;</code> tabs for sidebar navigation.
                        The boxy variant provides a segmented, flat tab bar that integrates tightly with editor chrome.
                    </Typography>

                    <div className="flex flex-col gap-6">
                        {/* Default variant */}
                        <div>
                            <Typography variant="caption" color="secondary" className="block mb-2 font-mono">variant=&quot;default&quot;</Typography>
                            <Tabs value="tab1" onValueChange={() => {}}>
                                <Tab value="tab1">Schema</Tab>
                                <Tab value="tab2">Snippets</Tab>
                                <Tab value="tab3">History</Tab>
                            </Tabs>
                        </div>

                        {/* Boxy variant — exact pattern from SQLEditorSidebar, JSEditorSidebar, RLSEditor */}
                        <div>
                            <Typography variant="caption" color="secondary" className="block mb-2 font-mono">variant=&quot;boxy&quot; (Editor Standard)</Typography>
                            <div className={cls("border rounded-lg overflow-hidden w-[320px]", defaultBorderMixin)}>
                                <Tabs value="schema" onValueChange={() => {}} variant="boxy" className="border-b border-surface-200 dark:border-surface-950">
                                    <Tab value="schema">Schema</Tab>
                                    <Tab value="snippets">Snippets</Tab>
                                    <Tab value="history">History</Tab>
                                </Tabs>
                                {/* Section header pattern — used in all editor sidebars */}
                                <div className={cls("p-3 border-b flex justify-between items-center bg-surface-50 dark:bg-surface-900", defaultBorderMixin)}>
                                    <Typography variant="caption" className="font-semibold uppercase tracking-wider text-text-disabled dark:text-text-disabled-dark">TABLES</Typography>
                                    <IconButton size="small">
                                        <SettingsIcon size={iconSize.smallest}/>
                                    </IconButton>
                                </div>
                                <div className="p-2 h-24">
                                    <Typography variant="caption" className="text-text-disabled dark:text-text-disabled-dark italic p-2">Tab content area…</Typography>
                                </div>
                            </div>
                        </div>

                        {/* Toolbar tabs — from SQLEditor/JSEditor main toolbar */}
                        <div>
                            <Typography variant="caption" color="secondary" className="block mb-2 font-mono">Toolbar Tabs (boxy, inline with controls)</Typography>
                            <div className={cls("border rounded-lg overflow-hidden flex items-center justify-between pr-2 bg-white dark:bg-surface-950", defaultBorderMixin)}>
                                <div className="flex items-center">
                                    <Tabs value="query1" onValueChange={() => {}} variant="boxy" className="w-[unset] flex-shrink-0">
                                        <Tab value="query1" className="flex items-center gap-1.5">
                                            <svg className="w-3.5 h-3.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"/></svg>
                                            Query 1
                                        </Tab>
                                        <Tab value="query2" className="flex items-center gap-1.5">
                                            <svg className="w-3.5 h-3.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"/></svg>
                                            Query 2
                                        </Tab>
                                    </Tabs>
                                    <IconButton size="small" className="ml-2 flex-shrink-0">
                                        <PlusIcon/>
                                    </IconButton>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <Button variant="text" size="small">Explain</Button>
                                    <div className="h-4 w-px bg-surface-200 dark:bg-surface-950"/>
                                    <Button size="small" color="primary">Run</Button>
                                </div>
                            </div>
                        </div>
                    </div>
                </SectionBlock>

                {/* ═══════════════════════════════════════════════
                    SECTION: Editor Sidebar
                ═══════════════════════════════════════════════ */}
                <SectionBlock id="editor-sidebar" title="Editor Sidebar — Harmonized Pattern">
                    <Typography variant="body2" color="secondary" className="mb-4">
                        All studio editor components (SQL, JS, RLS, Collection) share the same underlying sidebar foundation:
                        <code className="font-mono text-xs">Tabs variant=&quot;boxy&quot;</code> at top (optional) → section header with uppercase label → scrollable list.
                        While SQL/JS/RLS use dense tree entries, the Collection Schema Editor uses larger items (<code className="font-mono text-xs">px-3 py-2</code>, <code className="font-mono text-xs">text-sm</code>) suitable for primary navigation.
                    </Typography>

                    <div className="flex gap-6 flex-wrap">
                        {/* SQL Editor Sidebar replica */}
                        <div>
                            <Typography variant="caption" color="secondary" className="block mb-1">SQL Editor Sidebar</Typography>
                            <div className={cls("flex flex-col h-72 w-[240px] border rounded-lg overflow-hidden", defaultBorderMixin)}>
                                <Tabs value="schema" onValueChange={() => {}} variant="boxy" className="border-b border-surface-200 dark:border-surface-950">
                                    <Tab value="schema">Schema</Tab>
                                    <Tab value="snippets">Snippets</Tab>
                                    <Tab value="history">History</Tab>
                                </Tabs>
                                <div className={cls("p-3 border-b flex justify-between items-center bg-surface-50 dark:bg-surface-900", defaultBorderMixin)}>
                                    <Typography variant="caption" className="font-semibold uppercase tracking-wider text-text-secondary dark:text-text-secondary-dark">TABLES</Typography>
                                    <IconButton size="small">
                                        <SettingsIcon size={iconSize.smallest}/>
                                    </IconButton>
                                </div>
                                <div className="flex-grow overflow-y-auto no-scrollbar p-1">
                                    {/* Schema tree items — from SchemaBrowser */}
                                    <div className="mb-2">
                                        <div className="flex items-center p-1 cursor-pointer hover:bg-surface-100 dark:hover:bg-surface-900 rounded transition-colors">
                                            <svg className="w-3 h-3 mr-1 rotate-90" fill="currentColor" viewBox="0 0 20 20"><path d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"/></svg>
                                            <Typography variant="body2" className="text-text-primary dark:text-text-primary-dark font-medium text-xs">public</Typography>
                                        </div>
                                        <div className="ml-3 mt-1 space-y-1">
                                            {["users", "posts", "comments"].map(t => (
                                                <div key={t} className="flex items-center p-1 cursor-pointer hover:bg-surface-100 dark:hover:bg-surface-900 rounded transition-colors group">
                                                    <svg className="w-3.5 h-3.5 mr-1 shrink-0 text-text-disabled dark:text-text-disabled-dark" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
                                                    <Typography variant="body2" className="text-text-secondary dark:text-text-secondary-dark text-xs truncate">{t}</Typography>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* RLS Editor Sidebar replica */}
                        <div>
                            <Typography variant="caption" color="secondary" className="block mb-1">RLS Editor Sidebar</Typography>
                            <div className={cls("flex flex-col h-72 w-[240px] border rounded-lg overflow-hidden", defaultBorderMixin)}>
                                <Tabs value="tables" onValueChange={() => {}} variant="boxy" className="border-b border-surface-200 dark:border-surface-950">
                                    <Tab value="tables">Tables</Tab>
                                    <Tab value="info">Info</Tab>
                                </Tabs>
                                <div className={cls("p-3 border-b flex justify-between items-center bg-surface-50 dark:bg-surface-900", defaultBorderMixin)}>
                                    <Typography variant="caption" className="font-semibold uppercase tracking-wider text-text-disabled dark:text-text-disabled-dark">RLS</Typography>
                                    <IconButton size="small">
                                        <SettingsIcon size={iconSize.smallest}/>
                                    </IconButton>
                                </div>
                                <div className="flex-grow overflow-y-auto no-scrollbar p-1">
                                    <div className="mb-2">
                                        <div className="flex items-center p-1 cursor-pointer hover:bg-surface-100 dark:hover:bg-surface-900 rounded transition-colors">
                                            <svg className="w-3 h-3 mr-1 rotate-90" fill="currentColor" viewBox="0 0 20 20"><path d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"/></svg>
                                            <Typography variant="body2" className="text-text-primary dark:text-text-primary-dark font-medium text-xs">public</Typography>
                                        </div>
                                        <div className="ml-3 mt-1 space-y-0.5">
                                            {[{ name: "users",
enabled: true }, { name: "posts",
enabled: true }, { name: "sessions",
enabled: false }].map(t => (
                                                <div key={t.name} className={cls("flex items-center p-1 cursor-pointer rounded transition-colors", t.name === "users" ? "bg-primary/10 text-primary dark:bg-primary/20" : "hover:bg-surface-100 dark:hover:bg-surface-900 text-text-secondary")}>
                                                    <svg className="w-3.5 h-3.5 mr-1 shrink-0 text-text-disabled" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
                                                    <Typography variant="body2" className="text-xs truncate flex-1">{t.name}</Typography>
                                                    <div className={cls("w-1.5 h-1.5 rounded-full shrink-0", t.enabled ? "bg-green-500" : "bg-orange-400 opacity-50")}/>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Collection Editor Sidebar replica */}
                        <div>
                            <Typography variant="caption" color="secondary" className="block mb-1">Collection Editor Sidebar</Typography>
                            <div className={cls("flex flex-col h-72 w-[240px] border rounded-lg overflow-hidden bg-white dark:bg-surface-950", defaultBorderMixin)}>
                                <div className={cls("p-3 border-b flex justify-between items-center bg-surface-50 dark:bg-surface-900", defaultBorderMixin)}>
                                    <Typography variant="caption" className="font-semibold uppercase tracking-wider text-text-disabled dark:text-text-disabled-dark">COLLECTIONS</Typography>
                                    <IconButton size="small">
                                        <PlusIcon size={iconSize.smallest}/>
                                    </IconButton>
                                </div>
                                <div className="flex-grow overflow-y-auto no-scrollbar p-2 space-y-0.5">
                                    {[{ name: "Authors" }, { name: "Posts",
selected: true }, { name: "Tags" }].map(c => (
                                        <div key={c.name} className={cls("flex items-center gap-3 px-3 py-2 cursor-pointer rounded-md text-sm transition-colors", c.selected ? "bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary-light" : "hover:bg-surface-100 dark:hover:bg-surface-900 text-text-secondary dark:text-text-secondary-dark")}>
                                            <FolderIcon size={iconSize.small} className={cls(c.selected ? "text-primary dark:text-primary-light" : "text-text-secondary dark:text-text-secondary-dark")}/>
                                            <span className="truncate flex-1">{c.name}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </SectionBlock>

                {/* ═══════════════════════════════════════════════
                    SECTION: Empty States
                ═══════════════════════════════════════════════ */}
                <SectionBlock id="empty-states" title="Empty States — Canonical Pattern">
                    <Typography variant="body2" color="secondary" className="mb-4">
                        All empty / placeholder states share the same layout: a centered <code className="font-mono text-xs">flex-col</code> container
                        with <code className="font-mono text-xs">Typography variant=&quot;label&quot;</code> for the message and a <code className="font-mono text-xs">Button</code> with <code className="font-mono text-xs">AddIcon</code> for the primary action.
                        Sources: <code className="font-mono text-xs">CollectionPropertiesEditorForm</code>, <code className="font-mono text-xs">CollectionsStudioView</code>, <code className="font-mono text-xs">CollectionStudioView</code>.
                    </Typography>

                    <div className="flex gap-6 flex-wrap">
                        {/* Property editor empty state */}
                        <div>
                            <Typography variant="caption" color="secondary" className="block mb-1">Property Editor (no selection)</Typography>
                            <div className={cls("flex flex-col items-center justify-center h-48 w-[320px] border rounded-lg", defaultBorderMixin)}>
                                <div className="flex flex-col items-center justify-center h-full gap-4">
                                    <Typography variant="label" className="text-center px-4">
                                        Select a property to edit it
                                    </Typography>
                                    <Button>
                                        <PlusIcon/>
                                        Add new property
                                    </Button>
                                </div>
                            </div>
                        </div>

                        {/* Property editor empty collection state */}
                        <div>
                            <Typography variant="caption" color="secondary" className="block mb-1">Property Editor (empty collection)</Typography>
                            <div className={cls("flex flex-col items-center justify-center h-48 w-[320px] border rounded-lg", defaultBorderMixin)}>
                                <div className="flex flex-col items-center justify-center h-full gap-4">
                                    <Typography variant="label" className="text-center px-4">
                                        Now you can add your first property
                                    </Typography>
                                    <Button>
                                        <PlusIcon/>
                                        Add new property
                                    </Button>
                                </div>
                            </div>
                        </div>

                        {/* Collection list empty state */}
                        <div>
                            <Typography variant="caption" color="secondary" className="block mb-1">Collection ListIcon (no selection)</Typography>
                            <div className={cls("flex flex-col items-center justify-center h-48 w-[320px] border rounded-lg", defaultBorderMixin)}>
                                <div className="flex flex-col items-center justify-center h-full gap-4">
                                    <Typography variant="label" className="text-center px-4">
                                        Select a collection or create a new one to start editing
                                    </Typography>
                                    <Button>
                                        <PlusIcon/>
                                        Add new collection
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                </SectionBlock>

                {/* ═══════════════════════════════════════════════
                    SECTION: Typography
                ═══════════════════════════════════════════════ */}
                <SectionBlock id="typography" title="Typography">
                    <Typography variant="body2" color="secondary" className="mb-4">
                        All variants from <code className="font-mono text-xs">Typography</code>. Colors: primary (default), secondary, disabled, error.
                    </Typography>
                    <div className="flex flex-col gap-3">
                        {(["h1", "h2", "h3", "h4", "h5", "h6", "lead", "subtitle1", "subtitle2", "body1", "body2", "caption", "label", "button"] as const).map(v => (
                            <div key={v} className={cls("flex items-baseline gap-4 border-b pb-3 last:border-0", defaultBorderMixin)}>
                                <span className="w-24 shrink-0 text-xs text-surface-400 font-mono">{v}</span>
                                {/* `component="p"` keeps the variant's styling but not its
                                    element. Rendering the specimen with its native tag put a
                                    real <h1> — "The quick brown fox jumps over the lazy dog" —
                                    plus h2-h6 into the document outline of every page that
                                    embeds this view, including the public rebase.pro/ui gallery,
                                    where it competed with the page's actual heading. The class
                                    carries the type, so this renders identically. */}
                                <Typography variant={v} component="p">The quick brown fox jumps over the lazy dog</Typography>
                            </div>
                        ))}
                    </div>
                    <div className="flex gap-4 flex-wrap mt-4">
                        {(["primary", "secondary", "disabled", "error"] as const).map(c => (
                            <Typography key={c} color={c}>color=&quot;{c}&quot;</Typography>
                        ))}
                    </div>

                    {/* The data tiers are shown with real content rather than the
                        pangram above: `micro` is always one or two words naming the
                        value beneath it, and `mono` is always a measurement. A
                        specimen reading "The quick brown fox" would demonstrate the
                        size and misrepresent the purpose. */}
                    <div className={cls("mt-8 pt-6 border-t", defaultBorderMixin)}>
                        <Typography variant="subtitle2" className="block mb-1">Data tiers</Typography>
                        <Typography variant="body2" color="secondary" className="block mb-5 max-w-[65ch]">
                            For values that are looked up rather than read: a field name, a measurement,
                            a headline figure. <code className="font-mono text-xs">mono</code> and{" "}
                            <code className="font-mono text-xs">stat</code> both carry{" "}
                            <code className="font-mono text-xs">tabular-nums</code>, so a column of them
                            keeps its decimal points aligned and a live counter does not jitter as its
                            digits change width.
                        </Typography>

                        <div className="flex flex-wrap items-start gap-x-12 gap-y-5">
                            {([
                                ["Region", "europe-west1"],
                                ["Took", "32.2s"],
                                ["Last run", "16/08/2026, 05:30:32"]
                            ] as const).map(([label, value]) => (
                                <div key={label}>
                                    <Typography variant="micro" component="div" color="secondary" className="block">
                                        {label}
                                    </Typography>
                                    <Typography variant="mono" component="div" className="block mt-1 text-sm">
                                        {value}
                                    </Typography>
                                </div>
                            ))}
                        </div>

                        <div className="mt-6">
                            <span className="text-xs text-surface-400 font-mono">stat</span>
                            <Typography variant="stat" component="div" className="block mt-1">1,284</Typography>
                        </div>
                    </div>
                </SectionBlock>

                {/* ═══════════════════════════════════════════════
                    SECTION: Buttons
                ═══════════════════════════════════════════════ */}
                <SectionBlock id="buttons" title="Buttons">
                    <div className="flex flex-col gap-6">
                        {(["filled", "text"] as const).map(variant => (
                            <div key={variant}>
                                <Typography variant="caption" color="secondary" className="block mb-2 font-mono">variant=&quot;{variant}&quot;</Typography>
                                <div className="flex flex-wrap gap-3 items-center">
                                    {(["primary", "secondary", "text", "error", "neutral"] as const).map(color => (
                                        <Button key={color} variant={variant} color={color}>{color.charAt(0).toUpperCase() + color.slice(1)}</Button>
                                    ))}
                                    <Button variant={variant} disabled>Disabled</Button>
                                </div>
                            </div>
                        ))}
                        <div>
                            <Typography variant="caption" color="secondary" className="block mb-2 font-mono">sizes</Typography>
                            <div className="flex flex-wrap items-end gap-3">
                                {(["small", "medium", "large", "xl", "2xl"] as const).map(s => (
                                    <Button key={s} size={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</Button>
                                ))}
                            </div>
                        </div>
                        <div>
                            <Typography variant="caption" color="secondary" className="block mb-2 font-mono">IconButton — sizes</Typography>
                            {/* `items-end`, matching the Button size ramp above.
                                Each entry is a column of button-over-label, and the
                                buttons step 28→32→40→48px. Centring the columns
                                against each other scattered the captions across a
                                10px band, so a row meant to read as an even ramp
                                read as ragged. Aligning the ends puts every caption
                                on one baseline and lets the size difference show in
                                the buttons, which is the point of the row. */}
                            <div className="flex flex-wrap gap-3 items-end">
                                {([
                                    { s: "smallest" as const, icon: <PencilIcon size={14}/> },
                                    { s: "small" as const, icon: <PencilIcon size={16}/> },
                                    { s: "medium" as const, icon: <PencilIcon size={20}/> },
                                    { s: "large" as const, icon: <PencilIcon size={24}/> }
                                ]).map(({ s, icon }) => (
                                    <div key={s} className="flex flex-col items-center gap-1">
                                        <IconButton size={s}>{icon}</IconButton>
                                        <Typography variant="caption" color="secondary">{s.charAt(0).toUpperCase() + s.slice(1)}</Typography>
                                    </div>
                                ))}
                                <div className="flex flex-col items-center gap-1">
                                    <IconButton disabled><Trash2Icon size={20}/></IconButton>
                                    <Typography variant="caption" color="secondary">Disabled</Typography>
                                </div>
                                <div className="flex flex-col items-center gap-1">
                                    <IconButton variant="filled"><PlusIcon size={20}/></IconButton>
                                    <Typography variant="caption" color="secondary">Filled</Typography>
                                </div>
                                <div className="flex flex-col items-center gap-1">
                                    <IconButton shape="square"><SettingsIcon size={20}/></IconButton>
                                    <Typography variant="caption" color="secondary">Square</Typography>
                                </div>
                            </div>
                        </div>
                        <div>
                            <Typography variant="caption" color="secondary" className="block mb-2 font-mono">LoadingButton</Typography>
                            <div className="flex flex-wrap gap-3">
                                <LoadingButton loading={true}>Saving…</LoadingButton>
                                <LoadingButton loading={false}>Idle</LoadingButton>
                            </div>
                        </div>
                    </div>
                </SectionBlock>

                {/* ═══════════════════════════════════════════════
                    SECTION: Form Inputs
                ═══════════════════════════════════════════════ */}
                <SectionBlock id="inputs" title="Form Inputs">
                    <div className="grid grid-cols-12 gap-4">
                        <div className="col-span-12 sm:col-span-6">
                            <Typography variant="caption" color="secondary" className="block mb-2 font-mono">TextField</Typography>
                            <div className="flex flex-col gap-3">
                                <TextField label="Default" placeholder="Type something…"/>
                                <TextField label="With value" value="Filled value" onChange={() => {}}/>
                                <TextField label="Error state" error value="Bad value" onChange={() => {}}/>
                                <TextField label="Disabled" disabled value="Read only" onChange={() => {}}/>
                                {/* The smaller sizes are the ones dialogs use, and they
                                    were absent here — which is how a labelled `small`
                                    field shipped with its label sitting on top of its
                                    placeholder. Keep all four so the collision is
                                    visible on this page rather than in a modal. */}
                                <TextField size="medium" label="Medium" placeholder="Placeholder under the label"/>
                                <TextField size="small" label="Small" placeholder="Placeholder under the label"/>
                                <TextField size="smallest" label="Smallest" value="Filled value" onChange={() => {}}/>
                            </div>
                        </div>
                        <div className="col-span-12 sm:col-span-6 flex flex-col gap-4">
                            <div>
                                <Typography variant="caption" color="secondary" className="block mb-2 font-mono">Select</Typography>
                                <Select label="Status" value="published" onValueChange={() => {}}>
                                    <SelectItem value="draft">Draft</SelectItem>
                                    <SelectItem value="published">Published</SelectItem>
                                    <SelectItem value="archived">Archived</SelectItem>
                                </Select>
                            </div>
                            <div>
                                <Typography variant="caption" color="secondary" className="block mb-2 font-mono">MultiSelect</Typography>
                                <MultiSelect label="Roles" value={["admin", "editor"]} onValueChange={() => {}}>
                                    <MultiSelectItem value="admin">Admin</MultiSelectItem>
                                    <MultiSelectItem value="editor">Editor</MultiSelectItem>
                                    <MultiSelectItem value="viewer">Viewer</MultiSelectItem>
                                </MultiSelect>
                            </div>
                        </div>
                        <div className="col-span-12 sm:col-span-6 flex flex-col gap-3">
                            <Typography variant="caption" color="secondary" className="block font-mono">Checkbox</Typography>
                            <label className="flex items-center gap-2 cursor-pointer"><Checkbox checked={true} onCheckedChange={() => {}}/><span>Checked</span></label>
                            <label className="flex items-center gap-2 cursor-pointer"><Checkbox checked={false} onCheckedChange={() => {}}/><span>Unchecked</span></label>
                            <label className="flex items-center gap-2"><Checkbox checked={true} disabled/><span>Disabled</span></label>
                        </div>
                        <div className="col-span-12 sm:col-span-6 flex flex-col gap-3">
                            <Typography variant="caption" color="secondary" className="block font-mono">BooleanSwitch</Typography>
                            <div className="flex items-center gap-2"><BooleanSwitch value={true} onValueChange={() => {}}/><span>On</span></div>
                            <div className="flex items-center gap-2"><BooleanSwitch value={false} onValueChange={() => {}}/><span>Off</span></div>
                        </div>
                        <div className="col-span-12">
                            <Typography variant="caption" color="secondary" className="block mb-2 font-mono">SearchBar</Typography>
                            <SearchBar placeholder="Search entities…"/>
                        </div>
                        <div className="col-span-12">
                            <Typography variant="caption" color="secondary" className="block mb-2 font-mono">Skeleton</Typography>
                            <div className="flex gap-4 items-center flex-wrap">
                                <Skeleton className="w-10 h-10 rounded-full"/>
                                <Skeleton className="w-48 h-4 rounded"/>
                                <Skeleton className="w-32 h-8 rounded-md"/>
                            </div>
                        </div>
                    </div>
                </SectionBlock>

                {/* ═══════════════════════════════════════════════
                    SECTION: Chips & Alerts
                ═══════════════════════════════════════════════ */}
                <SectionBlock id="chips-alerts" title="Chips & Alerts">
                    <Typography variant="caption" color="secondary" className="block mb-2 font-mono">Chip — colorScheme</Typography>
                    <div className="flex flex-wrap gap-2 mb-4">
                        {(["blue", "teal", "red", "green", "yellow", "orange", "purple", "pink", "cyan", "indigo", "violet", "fuchsia", "rose", "emerald", "gray"] as const).map(s => (
                            <Chip key={s} colorScheme={s}>{s}</Chip>
                        ))}
                    </div>
                    <Typography variant="caption" color="secondary" className="block mb-2 font-mono">Chip — sizes</Typography>
                    <div className="flex flex-wrap gap-2 items-center mb-4">
                        {(["smallest", "small", "medium", "large"] as const).map(sz => (
                            <Chip key={sz} colorScheme="blue" size={sz}>{sz}</Chip>
                        ))}
                    </div>
                    <Typography variant="caption" color="secondary" className="block mb-2 font-mono">Chip — outlined, error, clickable, icon</Typography>
                    <div className="flex flex-wrap gap-2 items-center mb-4">
                        <Chip colorScheme="red" outlined>Outlined Red</Chip>
                        <Chip colorScheme="blue" outlined>Outlined Blue</Chip>
                        <Chip error>Error</Chip>
                        <Chip error outlined>Error Outlined</Chip>
                        <Chip onClick={() => {}}>Clickable</Chip>
                        <Chip icon={<TagIcon size={12}/>} colorScheme="teal">With Icon</Chip>
                        <Chip>Default (no scheme)</Chip>
                        <Chip outlined>Default Outlined</Chip>
                    </div>
                    <Typography variant="caption" color="secondary" className="block mb-2 font-mono">FilterChip</Typography>
                    <div className="flex flex-wrap gap-2 items-center mb-6">
                        <FilterChip active>Active</FilterChip>
                        <FilterChip>Inactive</FilterChip>
                        <FilterChip icon={<FilterIcon size={12}/>} active>With Icon</FilterChip>
                        <FilterChip size="small">Small</FilterChip>
                        <FilterChip disabled>Disabled</FilterChip>
                    </div>
                    <Typography variant="caption" color="secondary" className="block mb-2 font-mono">Alert — color variants</Typography>
                    <div className="flex flex-col gap-2">
                        <Alert color="info">Info — informational message</Alert>
                        <Alert color="success">Success — operation completed</Alert>
                        <Alert color="warning">Warning — attention required</Alert>
                        <Alert color="error">Error — something went wrong</Alert>
                    </div>
                    <div className="mt-4">
                        <Typography variant="caption" color="secondary" className="block mb-2 font-mono">Separator</Typography>
                        <div>Above</div>
                        <Separator orientation="horizontal"/>
                        <div>Below</div>
                    </div>
                    <div className="mt-4">
                        <Typography variant="caption" color="secondary" className="block mb-2 font-mono">CircularProgress</Typography>
                        <div className="flex gap-6 items-center">
                            {(["small", "medium", "large"] as const).map(s => (
                                <div key={s} className="flex flex-col items-center gap-1">
                                    <CircularProgress size={s}/>
                                    <Typography variant="caption" color="secondary">{s}</Typography>
                                </div>
                            ))}
                        </div>
                    </div>
                </SectionBlock>

                {/* ═══════════════════════════════════════════════
                    SECTION: Management Screen
                ═══════════════════════════════════════════════ */}
                <SectionBlock id="users" title="Management Screen — Alert + Table + Chip">
                    <Typography variant="body2" color="secondary" className="mb-4">
                        Canonical layout for an admin management screen: an <code className="font-mono text-xs">Alert</code> with an <code className="font-mono text-xs">action</code>, a header row, and a plain <code className="font-mono text-xs">Table</code> with <code className="font-mono text-xs">Chip</code>s. Illustrative mock — not tied to a specific screen.
                    </Typography>
                    {/* Alert with an action button */}
                    <Alert color="warning"
                           outerClassName="mb-4"
                           action={<Button>Make me admin</Button>}>
                        No admin users exist. You can make yourself an admin.
                    </Alert>
                    {/* Header row: title + primary action */}
                    <div className="flex items-center mt-12">
                        <Typography gutterBottom variant="h4" className="grow" component="h4">Users</Typography>
                        <Button startIcon={<PlusIcon/>}>Add user</Button>
                    </div>
                    {/* Table */}
                    <div className="overflow-auto">
                        <Table className="w-full">
                            <TableHeader>
                                <TableCell header className="truncate w-16"></TableCell>
                                <TableCell header>Email</TableCell>
                                <TableCell header>Name</TableCell>
                                <TableCell header>Roles</TableCell>
                            </TableHeader>
                            <TableBody>
                                {[
                                    { uid: "1",
email: "alice@example.com",
displayName: "Alice Johnson",
roles: [{ id: "admin",
name: "Admin",
isAdmin: true }] },
                                    { uid: "2",
email: "bob@example.com",
displayName: "Bob Smith",
roles: [{ id: "editor",
name: "Editor",
isAdmin: false }] },
                                    { uid: "3",
email: "carol@example.com",
displayName: "Carol White",
roles: [] }
                                ].map(user => (
                                    <TableRow key={user.uid}>
                                        <TableCell style={{ width: "64px" }}>
                                            <Tooltip asChild title="Delete this user">
                                                <IconButton size="small"><Trash2Icon/></IconButton>
                                            </Tooltip>
                                        </TableCell>
                                        <TableCell>{user.email}</TableCell>
                                        <TableCell className="font-medium">{user.displayName}</TableCell>
                                        <TableCell>
                                            <div className="flex flex-wrap gap-2">
                                                {user.roles.map(role => (
                                                    <Chip key={role.id} colorScheme={role.isAdmin ? "purple" : "blue"} size="small">
                                                        {role.name}
                                                    </Chip>
                                                ))}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </SectionBlock>

                {/* ═══════════════════════════════════════════════
                    SECTION: Form Dialog
                ═══════════════════════════════════════════════ */}
                <SectionBlock id="user-dialog" title="Form Dialog — grid + MultiSelect + LoadingButton">
                    <Typography variant="body2" color="secondary" className="mb-4">
                        Canonical form-in-a-card layout: <code className="font-mono text-xs">grid grid-cols-12 gap-4</code> for the fields, a <code className="font-mono text-xs">MultiSelect</code>, and a <code className="font-mono text-xs">LoadingButton</code> to submit. Illustrative mock — not tied to a specific screen.
                    </Typography>
                    <div className={`rounded-lg border w-full max-w-xl ${defaultBorderMixin}`}>
                        <div className="px-6 pt-6 pb-2">
                            <Typography variant="h4">User</Typography>
                        </div>
                        <div className="px-6 py-4">
                            <div className="grid grid-cols-12 gap-4">
                                <div className="col-span-12">
                                    <TextField name="displayName" required value="Alice Johnson" onChange={() => {}} label="Name"/>
                                </div>
                                <div className="col-span-12">
                                    <TextField required name="email" value="alice@example.com" onChange={() => {}} label="Email" disabled/>
                                </div>
                                <div className="col-span-12">
                                    <MultiSelect className="w-full" label="Roles" value={["admin"]} onValueChange={() => {}}>
                                        <MultiSelectItem value="admin">Admin</MultiSelectItem>
                                        <MultiSelectItem value="editor">Editor</MultiSelectItem>
                                        <MultiSelectItem value="viewer">Viewer</MultiSelectItem>
                                    </MultiSelect>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center justify-end gap-2 px-6 pb-6">
                            <Button variant="text">Cancel</Button>
                            <LoadingButton variant="filled" loading={false}>Update</LoadingButton>
                        </div>
                    </div>
                </SectionBlock>

                {/* ═══════════════════════════════════════════════
                    SECTION: CRM Dashboard
                ═══════════════════════════════════════════════ */}
                <SectionBlock wide id="crm-dashboard" title="CRM Dashboard — CrmDashboardDemo">
                    <Typography variant="body2" color="secondary" className="mb-4">
                        A real-world showcase of a complex dashboard home page incorporating Rebase design language.
                    </Typography>
                    {/* The dashboard is intrinsically ~1483px wide — wider than the
                        content column at any laptop size. Scrolling it inside its
                        own container is what stops it pushing the section, and is
                        the same rule wide tables follow everywhere else. */}
                    <div className="w-full overflow-x-auto">
                        <CrmDashboardDemo />
                    </div>
                </SectionBlock>

                {/* ═══════════════════════════════════════════════
                    SECTION: Collection Table
                ═══════════════════════════════════════════════ */}
                <SectionBlock wide id="collection-table" title="Collection Table">
                    <Typography variant="body2" color="secondary" className="mb-4">
                        Sample data collection rendered as a sortable, searchable, filterable table with row selection.
                        Uses <code className="font-mono text-xs">Table</code>, <code className="font-mono text-xs">Chip</code>,{" "}
                        <code className="font-mono text-xs">SearchBar</code>, <code className="font-mono text-xs">Select</code>,{" "}
                        <code className="font-mono text-xs">Checkbox</code>.
                    </Typography>
                    <div className="w-full"><CollectionTableDemo /></div>
                </SectionBlock>

                {/* ═══════════════════════════════════════════════
                    SECTION: Card View
                ═══════════════════════════════════════════════ */}
                <SectionBlock wide id="card-view" title="Card View">
                    <Typography variant="body2" color="secondary" className="mb-4">
                        Grid of entity cards with thumbnail area, progress bar, status/priority chips, and assignee.
                        Uses <code className="font-mono text-xs">Card</code>, <code className="font-mono text-xs">Chip</code>,{" "}
                        <code className="font-mono text-xs">ToggleButtonGroup</code>, <code className="font-mono text-xs">SearchBar</code>.
                    </Typography>
                    <div className="w-full"><CardViewDemo /></div>
                </SectionBlock>

                {/* ═══════════════════════════════════════════════
                    SECTION: Kanban Board
                ═══════════════════════════════════════════════ */}
                <SectionBlock wide id="kanban-board" title="Kanban Board">
                    <Typography variant="body2" color="secondary" className="mb-4">
                        Drag-and-drop kanban board with four status columns.
                        Uses <code className="font-mono text-xs">KanbanView</code>, <code className="font-mono text-xs">BoardItem</code>,{" "}
                        <code className="font-mono text-xs">BoardItemViewProps</code>.
                    </Typography>
                    <div className="w-full overflow-x-auto"><KanbanBoardDemo /></div>
                </SectionBlock>
            </div>
        </div>
    );
}

function SectionBlock({ id, title, wide, children }: { id: string; title: string; wide?: boolean; children: React.ReactNode }) {
    return (
        // `max-w-5xl` and `border-b` used to share this element, and they cannot.
        // Several mocks here are app-scale and intrinsically wider than 64rem
        // (the CRM dashboard reaches 1483px), so the section's own rule stopped
        // at 1264px while its content ran past it — every such section read as a
        // broken edge.
        //
        // Split instead: the SECTION spans the column, so its rule always
        // reaches its own edges; the CONTENT keeps a measure, so a form column
        // never stretches to 700px on a wide monitor. `wide` opts the app-scale
        // mocks out of the measure — they pair it with `overflow-x-auto` so they
        // scroll inside themselves rather than pushing the page.
        <section id={id} className={cls("px-6 py-8 border-b scroll-mt-0", defaultBorderMixin)}>
            <div className={wide ? undefined : "max-w-5xl"}>
                <Typography variant="h5" className="mb-1">{title}</Typography>
                <div className="mt-4">{children}</div>
            </div>
        </section>
    );
}
