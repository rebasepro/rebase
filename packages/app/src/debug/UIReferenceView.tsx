
/**
 * UIReferenceView — hidden debug route at /debug/ui
 *
 * The design source of truth for the kit, in two halves. The SYSTEM chapters
 * (principles, surfaces, colour, typography, shape and space, depth and icons,
 * cards and data — `./ui-reference/SystemSections.tsx`) show the decisions in
 * `theme.css`, `styles.ts` and `DESIGN.md` with the kit's own components. The
 * ELEMENT chapters below mirror real screens: markup and classes are copied
 * from the source files they name. DO NOT add invented styles here — copy from
 * the actual component, or compose kit components.
 *
 * Sections named after a component mirror that component. Sections named after
 * a pattern (e.g. "Management Screen", "Form Dialog") are illustrative
 * compositions of kit components and are not tied to a specific screen.
 *
 * Do not cite source line numbers here — they rot silently. Name the file only.
 *
 * Sources:
 *   theme.css, styles.ts, DESIGN.md, docs/design/instatic-distilled.html,
 *   DefaultDrawer.tsx, DefaultAppBar.tsx, DrawerNavigationItem.tsx,
 *   DrawerNavigationGroup.tsx, FieldBlock.tsx
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
import { RebaseLogo } from "../components/RebaseLogo";
import { CrmDashboardDemo } from "./crm-dashboard/CrmDashboardDemo";
import { CollectionTableDemo, CardViewDemo, KanbanBoardDemo } from "./collection-views";
import { SectionBlock } from "./ui-reference/SectionBlock";
import {
    CardsDataSection,
    ColourSection,
    DepthIconsSection,
    PrinciplesSection,
    ShapeSpaceSection
} from "./ui-reference/SystemSections";

/** The page's chapters, in reading order: the system first, then the elements built on it. */
const SECTIONS: { id: string; label: string; icon: React.ComponentType<{ size?: number }>; group: "System" | "Shell" | "Controls" | "Screens" }[] = [
    { id: "principles", label: "Principles", icon: SunMoonIcon, group: "System" },
    { id: "surfaces", label: "Surfaces", icon: LayoutGridIcon, group: "System" },
    { id: "colour", label: "Colour", icon: AlertCircleIcon, group: "System" },
    { id: "typography", label: "Typography", icon: TypeIcon, group: "System" },
    { id: "shape", label: "Shape and space", icon: ColumnsIcon, group: "System" },
    { id: "depth", label: "Depth and icons", icon: AppWindow, group: "System" },
    { id: "drawer", label: "Drawer", icon: PanelLeftIcon, group: "Shell" },
    { id: "appbar", label: "App bar", icon: AppWindow, group: "Shell" },
    { id: "tabs", label: "Tabs", icon: ListIcon, group: "Shell" },
    { id: "editor-sidebar", label: "Editor sidebar", icon: ColumnsIcon, group: "Shell" },
    { id: "buttons", label: "Buttons", icon: PlusIcon, group: "Controls" },
    { id: "inputs", label: "Form inputs", icon: FileTextIcon, group: "Controls" },
    { id: "chips-alerts", label: "Chips and alerts", icon: TagIcon, group: "Controls" },
    { id: "data", label: "Cards and data", icon: LayoutGridIcon, group: "Controls" },
    { id: "empty-states", label: "Empty states", icon: FileIcon, group: "Screens" },
    { id: "users", label: "Management", icon: UserIcon, group: "Screens" },
    { id: "user-dialog", label: "Form dialog", icon: CircleUserIcon, group: "Screens" },
    { id: "crm-dashboard", label: "CRM dashboard", icon: LayoutGridIcon, group: "Screens" },
    { id: "collection-table", label: "Collection table", icon: ListIcon, group: "Screens" },
    { id: "card-view", label: "Card view", icon: LayoutGridIcon, group: "Screens" },
    { id: "kanban-board", label: "Kanban board", icon: KanbanIcon, group: "Screens" }
];

const SECTION_GROUPS = ["System", "Shell", "Controls", "Screens"] as const;

export function UIReferenceView() {
    const [activeSection, setActiveSection] = useState("principles");
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

                {/* Nav entries — the same rows the real drawer draws: a group header
                    from DrawerNavigationGroup, then 30px sentence-case items from
                    DrawerNavigationItem. This nav used to run its own 40px uppercase
                    rows, which made the reference's own chrome the one place on the
                    page that did not follow the reference. */}
                <div className="mt-3 flex-grow overflow-scroll no-scrollbar">
                    {SECTION_GROUPS.map(group => (
                        <div key={group} className="my-2 mx-2 flex flex-col">
                            <div className="pl-3 pr-2 py-0.5 flex flex-row items-center transition-colors cursor-pointer hover:bg-surface-hover rounded-lg">
                                <ChevronDownIcon size={iconSize.small} className="text-surface-400 dark:text-surface-400 transition-transform duration-200 mr-1"/>
                                <Typography variant="caption" color="secondary" className="font-semibold text-[11px] uppercase tracking-wider flex-grow line-clamp-1 text-surface-400 dark:text-surface-400">
                                    {group}
                                </Typography>
                            </div>
                            <div className="flex flex-col">
                                {SECTIONS.filter(s => s.group === group).map(s => {
                                    const IconComponent = s.icon;
                                    const active = activeSection === s.id;
                                    return (
                                        <div
                                            key={s.id}
                                            onClick={() => scrollTo(s.id)}
                                            className={cls(
                                                "rounded-lg truncate group/nav",
                                                "hover:bg-surface-hover text-surface-700 dark:text-surface-300 hover:text-surface-900 dark:hover:text-white",
                                                "flex flex-row items-center pr-4 h-[30px]",
                                                "font-medium text-[13px] cursor-pointer",
                                                active ? "bg-primary/8 dark:bg-primary/10 text-primary dark:text-primary [&_div]:text-primary" : ""
                                            )}
                                        >
                                            <div className="shrink-0 flex items-center justify-center w-[44px] h-[30px] text-surface-500 dark:text-text-secondary-dark [&>svg]:size-4 group-hover/nav:text-primary transition-colors duration-150">
                                                <IconComponent size={iconSize.smallest}/>
                                            </div>
                                            <div className="text-text-primary dark:text-surface-200 font-inherit truncate">
                                                {s.label}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>

                {/* DrawerToggle — from DefaultDrawer */}
                <div className={cls("shrink-0 mt-auto border-t px-2 py-2", defaultBorderMixin)}>
                    <div className={cls(
                        "flex flex-row items-center rounded-lg cursor-pointer",
                        "hover:bg-surface-hover",
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

                <PrinciplesSection/>

                {/* ══════════════════════════════════════════════════════════
                    SECTION: Surfaces
                    The semantic surface ladder from theme.css, nested the way
                    the panel nests it. Toggle the theme to see both ladders.
                ══════════════════════════════════════════════════════════ */}
                <SectionBlock id="surfaces" title="Surfaces — theme.css, styles.ts">
                    <Typography variant="body2" color="secondary" className="mb-4">
                        A surface is named by role and the theme decides the value. Frame, sheet and card each sit one step
                        lighter than the one below; above the card, raised and field are grey on both themes. A hairline marks
                        an object (a card, a field, a floating panel), never a region (a tile, a row, a track), with one
                        exception: the sheet edge against the frame, where the step alone is too small to read.
                        See <code className="font-mono text-xs">packages/ui/DESIGN.md</code>.
                    </Typography>
                    <div className="bg-surface-frame rounded-xl p-4">
                        <Typography variant="caption" className="typography-micro block mb-2 text-text-secondary dark:text-text-secondary-dark">frame · bg-surface-frame</Typography>
                        <div className="bg-surface-sheet border border-hairline rounded-xl p-4">
                            <Typography variant="caption" className="typography-micro block mb-3 text-text-secondary dark:text-text-secondary-dark">sheet · bg-surface-sheet</Typography>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="bg-surface-card border border-hairline rounded-xl p-4">
                                    <Typography variant="caption" className="typography-micro block mb-3 text-text-secondary dark:text-text-secondary-dark">card · bg-surface-card + border-hairline</Typography>
                                    <div className="flex flex-wrap items-center gap-2 mb-3">
                                        <div className="bg-surface-raised hover:bg-surface-raised-hover transition-colors rounded-lg px-3 py-1.5 text-sm">raised</div>
                                        <div className="bg-surface-field hover:bg-surface-field-hover transition-colors rounded-lg px-3 py-1.5 text-sm text-text-secondary dark:text-text-secondary-dark">field</div>
                                        <div className="bg-surface-field rounded-lg p-1 inline-flex gap-1 text-sm">
                                            <span className="bg-surface-lifted rounded-md px-3 py-0.5 shadow-sm">lifted</span>
                                            <span className="px-3 py-0.5 text-text-secondary dark:text-text-secondary-dark">track</span>
                                        </div>
                                    </div>
                                    <div className="flex flex-col gap-0.5">
                                        <div className="px-3 py-1.5 text-sm rounded-md hover:bg-surface-hover transition-colors cursor-default">row · hover:bg-surface-hover</div>
                                        <div className="px-3 py-1.5 text-sm rounded-md bg-surface-active">row · bg-surface-active</div>
                                    </div>
                                </div>
                                <div className="bg-surface-card border border-hairline-strong rounded-lg p-4 shadow-lg self-start">
                                    <Typography variant="caption" className="typography-micro block mb-3 text-text-secondary dark:text-text-secondary-dark">floating · paperMixin, border-hairline-strong</Typography>
                                    <Typography variant="body2">
                                        A menu, a popover, a dialog. The stronger line is what lets it read against anything underneath.
                                    </Typography>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                        {([
                            ["frame", "bg-surface-frame"],
                            ["sheet", "bg-surface-sheet"],
                            ["card", "bg-surface-card"],
                            ["raised", "bg-surface-raised"],
                            ["lifted", "bg-surface-lifted"],
                            ["well", "bg-surface-well"],
                            ["hairline", "border-hairline"],
                            ["hairline strong", "border-hairline-strong"]
                        ] as const).map(([label, cn]) => (
                            <div key={cn} className={cls("rounded-lg h-14 flex items-end p-2 border", cn.startsWith("bg-") ? cn + " border-hairline" : "bg-surface-card " + cn)}>
                                <Typography variant="caption" className="font-mono text-text-secondary dark:text-text-secondary-dark">{label}</Typography>
                            </div>
                        ))}
                    </div>
                </SectionBlock>

                <ColourSection/>

                {/* ═══════════════════════════════════════════════
                    SECTION: Typography
                ═══════════════════════════════════════════════ */}
                <SectionBlock id="typography" title="Typography">
                    <Typography variant="body2" color="secondary" className="mb-4 max-w-[68ch]">
                        Instrument Sans for headings, Inter for everything read, JetBrains Mono for everything measured. The
                        ladder is monotonic: 600 for h1–h4, 500 for h5, h6 and labels, 400 for copy, and 700 never. The display
                        end separates itself by size and tracking, not by weight. Each row names its variant and the rendered
                        size, weight and tracking tier it resolves to.
                    </Typography>
                    <div className="flex flex-col gap-3">
                        {TYPE_LADDER.map(([v, spec]) => (
                            <div key={v} className={cls("flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4 border-b pb-3 last:border-0", defaultBorderMixin)}>
                                <span className="w-56 shrink-0 text-[11px] text-text-secondary dark:text-text-secondary-dark font-mono">
                                    {v} <span className="text-text-disabled dark:text-text-disabled-dark">· {spec}</span>
                                </span>
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
                            digits change width. The mono tier carries counts, sizes, times, ids and paths;
                            it never carries a sentence.
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

                        <div className="mt-6 flex flex-wrap items-end gap-10">
                            <div>
                                <span className="text-[11px] text-text-secondary dark:text-text-secondary-dark font-mono">stat · 30 · 600 · tabular</span>
                                <Typography variant="stat" component="div" className="block mt-1">1,284</Typography>
                            </div>
                            <div>
                                <span className="text-[11px] text-text-secondary dark:text-text-secondary-dark font-mono">display-2 · 36→64 fluid · 600 · the one greeting a page has</span>
                                <div className="text-display-2 font-headers font-semibold mt-1">Good afternoon, Zulu.</div>
                            </div>
                        </div>
                    </div>
                </SectionBlock>

                <ShapeSpaceSection/>
                <DepthIconsSection/>

                <SectionBlock id="drawer" title="Drawer — DefaultDrawer.tsx">
                    <Typography variant="body2" color="secondary" className="mb-4">
                        The drawer wraps <code className="font-mono text-xs">DrawerLogo</code>, scrollable <code className="font-mono text-xs">DrawerNavigationGroup</code>s,
                        and <code className="font-mono text-xs">DrawerToggle</code>. Two visual states: collapsed (icon only, 72px) and expanded (280px).
                    </Typography>
                    <div className="flex gap-6 flex-wrap">

                        {/* Collapsed — exact markup from DefaultDrawer + DrawerNavigationItem */}
                        <div>
                            <Typography variant="caption" color="secondary" className="block mb-1">Collapsed (72px)</Typography>
                            <div className={cls("flex flex-col h-72 relative w-[72px] border rounded-lg overflow-hidden bg-surface-card", defaultBorderMixin)}>
                                <div className="flex flex-row items-center shrink-0 pt-4 pb-2 px-2">
                                    <div className="shrink-0 flex items-center justify-center w-[56px] h-[40px]">
                                        <RebaseLogo width="28px" height="28px"/>
                                    </div>
                                </div>
                                <div className="mt-3 flex-grow overflow-hidden">
                                    <div className="my-2 mx-2 flex flex-col">
                                        <div className="flex flex-col">
                                            {[<FolderIcon key="folder" size={iconSize.smallest}/>, <UserIcon key="user" size={iconSize.smallest}/>, <TagIcon key="tag" size={iconSize.smallest}/>].map((icon, i) => (
                                                <div key={i} className={cls("rounded-lg truncate hover:bg-surface-hover flex flex-row items-center h-[30px]", i === 0 && "bg-primary/8 dark:bg-primary/10")}>
                                                    <div className={cls("shrink-0 flex items-center justify-center w-[44px] h-[30px] [&>svg]:size-4", i === 0 ? "text-primary dark:text-primary" : "text-surface-500 dark:text-text-secondary-dark")}>
                                                        {icon}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                                <div className={cls("shrink-0 mt-auto border-t px-2 py-2", defaultBorderMixin)}>
                                    <div className="flex flex-row items-center rounded-lg cursor-pointer hover:bg-surface-hover transition-colors duration-150 py-2">
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
                            <div className={cls("flex flex-col h-72 relative w-[280px] border rounded-lg overflow-hidden bg-surface-card", defaultBorderMixin)}>
                                {/* DrawerLogo */}
                                <div className="flex flex-row items-center shrink-0 pt-4 pb-2 px-2">
                                    <div className="shrink-0 flex items-center justify-center w-[56px] h-[40px]">
                                        <RebaseLogo width="28px" height="28px"/>
                                    </div>
                                    <div className="flex flex-row items-center overflow-hidden transition-all duration-200 ease-in-out opacity-100 w-full ml-1">
                                        <Typography variant="subtitle1" noWrap className="truncate">Rebase</Typography>
                                    </div>
                                </div>
                                {/* DrawerNavigationGroup: an 11px uppercase group label in the
                                    muted tier, then 30px sentence-case rows at 13px from
                                    DrawerNavigationItem. The active row is the one place the
                                    drawer spends the primary, as an 8-10% tint. */}
                                <div className="mt-3 flex-grow overflow-hidden">
                                    <div className="my-2 mx-2 flex flex-col">
                                        <div className="pl-3 pr-2 py-0.5 flex flex-row items-center transition-colors cursor-pointer hover:bg-surface-hover rounded-lg">
                                            <ChevronDownIcon size={iconSize.small} className="text-surface-400 dark:text-surface-400 mr-1"/>
                                            <Typography variant="caption" color="secondary" className="font-semibold text-[11px] uppercase tracking-wider flex-grow line-clamp-1 text-surface-400 dark:text-surface-400">Content</Typography>
                                        </div>
                                        <div className="flex flex-col">
                                            {[
                                                { label: "Posts", icon: <FolderIcon size={iconSize.smallest}/>, active: true },
                                                { label: "Authors", icon: <UserIcon size={iconSize.smallest}/>, active: false },
                                                { label: "Tags", icon: <TagIcon size={iconSize.smallest}/>, active: false }
                                            ].map(({ label, icon, active }) => (
                                                <div key={label} className={cls(
                                                    "rounded-lg truncate hover:bg-surface-hover text-surface-700 dark:text-surface-300 hover:text-surface-900 dark:hover:text-white flex flex-row items-center pr-4 h-[30px] font-medium text-[13px] cursor-pointer",
                                                    active ? "bg-primary/8 dark:bg-primary/10 text-primary dark:text-primary [&_div]:text-primary" : ""
                                                )}>
                                                    <div className={cls("shrink-0 flex items-center justify-center w-[44px] h-[30px] [&>svg]:size-4 transition-colors duration-150", active ? "text-primary dark:text-primary" : "text-surface-500 dark:text-text-secondary-dark")}>
                                                        {icon}
                                                    </div>
                                                    <div className="text-text-primary dark:text-surface-200 font-inherit truncate">
                                                        {label}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                                {/* DrawerToggle */}
                                <div className={cls("shrink-0 mt-auto border-t px-2 py-2", defaultBorderMixin)}>
                                    <div className="flex flex-row items-center rounded-lg cursor-pointer hover:bg-surface-hover transition-colors duration-150 py-2">
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
                                    <span className="text-xs text-surface-accent-500 dark:text-surface-accent-400 bg-surface-raised px-1 py-0 rounded">42</span>
                                </div>
                                <Typography variant="caption" color="secondary">/</Typography>
                                <div className="flex flex-row items-center gap-2 whitespace-nowrap">
                                    <Typography variant="body2">My Post</Typography>
                                </div>
                            </div>
                        </div>
                        <div className="grow"/>
                        {/* Content/Studio toggle — from DefaultAppBar */}
                        <div className={cls("mr-2 hidden sm:flex bg-surface-field rounded-lg p-0.5")}>
                            <button className={cls("px-3 py-1 text-xs font-medium rounded-md transition-all", "bg-surface-lifted shadow-sm text-text-primary dark:text-text-primary-dark")}>
                                Content
                            </button>
                            <button className={cls("px-3 py-1 text-xs font-medium rounded-md transition-all", "text-surface-500 hover:text-surface-900 dark:hover:text-white")}>
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
                                <Tabs value="schema" onValueChange={() => {}} variant="boxy" className="border-b border-hairline">
                                    <Tab value="schema">Schema</Tab>
                                    <Tab value="snippets">Snippets</Tab>
                                    <Tab value="history">History</Tab>
                                </Tabs>
                                {/* Section header pattern — used in all editor sidebars */}
                                <div className={cls("p-3 border-b flex justify-between items-center", defaultBorderMixin)}>
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
                            <div className={cls("border rounded-lg overflow-hidden flex items-center justify-between pr-2 bg-surface-card", defaultBorderMixin)}>
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
                                    <div className="h-4 w-px bg-hairline"/>
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
                                <Tabs value="schema" onValueChange={() => {}} variant="boxy" className="border-b border-hairline">
                                    <Tab value="schema">Schema</Tab>
                                    <Tab value="snippets">Snippets</Tab>
                                    <Tab value="history">History</Tab>
                                </Tabs>
                                <div className={cls("p-3 border-b flex justify-between items-center", defaultBorderMixin)}>
                                    <Typography variant="caption" className="font-semibold uppercase tracking-wider text-text-secondary dark:text-text-secondary-dark">TABLES</Typography>
                                    <IconButton size="small">
                                        <SettingsIcon size={iconSize.smallest}/>
                                    </IconButton>
                                </div>
                                <div className="flex-grow overflow-y-auto no-scrollbar p-1">
                                    {/* Schema tree items — from SchemaBrowser */}
                                    <div className="mb-2">
                                        <div className="flex items-center p-1 cursor-pointer hover:bg-surface-hover rounded transition-colors">
                                            <svg className="w-3 h-3 mr-1 rotate-90" fill="currentColor" viewBox="0 0 20 20"><path d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"/></svg>
                                            <Typography variant="body2" className="text-text-primary dark:text-text-primary-dark font-medium text-xs">public</Typography>
                                        </div>
                                        <div className="ml-3 mt-1 space-y-1">
                                            {["users", "posts", "comments"].map(t => (
                                                <div key={t} className="flex items-center p-1 cursor-pointer hover:bg-surface-hover rounded transition-colors group">
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
                                <Tabs value="tables" onValueChange={() => {}} variant="boxy" className="border-b border-hairline">
                                    <Tab value="tables">Tables</Tab>
                                    <Tab value="info">Info</Tab>
                                </Tabs>
                                <div className={cls("p-3 border-b flex justify-between items-center", defaultBorderMixin)}>
                                    <Typography variant="caption" className="font-semibold uppercase tracking-wider text-text-disabled dark:text-text-disabled-dark">RLS</Typography>
                                    <IconButton size="small">
                                        <SettingsIcon size={iconSize.smallest}/>
                                    </IconButton>
                                </div>
                                <div className="flex-grow overflow-y-auto no-scrollbar p-1">
                                    <div className="mb-2">
                                        <div className="flex items-center p-1 cursor-pointer hover:bg-surface-hover rounded transition-colors">
                                            <svg className="w-3 h-3 mr-1 rotate-90" fill="currentColor" viewBox="0 0 20 20"><path d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"/></svg>
                                            <Typography variant="body2" className="text-text-primary dark:text-text-primary-dark font-medium text-xs">public</Typography>
                                        </div>
                                        <div className="ml-3 mt-1 space-y-0.5">
                                            {[{ name: "users",
enabled: true }, { name: "posts",
enabled: true }, { name: "sessions",
enabled: false }].map(t => (
                                                <div key={t.name} className={cls("flex items-center p-1 cursor-pointer rounded transition-colors", t.name === "users" ? "bg-primary/10 text-primary dark:bg-primary/20" : "hover:bg-surface-hover text-text-secondary")}>
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
                            <div className={cls("flex flex-col h-72 w-[240px] border rounded-lg overflow-hidden bg-surface-card", defaultBorderMixin)}>
                                <div className={cls("p-3 border-b flex justify-between items-center", defaultBorderMixin)}>
                                    <Typography variant="caption" className="font-semibold uppercase tracking-wider text-text-disabled dark:text-text-disabled-dark">COLLECTIONS</Typography>
                                    <IconButton size="small">
                                        <PlusIcon size={iconSize.smallest}/>
                                    </IconButton>
                                </div>
                                <div className="flex-grow overflow-y-auto no-scrollbar p-2 space-y-0.5">
                                    {[{ name: "Authors" }, { name: "Posts",
selected: true }, { name: "Tags" }].map(c => (
                                        <div key={c.name} className={cls("flex items-center gap-3 px-3 py-2 cursor-pointer rounded-md text-sm transition-colors", c.selected ? "bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary-light" : "hover:bg-surface-hover text-text-secondary dark:text-text-secondary-dark")}>
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
                    SECTION: Buttons
                ═══════════════════════════════════════════════ */}
                <SectionBlock id="buttons" title="Buttons">
                    <Typography variant="body2" color="secondary" className="mb-4 max-w-[68ch]">
                        <code className="font-mono text-xs">neutral</code> is the default and paints <code className="font-mono text-xs">surface-raised</code>;
                        it is what almost every button is. <code className="font-mono text-xs">primary</code> filled is the one main
                        action a screen has. The label is 14px at weight 500, sentence case, no tracking: emphasis is the fill,
                        never the letterforms. <code className="font-mono text-xs">secondary</code> and <code className="font-mono text-xs">error</code> exist
                        for destructive confirmations and the marketing site, not for the panel&apos;s chrome.
                    </Typography>
                    <div className="flex flex-col gap-6">
                        {(["filled", "text"] as const).map(variant => (
                            <div key={variant}>
                                <Typography variant="caption" color="secondary" className="block mb-2 font-mono">variant=&quot;{variant}&quot;</Typography>
                                <div className="flex flex-wrap gap-3 items-center">
                                    {(["neutral", "primary", "text", "secondary", "error"] as const).map(color => (
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
                    <Typography variant="body2" color="secondary" className="mb-4 max-w-[68ch]">
                        Two ways to label a field. A record form puts the label <em>above</em> the control
                        (<code className="font-mono text-xs">FieldBlock</code>: 13px, primary ink, muted type icon) and the control is{" "}
                        <code className="font-mono text-xs">small</code>, 32px. A dialog or a standalone control carries its label{" "}
                        <em>inside</em> as the floating <code className="font-mono text-xs">label</code> prop and is{" "}
                        <code className="font-mono text-xs">medium</code>, 40px. Every field has its hairline.
                    </Typography>
                    <div className="grid grid-cols-12 gap-4">
                        <div className="col-span-12 sm:col-span-6">
                            <Typography variant="caption" color="secondary" className="block mb-2 font-mono">record form · size=&quot;small&quot;, label above</Typography>
                            <div className="flex flex-col gap-5 mb-6">
                                {([
                                    ["Product name", "Italian coffee maker", "Shown on the storefront and in receipts.", false, false],
                                    ["SKU", "SKU-57032", "Stock keeping unit — unique product identifier", true, false],
                                    ["Brand", "Alessi", undefined, false, true]
                                ] as const).map(([label, value, help, required, disabled]) => (
                                    <div key={label} className="flex flex-col min-w-0">
                                        <div className="flex items-center gap-1.5 font-medium leading-tight mb-1.5 text-[13px]">
                                            <span className="shrink-0 text-text-disabled dark:text-text-disabled-dark"><FileTextIcon size={14}/></span>
                                            <span className="truncate">{label}</span>
                                            {required && <span className="text-red-500 dark:text-red-500 -ml-1">*</span>}
                                        </div>
                                        <TextField size="small" value={value} disabled={disabled} onChange={() => {}}/>
                                        {help && <Typography variant="caption" color="disabled" className="mt-1.5 ml-0.5 leading-snug">{help}</Typography>}
                                    </div>
                                ))}
                            </div>
                            <Typography variant="caption" color="secondary" className="block mb-2 font-mono">TextField · floating label, size=&quot;medium&quot; (dialogs)</Typography>
                            <div className="flex flex-col gap-3">
                                <TextField size="medium" label="Default" placeholder="Type something…"/>
                                <TextField size="medium" label="With value" value="Filled value" onChange={() => {}}/>
                                <TextField size="medium" label="Error state" error value="Bad value" onChange={() => {}}/>
                                <TextField size="medium" label="Disabled" disabled value="Read only" onChange={() => {}}/>
                                {/* The smaller sizes are the ones dialogs use, and they
                                    were absent here — which is how a labelled `small`
                                    field shipped with its label sitting on top of its
                                    placeholder. Keep them so the collision is visible on
                                    this page rather than in a modal. */}
                                <TextField size="small" label="Small" placeholder="Placeholder under the label"/>
                                <TextField size="smallest" label="Smallest" value="Filled value" onChange={() => {}}/>
                                <TextField size="large" label="Large" placeholder="The login screen only"/>
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
                            <div className="flex items-center gap-2"><BooleanSwitch value={true} disabled/><span>Disabled on</span></div>
                            <div className="flex items-center gap-2"><BooleanSwitch value={false} disabled/><span>Disabled off</span></div>
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
                        {/* `tinted` is the default for any coloured chip; `filled` is the
                            palette's solid stop, kept for swatches. Side by side so the
                            difference is visible here rather than discovered in a table. */}
                        <Chip colorScheme="green" variant="filled">Filled Green</Chip>
                        <Chip colorScheme="greenDarker">Tinted Darker</Chip>
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

                <CardsDataSection/>

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

/**
 * Every Typography variant with the size, weight and tracking tier it resolves
 * to in `index.css`, so the ladder reads as numbers and not only as a pangram.
 */
const TYPE_LADDER = [
    ["h1", "36 · 600 · display"],
    ["h2", "30 · 600 · display"],
    ["h3", "24 · 600 · title"],
    ["h4", "20 · 600 · title"],
    ["h5", "18 · 500 · heading"],
    ["h6", "16 · 500 · heading"],
    ["lead", "16 · 400 · relaxed"],
    ["subtitle1", "14 · 500 · heading"],
    ["subtitle2", "14 · 500"],
    ["body1", "14 · 400"],
    ["body2", "12 · 400"],
    ["caption", "11 · 400"],
    ["label", "12 · 500 · wide"],
    ["button", "14 · 500"]
] as const;
