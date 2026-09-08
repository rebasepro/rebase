/**
 * The system chapters of the UI reference: the decisions behind the kit,
 * shown with the kit's own components. Sources: `packages/ui/src/theme.css`,
 * `packages/ui/src/styles.ts`, `packages/ui/DESIGN.md`, and the reference the
 * ladder was measured against, `docs/design/instatic-distilled.html`.
 *
 * Nothing here is invented markup: every specimen is a `@rebasepro/ui`
 * component or a role token from `theme.css`. The Tailwind palette hues
 * (`bg-green-500` and friends) appear only as dots and icons, which is the
 * rule this page exists to show.
 */
import React from "react";
import {
    Avatar,
    Button,
    Card,
    CheckIcon,
    Chip,
    cls,
    codeSurfaceMixin,
    DatabaseIcon,
    FileTextIcon,
    getColorSchemeForKey,
    IconButton,
    iconSize,
    ImageIcon,
    Paper,
    paperMixin,
    PencilIcon,
    Select,
    SelectItem,
    SettingsIcon,
    ShoppingCartIcon,
    TextField,
    Typography,
    UploadIcon,
    UsersIcon
} from "@rebasepro/ui";
import { Dot, SectionBlock, SpecimenLabel } from "./SectionBlock";

/* ────────────────────────────────────────────────────────────────────────────
   Principles
   ──────────────────────────────────────────────────────────────────────────── */

const PRINCIPLES: { title: string; body: string; specimen: React.ReactNode }[] = [
    {
        title: "The chrome is monochrome. A hue is information.",
        body: "Every control is a shade of the surface ladder. Colour appears where it means something: a dot for a state, a tint behind a value the operator chose, an outline, an icon, and the one filled button a screen has for its main action.",
        specimen: (
            <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-2 text-sm"><Dot className="bg-green-500"/>Live</span>
                <Chip colorScheme="blue" size="small">Published</Chip>
                <Chip colorScheme="red" size="small" outlined>Overdue</Chip>
                <Button size="small">Cancel</Button>
                <Button size="small" color="primary">Save</Button>
            </div>
        )
    },
    {
        title: "Two voices: Inter for words, JetBrains Mono for anything measured.",
        body: "What a person reads is set in the sans. What the system measured — a count, a size, a timestamp, an id, a path — is set in the mono tier, muted, and it lines up in columns because the digits are tabular.",
        specimen: (
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                <Typography variant="body1" component="span">Orders</Typography>
                <Typography variant="mono" component="span" color="secondary" className="text-xs">1,284 rows</Typography>
                <Typography variant="mono" component="span" color="secondary" className="text-xs">16/08/2026, 05:30</Typography>
                <Typography variant="mono" component="span" color="secondary" className="text-xs">europe-west1</Typography>
            </div>
        )
    },
    {
        title: "Depth is a lightness step plus a hairline. Nothing casts a shadow unless it floats.",
        body: "Frame, sheet, card, raised: each one step up from the surface it sits on, separated by a 1px line at 8% where the step alone would not read. Menus, popovers and dialogs float, so they get the strong hairline and a shadow.",
        specimen: (
            <div className="flex flex-wrap items-start gap-3">
                <div className="bg-surface-sheet border border-hairline rounded-xl p-3 w-44">
                    <div className="bg-surface-card border border-hairline rounded-lg p-3">
                        <Typography variant="caption" color="secondary" className="font-mono">card on sheet</Typography>
                    </div>
                </div>
                <div className={cls(paperMixin, "p-3 w-44 shadow-lg")}>
                    <Typography variant="caption" color="secondary" className="font-mono">floating paper</Typography>
                </div>
            </div>
        )
    },
    {
        title: "Big and small, with little in between.",
        body: "A headline figure is very big and its context is very small. The middle sizes are for prose, and a data surface has almost none — that gap is what makes a dashboard read as an instrument rather than a form.",
        specimen: (
            <div>
                <Typography variant="micro" component="div" color="secondary">Storage</Typography>
                <Typography variant="stat" component="div" className="mt-1">264 MB</Typography>
                <Typography variant="mono" component="div" color="secondary" className="text-xs mt-1">used · 6 collections · self-hosted</Typography>
            </div>
        )
    },
    {
        title: "Dense controls, generous containers.",
        body: "Fields are 32px with 14px text and a 13px label; buttons in a toolbar are 32px. The card around them keeps 16–20px of padding and the form grid keeps 20px between rows. Density lives inside the container; air lives between containers.",
        specimen: (
            <Card className="p-4 w-64">
                <Typography variant="caption" className="block text-[13px] font-medium mb-1.5">Product name</Typography>
                <TextField size="small" value="Italian coffee maker" onChange={() => {}}/>
                <Typography variant="caption" color="disabled" className="block mt-1.5">Shown on the storefront and in receipts.</Typography>
            </Card>
        )
    },
    {
        title: "Status is a dot before the word. A count is a number in the mono voice.",
        body: "A list shows state with a 6px dot and a plain word, and puts the measured value flush right in the mono tier. No badges, no filled pills, nothing that has to be read twice.",
        specimen: (
            <div className="w-56 flex flex-col">
                {[
                    ["bg-green-500", "Site", "Live"],
                    ["bg-green-500", "Build", "3m ago"],
                    ["bg-amber-500", "Plugins", "1 update"]
                ].map(([hue, label, value]) => (
                    <div key={label} className="flex items-center gap-2.5 h-8 text-sm">
                        <Dot className={hue}/>
                        <span>{label}</span>
                        <Typography variant="mono" component="span" color="secondary" className="ml-auto text-xs">{value}</Typography>
                    </div>
                ))}
            </div>
        )
    }
];

export function PrinciplesSection() {
    return (
        <SectionBlock id="principles" title="Principles">
            <Typography variant="body2" color="secondary" className="mb-6 max-w-[68ch]">
                Six decisions the panel holds everywhere at once. Each one lives in{" "}
                <code className="font-mono text-xs">theme.css</code> or <code className="font-mono text-xs">styles.ts</code>, so
                a screen that breaks one is wrong, not different. They were distilled from the reference the ladder was
                measured against (<code className="font-mono text-xs">docs/design/instatic-distilled.html</code>) and adapted to
                the kit&apos;s own tokens.
            </Typography>
            <div className="flex flex-col">
                {PRINCIPLES.map((p, i) => (
                    <div key={p.title}
                         className={cls("grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] gap-x-10 gap-y-4 py-6",
                             i > 0 && "border-t border-hairline")}>
                        <div>
                            <Typography variant="h6" component="h3" className="mb-2">{p.title}</Typography>
                            <Typography variant="body2" color="secondary" className="max-w-[60ch]">{p.body}</Typography>
                        </div>
                        <div className="md:pt-1">{p.specimen}</div>
                    </div>
                ))}
            </div>
        </SectionBlock>
    );
}

/* ────────────────────────────────────────────────────────────────────────────
   Colour
   ──────────────────────────────────────────────────────────────────────────── */

const CHIP_HUES = ["blue", "teal", "red", "green", "yellow", "orange", "purple", "pink", "cyan", "indigo", "violet", "fuchsia", "rose", "emerald", "gray"] as const;

export function ColourSection() {
    return (
        <SectionBlock id="colour" title="Colour — where a hue may appear">
            <Typography variant="body2" color="secondary" className="mb-6 max-w-[68ch]">
                The surfaces are grey and the primary is spent once per screen. Everything else colour does, it does in one of
                five forms, from quietest to loudest. The chip palette is fifteen hues, and a chip paints its hue as a
                tint by default; the solid stop is <code className="font-mono text-xs">variant=&quot;filled&quot;</code>, for swatches.
            </Typography>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
                <div>
                    <SpecimenLabel>dot</SpecimenLabel>
                    <div className="flex flex-col gap-2 text-sm">
                        <span className="inline-flex items-center gap-2"><Dot className="bg-green-500"/>Healthy</span>
                        <span className="inline-flex items-center gap-2"><Dot className="bg-amber-500"/>Degraded</span>
                        <span className="inline-flex items-center gap-2"><Dot className="bg-red-500"/>Failing</span>
                    </div>
                </div>
                <div>
                    <SpecimenLabel>icon</SpecimenLabel>
                    <div className="flex items-center gap-3 text-text-secondary dark:text-text-secondary-dark">
                        <CheckIcon size={iconSize.smallest} className="text-green-600 dark:text-green-500"/>
                        <UploadIcon size={iconSize.smallest} className="text-primary dark:text-primary-light"/>
                        <SettingsIcon size={iconSize.smallest}/>
                    </div>
                    <Typography variant="caption" color="secondary" className="block mt-2">Inherits the text tier unless it carries a state.</Typography>
                </div>
                <div>
                    <SpecimenLabel>outline</SpecimenLabel>
                    <div className="flex flex-wrap gap-2">
                        <Chip colorScheme="blue" size="small" outlined>Draft</Chip>
                        <Chip colorScheme="red" size="small" outlined>Blocked</Chip>
                    </div>
                </div>
                <div>
                    <SpecimenLabel>tint</SpecimenLabel>
                    <div className="flex flex-wrap gap-2">
                        <Chip colorScheme="green" size="small">Published</Chip>
                        <Chip colorScheme="purple" size="small">Serveware</Chip>
                    </div>
                    <Typography variant="caption" color="secondary" className="block mt-2">The default for a value the operator chose.</Typography>
                </div>
                <div>
                    <SpecimenLabel>fill · one per screen</SpecimenLabel>
                    <div className="flex flex-wrap gap-2">
                        <Button size="small" color="primary">Add product</Button>
                        <Button size="small">Import</Button>
                    </div>
                </div>
            </div>

            <SpecimenLabel>the hue set, as the dots it usually is</SpecimenLabel>
            <div className="flex flex-wrap gap-x-5 gap-y-2 mb-8">
                {CHIP_HUES.map(hue => {
                    // The tint ink is the hue at the strength a dot wants: deep in
                    // light mode, mid in dark. Two dots, one per theme, so the page
                    // needs no JS to know which theme it is in.
                    const scheme = getColorSchemeForKey(hue);
                    return (
                        <span key={hue} className="inline-flex items-center gap-2">
                            <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-full dark:hidden" style={{ backgroundColor: scheme.tintText }}/>
                            <span aria-hidden className="hidden dark:inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: scheme.darkTintText }}/>
                            <Typography variant="mono" component="span" color="secondary" className="text-xs">{hue}</Typography>
                        </span>
                    );
                })}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <SpecimenLabel>primary as text · accentTextMixin</SpecimenLabel>
                    <Typography variant="body2">
                        Read as text on a dark card, <code className="font-mono text-xs">#0070F4</code> lands under AA, so links use{" "}
                        <a href="#colour" className="text-primary dark:text-primary-light font-medium">the lifted primary</a> in dark mode
                        and the raw primary in light. Fills keep the raw value: white on it is what it was tuned for.
                    </Typography>
                </div>
                <div>
                    <SpecimenLabel>what never happens</SpecimenLabel>
                    <Typography variant="body2" color="secondary">
                        A second filled hue on the same screen; a chip painted as a solid block to show a status; the rose
                        secondary on a control; a coloured background on a region. If a screen needs any of these, the
                        information it is trying to carry belongs in a dot, a word, or a number.
                    </Typography>
                </div>
            </div>
        </SectionBlock>
    );
}

/* ────────────────────────────────────────────────────────────────────────────
   Shape and space
   ──────────────────────────────────────────────────────────────────────────── */

/* The ladder as theme.css sets it: md / lg / xl are overridden there, so the
   product is curvier than Tailwind's defaults without any call site naming a
   number. `full` is a rule, not a size. */
const RADII: [string, string, string][] = [
    ["rounded-md", "6", "chip, code well, tile, segment"],
    ["rounded-lg", "9", "control, row highlight, menu, folder tab, segmented track"],
    ["rounded-xl", "13", "card, sheet, dialog"],
    ["rounded-2xl", "16", "login card"],
    ["rounded-full", "pill", "search, switch, avatar"]
];

const CONTROL_SIZES = [
    {
        size: "smallest" as const,
        px: 28,
        use: "a control inside a table cell"
    },
    {
        size: "small" as const,
        px: 32,
        use: "record forms, toolbars, the reference density"
    },
    {
        size: "medium" as const,
        px: 40,
        use: "dialogs and standalone controls"
    },
    {
        size: "large" as const,
        px: 48,
        use: "the login screen and other one-field moments"
    }
];

export function ShapeSpaceSection() {
    return (
        <SectionBlock id="shape" title="Shape and space">
            <Typography variant="body2" color="secondary" className="mb-6 max-w-[68ch]">
                One radius ladder, one height ladder, a 4px grid. A control and a field at the same{" "}
                <code className="font-mono text-xs">size</code> are pixel-identical in height and share a baseline
                (<code className="font-mono text-xs">CONTROL_HEIGHT</code> in <code className="font-mono text-xs">styles.ts</code>).
            </Typography>

            <SpecimenLabel>radius</SpecimenLabel>
            <div className="flex flex-wrap gap-4 mb-8">
                {RADII.map(([cn, px, use]) => (
                    <div key={cn} className={cls("bg-surface-field border border-hairline w-40 h-16 p-2.5 flex flex-col justify-end", cn)}>
                        <Typography variant="mono" component="span" className="text-xs">{px} · {cn.replace("rounded-", "")}</Typography>
                        <Typography variant="caption" color="secondary" className="truncate">{use}</Typography>
                    </div>
                ))}
            </div>

            <SpecimenLabel>control heights · Button, TextField, Select, IconButton at the same size</SpecimenLabel>
            <div className="flex flex-col gap-3 mb-8">
                {CONTROL_SIZES.map(({ size, px, use }) => (
                    <div key={size} className="flex flex-wrap items-center gap-3">
                        <Typography variant="mono" component="span" color="secondary" className="text-xs w-24 shrink-0">{px} · {size}</Typography>
                        <Button size={size}>Button</Button>
                        <TextField size={size} value="Field" onChange={() => {}} className="w-40"/>
                        <Select size={size} value="a" onValueChange={() => {}} className="w-40">
                            <SelectItem value="a">Select</SelectItem>
                        </Select>
                        <IconButton size={size}><PencilIcon size={size === "smallest" ? 14 : size === "small" ? 16 : size === "medium" ? 20 : 24}/></IconButton>
                        <Typography variant="caption" color="secondary" className="basis-full md:basis-auto">{use}</Typography>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <SpecimenLabel>spacing</SpecimenLabel>
                    <div className="flex flex-col text-sm">
                        {[
                            ["4px", "the grid every gap lands on; most gaps are 8"],
                            ["6px", "label to field, field to helper text"],
                            ["20 × 16px", "record form rows × columns (gap-y-5 gap-x-4)"],
                            ["16–20px", "card padding, all four sides"],
                            ["32px", "between chapters of a page (py-8)"]
                        ].map(([v, what]) => (
                            <div key={v} className="flex items-baseline gap-4 py-1.5 border-b border-hairline last:border-0">
                                <Typography variant="mono" component="span" className="text-xs w-20 shrink-0">{v}</Typography>
                                <Typography variant="body2" component="span" color="secondary">{what}</Typography>
                            </div>
                        ))}
                    </div>
                </div>
                <div>
                    <SpecimenLabel>a record-form field, assembled</SpecimenLabel>
                    <div className="max-w-xs">
                        <div className="flex items-center gap-1.5 font-medium leading-tight mb-1.5 text-[13px]">
                            <span className="shrink-0 text-text-disabled dark:text-text-disabled-dark"><FileTextIcon size={14}/></span>
                            <span>SKU</span>
                            <span className="text-red-500 -ml-1">*</span>
                        </div>
                        <TextField size="small" value="SKU-57032" onChange={() => {}}/>
                        <Typography variant="caption" color="disabled" className="block mt-1.5 ml-0.5 leading-snug">
                            Stock keeping unit — unique product identifier
                        </Typography>
                    </div>
                    <Typography variant="caption" color="secondary" className="block mt-3">
                        13px label in the primary ink with a muted 14px type icon, a 32px field with its hairline, an 11px note.
                        Mirrors <code className="font-mono">FieldBlock</code> in the panel.
                    </Typography>
                </div>
            </div>
        </SectionBlock>
    );
}

/* ────────────────────────────────────────────────────────────────────────────
   Depth and icons
   ──────────────────────────────────────────────────────────────────────────── */

export function DepthIconsSection() {
    return (
        <SectionBlock id="depth" title="Depth and icons">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                    <Typography variant="body2" color="secondary" className="mb-4 max-w-[52ch]">
                        Two kinds of surface, and the border is what tells them apart. A card sits <em>on</em> the page: one
                        step lighter, a plain hairline. A paper floats <em>over</em> it: the strong hairline and a shadow,
                        because it has to read against anything underneath. The scrim is the only large translucent fill.
                    </Typography>
                    <div className="bg-surface-sheet border border-hairline rounded-xl p-4 flex flex-wrap gap-4 items-start">
                        <Card className="p-4 w-48">
                            <Typography variant="micro" component="div" color="secondary">card</Typography>
                            <Typography variant="body2" className="mt-1">cardMixin · hairline</Typography>
                        </Card>
                        <Paper className="p-4 w-48 shadow-lg">
                            <Typography variant="micro" component="div" color="secondary">paper</Typography>
                            <Typography variant="body2" className="mt-1">paperMixin · hairline-strong</Typography>
                        </Paper>
                        <div className={cls(codeSurfaceMixin, "p-3 w-48 font-mono text-xs text-text-secondary dark:text-text-secondary-dark")}>
                            <div className="typography-micro mb-1">well</div>
                            SELECT 1;
                        </div>
                    </div>
                </div>
                <div>
                    <Typography variant="body2" color="secondary" className="mb-4 max-w-[52ch]">
                        Icons are Lucide outlines, sized from the <code className="font-mono text-xs">iconSize</code> map and coloured by
                        the text tier they sit in. A leading icon in a list sits in a 28px raised tile so every row shares a
                        left edge.
                    </Typography>
                    <div className="flex flex-wrap items-end gap-6 mb-5">
                        {(["smallest", "small", "medium", "large"] as const).map(s => (
                            <div key={s} className="flex flex-col items-center gap-1.5">
                                <SettingsIcon size={iconSize[s]} className="text-text-secondary dark:text-text-secondary-dark"/>
                                <Typography variant="mono" component="span" color="secondary" className="text-xs">{iconSize[s]} · {s}</Typography>
                            </div>
                        ))}
                    </div>
                    <SpecimenLabel>icon tile · a leading icon in a row</SpecimenLabel>
                    <div className="flex flex-col gap-1 max-w-xs">
                        {[
                            [<ImageIcon key="i" size={14}/>, "Media", "3 files", "2 / 3"],
                            [<FileTextIcon key="p" size={14}/>, "Pages", "1 page", "0 / 1"],
                            [<DatabaseIcon key="d" size={14}/>, "Collections", "12 tables", "12 / 12"]
                        ].map(([icon, name, sub, count]) => (
                            <div key={String(name)} className="flex items-center gap-3 h-11 px-3 bg-surface-card border border-hairline rounded-lg">
                                <span className="w-7 h-7 rounded-md bg-surface-raised flex items-center justify-center text-text-secondary dark:text-text-secondary-dark shrink-0">{icon}</span>
                                <div className="min-w-0">
                                    <Typography variant="body2" className="font-medium block leading-tight">{name}</Typography>
                                    <Typography variant="mono" component="span" color="secondary" className="text-[11px]">{sub}</Typography>
                                </div>
                                <Typography variant="mono" component="span" color="secondary" className="ml-auto text-xs">{count}</Typography>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </SectionBlock>
    );
}

/* ────────────────────────────────────────────────────────────────────────────
   Cards and data
   ──────────────────────────────────────────────────────────────────────────── */

function StatCard({ hue, icon, label, value, context, children }: {
    hue: string; icon: React.ReactNode; label: string; value: string; context: string; children?: React.ReactNode;
}) {
    return (
        <Card className="p-4 flex flex-col">
            {/* The header grammar: a 6px hue dot, a 14px icon in the secondary tier,
                the label in the micro tier. The dot is the card's category colour and
                the only place that colour appears on the card. */}
            <div className="flex items-center gap-2 mb-3.5">
                <Dot className={hue}/>
                <span className="text-text-secondary dark:text-text-secondary-dark flex items-center">{icon}</span>
                <Typography variant="micro" component="span" color="secondary">{label}</Typography>
            </div>
            <Typography variant="stat" component="div">{value}</Typography>
            <Typography variant="mono" component="div" color="secondary" className="text-[11px] mt-1.5">{context}</Typography>
            {children && <div className="mt-4">{children}</div>}
        </Card>
    );
}

export function CardsDataSection() {
    const storage: [string, string, string, number][] = [
        ["bg-amber-500", "Images", "257 MB", 88],
        ["bg-blue-500", "Documents", "1 MB", 3],
        ["bg-green-500", "Database", "6 MB", 5]
    ];
    return (
        <SectionBlock id="data" title="Cards and data">
            <Typography variant="body2" color="secondary" className="mb-6 max-w-[68ch]">
                The dashboard card is the most reusable idea in the system: a labelled instrument with one big value and
                its context underneath. The header grammar never changes — dot, icon, micro label — so a grid of them
                scans as one thing. Lists inside cards put the measured value flush right in the mono tier and show state
                as a dot before the word.
            </Typography>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                <StatCard hue="bg-blue-500" icon={<ShoppingCartIcon size={14}/>} label="Orders" value="1,284" context="+ 40 this week">
                    <Typography variant="mono" component="div" color="secondary" className="text-[11px] flex gap-4">
                        <span>12 pending</span><span>3 refunded</span>
                    </Typography>
                </StatCard>
                <StatCard hue="bg-amber-500" icon={<FileTextIcon size={14}/>} label="Posts" value="7" context="total · 2 categories">
                    <div className="border-t border-dashed border-amber-500/50 mt-2"/>
                </StatCard>
                <StatCard hue="bg-green-500" icon={<ImageIcon size={14}/>} label="Media" value="74" context="files · 258 MB">
                    <div className="flex gap-1">
                        {["bg-surface-raised", "bg-surface-raised-hover", "bg-surface-raised", "bg-surface-lifted"].map((c, i) => (
                            <div key={i} className={cls("flex-1 h-8 rounded", c)}/>
                        ))}
                    </div>
                </StatCard>
                <StatCard hue="bg-purple-500" icon={<DatabaseIcon size={14}/>} label="Storage" value="264 MB" context="used · Postgres · self-hosted">
                    <div className="h-1.5 rounded-full bg-surface-raised overflow-hidden flex">
                        {storage.map(([hue, name, , pct]) => <div key={name} className={cls("h-full", hue)} style={{ width: `${pct}%` }}/>)}
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2">
                        {storage.map(([hue, name, size]) => (
                            <Typography key={name} variant="mono" component="span" color="secondary" className="text-[11px] inline-flex items-center gap-1.5">
                                <Dot className={hue}/>{name} · {size}
                            </Typography>
                        ))}
                    </div>
                </StatCard>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <Dot className="bg-green-500"/>
                        <span className="text-text-secondary dark:text-text-secondary-dark flex items-center"><CheckIcon size={14}/></span>
                        <Typography variant="micro" component="span" color="secondary">Status</Typography>
                    </div>
                    {[
                        ["bg-green-500", "API", "healthy"],
                        ["bg-green-500", "Realtime", "3 channels"],
                        ["bg-green-500", "Backup", "2h ago"],
                        ["bg-amber-500", "Cron", "1 late"]
                    ].map(([hue, label, value]) => (
                        <div key={label} className="flex items-center gap-2.5 h-8 text-sm">
                            <Dot className={hue}/>
                            <span>{label}</span>
                            <Typography variant="mono" component="span" color="secondary" className="ml-auto text-xs">{value}</Typography>
                        </div>
                    ))}
                </Card>
                <Card className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <Dot className="bg-blue-500"/>
                        <span className="text-text-secondary dark:text-text-secondary-dark flex items-center"><UsersIcon size={14}/></span>
                        <Typography variant="micro" component="span" color="secondary">Activity</Typography>
                    </div>
                    {[
                        ["Z", "published the site", "2m"],
                        ["Z", "created /posts/untitled", "4h"],
                        ["A", "added user alice@example.com", "4h"]
                    ].map(([who, what, when], i) => {
                        const [verb, ...rest] = what.split(" ");
                        const object = rest.join(" ");
                        const isCode = object.startsWith("/") || object.includes("@");
                        return (
                            <div key={i} className="flex items-center gap-2.5 h-9 text-sm min-w-0">
                                <Avatar className="w-5 h-5 text-[10px] shrink-0">{who}</Avatar>
                                <span className="truncate">
                                    {verb}{" "}
                                    {isCode
                                        ? <code className="font-mono text-xs bg-surface-raised px-1.5 py-0.5 rounded">{object}</code>
                                        : object}
                                </span>
                                <Typography variant="mono" component="span" color="secondary" className="ml-auto text-[11px] shrink-0">{when}</Typography>
                            </div>
                        );
                    })}
                </Card>
            </div>
        </SectionBlock>
    );
}
