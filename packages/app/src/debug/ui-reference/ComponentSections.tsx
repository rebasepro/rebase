/**
 * The kit components the element chapters of the reference did not show:
 * overlays (Dialog, Sheet, Popover, Menubar), disclosure and layout
 * (ExpandablePanel, Collapse, ResizablePanels, CenteredView), the rest of the
 * form controls, and the data components (Badge, InfoLabel, Markdown,
 * VirtualTable). Each is shown in the states product code uses — disabled,
 * error, open — so a screen built from it has something to copy.
 *
 * `app/test/ui_reference_coverage.test.ts` fails when a component exported from
 * `packages/ui/src/components` appears nowhere under `app/src/debug/`.
 */
import React, { useState } from "react";
import {
    Autocomplete,
    AutocompleteItem,
    Badge,
    MailIcon,
    BooleanSwitchWithLabel,
    Button,
    CenteredView,
    type ChipColorKey,
    CircularProgressCenter,
    Collapse,
    ColorPicker,
    DateTimeField,
    DebouncedTextField,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    ExpandablePanel,
    FileUpload,
    InfoLabel,
    InputLabel,
    Label,
    Markdown,
    Menubar,
    MenubarCheckboxItem,
    MenubarContent,
    MenubarItem,
    MenubarMenu,
    MenubarRadioGroup,
    MenubarRadioItem,
    MenubarSeparator,
    MenubarShortcut,
    MenubarSub,
    MenubarSubContent,
    MenubarSubTrigger,
    MenubarTrigger,
    Popover,
    RadioGroup,
    RadioGroupItem,
    ResizablePanels,
    Select,
    SelectGroup,
    SelectItem,
    Sheet,
    Slider,
    TextareaAutosize,
    TextField,
    ToggleButtonGroup,
    Typography,
    VirtualTable,
    type VirtualTableColumn
} from "@rebasepro/ui";
import { SectionBlock, SpecimenLabel } from "./SectionBlock";

/* ══════════════════════════════════════════════════════════════════════
   Overlays — Dialog, Sheet, Popover, Menubar
══════════════════════════════════════════════════════════════════════ */
export function OverlaysSection() {
    const [dialogOpen, setDialogOpen] = useState(false);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [showHidden, setShowHidden] = useState(true);
    const [density, setDensity] = useState("comfortable");

    return (
        <SectionBlock id="overlays" title="Overlays — Dialog, Sheet, Popover, Menubar">
            <Typography variant="body2" color="secondary" className="mb-4 max-w-[68ch]">
                Every overlay is a Radix layer: it traps focus, focuses its own container when it opens
                (pass <code className="font-mono text-xs">initialFocus</code> to focus a field), closes on Escape and
                returns focus to its opener. A dialog holds work, so a backdrop click does not close it unless it is a
                picker (<code className="font-mono text-xs">dismissOnBackdrop</code>). Open each with the keyboard to see
                the focus ring land.
            </Typography>
            <div className="grid grid-cols-12 gap-6">
                <div className="col-span-12 sm:col-span-6">
                    <SpecimenLabel>Dialog · DialogTitle + DialogContent + DialogActions</SpecimenLabel>
                    <Button variant="outlined" onClick={() => setDialogOpen(true)}>Rename collection</Button>
                    <Dialog open={dialogOpen} onOpenChange={setDialogOpen} maxWidth="md">
                        <DialogTitle>Rename collection</DialogTitle>
                        <DialogContent>
                            <TextField size="medium" label="Name" value="Products" onChange={() => {}}/>
                        </DialogContent>
                        <DialogActions>
                            <Button variant="text" onClick={() => setDialogOpen(false)}>Cancel</Button>
                            <Button color="primary" onClick={() => setDialogOpen(false)}>Rename</Button>
                        </DialogActions>
                    </Dialog>
                </div>
                <div className="col-span-12 sm:col-span-6">
                    <SpecimenLabel>Sheet · side=&quot;right&quot;</SpecimenLabel>
                    <Button variant="outlined" onClick={() => setSheetOpen(true)}>Open side panel</Button>
                    <Sheet open={sheetOpen} onOpenChange={setSheetOpen} side="right" title="Filters">
                        <div className="w-[320px] h-full p-6 flex flex-col gap-4 bg-surface-card">
                            <Typography variant="subtitle2">Filters</Typography>
                            <TextField size="small" label="Search" placeholder="Name contains…"/>
                            <Button variant="outlined" onClick={() => setSheetOpen(false)}>Close</Button>
                        </div>
                    </Sheet>
                </div>
                <div className="col-span-12 sm:col-span-6">
                    <SpecimenLabel>Popover</SpecimenLabel>
                    <Popover trigger={<Button variant="outlined">Show details</Button>}>
                        <div className="p-4 flex flex-col gap-2 max-w-[260px]">
                            <Typography variant="subtitle2">Last published</Typography>
                            <Typography variant="body2" color="secondary">
                                Yesterday at 18:04 by Alice Johnson.
                            </Typography>
                        </div>
                    </Popover>
                </div>
                <div className="col-span-12 sm:col-span-6">
                    <SpecimenLabel>Menubar · items, submenu, checkbox, radio, shortcut</SpecimenLabel>
                    <Menubar>
                        <MenubarMenu>
                            <MenubarTrigger>File</MenubarTrigger>
                            <MenubarContent>
                                <MenubarItem>New record <MenubarShortcut>⌘N</MenubarShortcut></MenubarItem>
                                <MenubarItem disabled>Duplicate</MenubarItem>
                                <MenubarSeparator/>
                                <MenubarSub>
                                    <MenubarSubTrigger>Export</MenubarSubTrigger>
                                    <MenubarSubContent>
                                        <MenubarItem>CSV</MenubarItem>
                                        <MenubarItem>JSON</MenubarItem>
                                    </MenubarSubContent>
                                </MenubarSub>
                            </MenubarContent>
                        </MenubarMenu>
                        <MenubarMenu>
                            <MenubarTrigger>View</MenubarTrigger>
                            <MenubarContent>
                                <MenubarCheckboxItem checked={showHidden} onCheckedChange={() => setShowHidden(!showHidden)}>
                                    Show hidden fields
                                </MenubarCheckboxItem>
                                <MenubarSeparator/>
                                <MenubarRadioGroup value={density} onValueChange={setDensity}>
                                    <MenubarRadioItem value="comfortable">Comfortable</MenubarRadioItem>
                                    <MenubarRadioItem value="compact">Compact</MenubarRadioItem>
                                </MenubarRadioGroup>
                            </MenubarContent>
                        </MenubarMenu>
                    </Menubar>
                </div>
            </div>
        </SectionBlock>
    );
}

/* ══════════════════════════════════════════════════════════════════════
   Disclosure and layout — ExpandablePanel, Collapse, ResizablePanels,
   CenteredView, CircularProgressCenter
══════════════════════════════════════════════════════════════════════ */
export function DisclosureLayoutSection() {
    const [collapseOpen, setCollapseOpen] = useState(false);
    const [split, setSplit] = useState(40);

    return (
        <SectionBlock id="disclosure" title="Disclosure and layout">
            <div className="grid grid-cols-12 gap-6">
                <div className="col-span-12 sm:col-span-6 flex flex-col gap-3">
                    <SpecimenLabel>ExpandablePanel · expanded, collapsed</SpecimenLabel>
                    <ExpandablePanel title={<Typography variant="subtitle2">SEO</Typography>}>
                        <div className="p-4 flex flex-col gap-3">
                            <TextField size="small" label="Meta title" value="Italian coffee maker" onChange={() => {}}/>
                        </div>
                    </ExpandablePanel>
                    <ExpandablePanel initiallyExpanded={false} title={<Typography variant="subtitle2">Advanced</Typography>}>
                        <div className="p-4">
                            <Typography variant="body2" color="secondary">Hidden until expanded.</Typography>
                        </div>
                    </ExpandablePanel>
                </div>
                <div className="col-span-12 sm:col-span-6 flex flex-col gap-3">
                    <SpecimenLabel>Collapse</SpecimenLabel>
                    <div>
                        <Button variant="text" size="small" aria-expanded={collapseOpen} onClick={() => setCollapseOpen(!collapseOpen)}>
                            {collapseOpen ? "Hide details" : "Show details"}
                        </Button>
                    </div>
                    <Collapse in={collapseOpen}>
                        <Typography variant="body2" color="secondary">
                            Collapse animates height only; it has no trigger of its own.
                        </Typography>
                    </Collapse>
                </div>
                <div className="col-span-12">
                    <SpecimenLabel>ResizablePanels · drag the divider, or focus it and use ←/→ (Shift for 10%)</SpecimenLabel>
                    <div className="h-40 border border-hairline rounded-lg overflow-hidden">
                        <ResizablePanels
                            dividerAriaLabel="Resize the list"
                            orientation="horizontal"
                            panelSizePercent={split}
                            onPanelSizeChange={setSplit}
                            minPanelSizePx={120}
                            firstPanel={<div className="h-full p-3 bg-surface-card"><Typography variant="body2">List — {Math.round(split)}%</Typography></div>}
                            secondPanel={<div className="h-full p-3"><Typography variant="body2" color="secondary">Detail</Typography></div>}
                        />
                    </div>
                </div>
                <div className="col-span-12 sm:col-span-6">
                    <SpecimenLabel>CenteredView · maxWidth=&quot;md&quot;</SpecimenLabel>
                    <div className="border border-hairline rounded-lg">
                        <CenteredView maxWidth="md" className="py-6">
                            <Typography variant="body2" color="secondary" align="center">A centred, measured column.</Typography>
                        </CenteredView>
                    </div>
                </div>
                <div className="col-span-12 sm:col-span-6">
                    <SpecimenLabel>CircularProgressCenter · a loading pane</SpecimenLabel>
                    <div className="h-32 border border-hairline rounded-lg flex">
                        <CircularProgressCenter size="small" text="Loading records…"/>
                    </div>
                </div>
            </div>
        </SectionBlock>
    );
}

/* ══════════════════════════════════════════════════════════════════════
   More form controls
══════════════════════════════════════════════════════════════════════ */
export function MoreControlsSection() {
    const [published, setPublished] = useState(true);
    const [date, setDate] = useState<Date | null>(new Date(2026, 9, 11, 9, 30));
    const [debounced, setDebounced] = useState("Debounced value");
    const [notes, setNotes] = useState("A textarea that grows\nwith its content.");
    const [visibility, setVisibility] = useState("public");
    const [volume, setVolume] = useState([40]);
    const [colour, setColour] = useState<ChipColorKey | undefined>("blueLight");
    const [viewMode, setViewMode] = useState("table");
    const [query, setQuery] = useState("");
    const [autocompleteOpen, setAutocompleteOpen] = useState(false);
    const suggestions = ["Alessi", "Bialetti", "Bodum", "Hario"].filter(s => s.toLowerCase().includes(query.toLowerCase()));

    return (
        <SectionBlock id="more-controls" title="More form controls">
            <div className="grid grid-cols-12 gap-6">
                <div className="col-span-12 sm:col-span-6 flex flex-col gap-3">
                    <SpecimenLabel>BooleanSwitchWithLabel · every boolean field</SpecimenLabel>
                    <BooleanSwitchWithLabel label="Published" value={published} onValueChange={setPublished} size="small"/>
                    <BooleanSwitchWithLabel label="Disabled" value={true} disabled size="small"/>
                    <BooleanSwitchWithLabel label="With an error" value={false} error size="small"/>
                </div>
                <div className="col-span-12 sm:col-span-6 flex flex-col gap-3">
                    <SpecimenLabel>DateTimeField · date, date_time, time, disabled, error</SpecimenLabel>
                    <DateTimeField size="small" mode="date" label="Publish date" value={date} onChange={setDate} clearable/>
                    <DateTimeField size="small" mode="date_time" label="Publish at" value={date} onChange={setDate}/>
                    <DateTimeField size="small" mode="time" timezone="UTC" label="Opens at" value={date} onChange={setDate}/>
                    <DateTimeField size="small" mode="date" label="Disabled" value={date} onChange={() => {}} disabled/>
                    <DateTimeField size="small" mode="date" label="Error" value={null} onChange={() => {}} error/>
                </div>
                <div className="col-span-12 sm:col-span-6 flex flex-col gap-3">
                    <SpecimenLabel>DebouncedTextField · reports after typing pauses</SpecimenLabel>
                    <DebouncedTextField size="small" label="Title" value={debounced} onChange={(e) => setDebounced(e.target.value)}/>
                    <SpecimenLabel className="mt-2">TextareaAutosize</SpecimenLabel>
                    <TextareaAutosize
                        aria-label="Notes"
                        minRows={2}
                        maxRows={6}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        className="w-full rounded-lg border border-hairline bg-surface-field px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                    />
                </div>
                <div className="col-span-12 sm:col-span-6 flex flex-col gap-3">
                    <SpecimenLabel>Label · InputLabel</SpecimenLabel>
                    <Label htmlFor="ref-label-field">Label, tied to its field</Label>
                    <TextField id="ref-label-field" size="small" placeholder="Focus me through the label"/>
                    <Label border>Label with a border</Label>
                    <div className="relative h-10 border border-hairline rounded-lg">
                        <InputLabel shrink>InputLabel (shrunk)</InputLabel>
                    </div>
                </div>
                <div className="col-span-12 sm:col-span-6 flex flex-col gap-3">
                    <SpecimenLabel>RadioGroup · RadioGroupItem, one disabled</SpecimenLabel>
                    <RadioGroup value={visibility} onValueChange={setVisibility} className="flex flex-col gap-2">
                        {[["public", "Public", false], ["private", "Private", false], ["archived", "Archived", true]].map(([value, label, disabled]) => (
                            <div key={String(value)} className="flex items-center gap-2">
                                <RadioGroupItem id={`ref-radio-${value}`} value={String(value)} disabled={Boolean(disabled)}/>
                                <Label htmlFor={`ref-radio-${value}`}>{String(label)}</Label>
                            </div>
                        ))}
                    </RadioGroup>
                </div>
                <div className="col-span-12 sm:col-span-6 flex flex-col gap-3">
                    <SpecimenLabel>Slider · regular, small, disabled</SpecimenLabel>
                    <Slider value={volume} onValueChange={setVolume} min={0} max={100}/>
                    <Slider size="small" value={volume} onValueChange={setVolume} min={0} max={100}/>
                    <Slider disabled defaultValue={[70]} min={0} max={100}/>
                </div>
                <div className="col-span-12 sm:col-span-6 flex flex-col gap-3">
                    <SpecimenLabel>ColorPicker · with Auto, disabled</SpecimenLabel>
                    <ColorPicker value={colour} onChange={setColour} allowClear/>
                    <ColorPicker value="greenLight" onChange={() => {}} size="small" disabled/>
                </div>
                <div className="col-span-12 sm:col-span-6 flex flex-col gap-3">
                    <SpecimenLabel>Select · SelectGroup</SpecimenLabel>
                    <Select size="small" label="Field type" value="string" onValueChange={() => {}}>
                        <SelectGroup label="Text">
                            <SelectItem value="string">Text</SelectItem>
                            <SelectItem value="markdown">Markdown</SelectItem>
                        </SelectGroup>
                        <SelectGroup label="Numbers">
                            <SelectItem value="number">Number</SelectItem>
                        </SelectGroup>
                    </Select>
                    <SpecimenLabel className="mt-2">ToggleButtonGroup · named, one option disabled</SpecimenLabel>
                    <ToggleButtonGroup
                        aria-label="View mode"
                        value={viewMode}
                        onValueChange={setViewMode}
                        options={[
                            { value: "table", label: "Table" },
                            { value: "cards", label: "Cards" },
                            { value: "kanban", label: "Board", disabled: true }
                        ]}
                    />
                </div>
                <div className="col-span-12 sm:col-span-6 flex flex-col gap-3">
                    <SpecimenLabel>FileUpload</SpecimenLabel>
                    <FileUpload size="small" onFilesAdded={() => {}} uploadDescription="Drop images here or click to choose"/>
                    <FileUpload size="small" disabled onFilesAdded={() => {}} uploadDescription="Disabled"/>
                </div>
                <div className="col-span-12 sm:col-span-6 flex flex-col gap-3">
                    <SpecimenLabel>Autocomplete · AutocompleteItem</SpecimenLabel>
                    <Typography variant="caption" color="secondary">
                        Pointer only: its items have no role and no keyboard path, and it is not portalled, so an
                        overflow ancestor clips it. Prefer Select or MultiSelect until the kit has a combobox.
                    </Typography>
                    <div className="relative">
                        <TextField
                            size="small"
                            label="Brand"
                            value={query}
                            onFocus={() => setAutocompleteOpen(true)}
                            onChange={(e) => {
                                setQuery(e.target.value);
                                setAutocompleteOpen(true);
                            }}
                        />
                        <Autocomplete open={autocompleteOpen && suggestions.length > 0} setOpen={setAutocompleteOpen}>
                            {suggestions.map(suggestion => (
                                <AutocompleteItem key={suggestion} onClick={() => {
                                    setQuery(suggestion);
                                    setAutocompleteOpen(false);
                                }}>
                                    <Typography variant="body2">{suggestion}</Typography>
                                </AutocompleteItem>
                            ))}
                        </Autocomplete>
                    </div>
                </div>
            </div>
        </SectionBlock>
    );
}

/* ══════════════════════════════════════════════════════════════════════
   Data display — Badge, InfoLabel, Markdown, VirtualTable
══════════════════════════════════════════════════════════════════════ */
type Row = { name: string; status: string; updated: string };

const VIRTUAL_ROWS: Row[] = Array.from({ length: 200 }, (_, i) => ({
    name: `Record ${i + 1}`,
    status: i % 3 === 0 ? "Draft" : "Published",
    updated: `2026-10-${String((i % 28) + 1).padStart(2, "0")}`
}));

const VIRTUAL_COLUMNS: VirtualTableColumn[] = [
    { key: "name", title: "Name", width: 220 },
    { key: "status", title: "Status", width: 140 },
    { key: "updated", title: "Updated", width: 160 }
];

export function DataDisplaySection() {
    return (
        <SectionBlock id="data-display" title="Data display — Badge, InfoLabel, Markdown, VirtualTable">
            <div className="grid grid-cols-12 gap-6">
                <div className="col-span-12 sm:col-span-6 flex flex-col gap-3">
                    <SpecimenLabel>Badge · primary, secondary, warning, error, invisible</SpecimenLabel>
                    <div className="flex items-center gap-6">
                        {(["primary", "secondary", "warning", "error"] as const).map(color => (
                            <Badge key={color} color={color}>
                                <MailIcon size={20} aria-label={`Messages (${color})`}/>
                            </Badge>
                        ))}
                        <Badge invisible>
                            <MailIcon size={20} aria-label="No new messages"/>
                        </Badge>
                    </div>
                </div>
                <div className="col-span-12 sm:col-span-6 flex flex-col gap-3">
                    <SpecimenLabel>InfoLabel · info, warn</SpecimenLabel>
                    <InfoLabel>The slug is generated from the title.</InfoLabel>
                    <InfoLabel mode="warn">Changing the slug breaks existing links.</InfoLabel>
                </div>
                <div className="col-span-12">
                    <SpecimenLabel>Markdown · size=&quot;small&quot;</SpecimenLabel>
                    <Markdown size="small" source={"### Release notes\n\nA **bold** claim, a [link](https://rebase.pro) and a list:\n\n- one\n- two\n\n`inline code`"}/>
                </div>
                <div className="col-span-12">
                    <SpecimenLabel>VirtualTable · 200 rows, only the visible ones rendered</SpecimenLabel>
                    <div className="h-64 border border-hairline rounded-lg overflow-hidden">
                        <VirtualTable<Row>
                            data={VIRTUAL_ROWS}
                            columns={VIRTUAL_COLUMNS}
                            rowHeight={40}
                            cellRenderer={({ rowData, column }) => (
                                <div className="px-3 flex items-center h-full">
                                    <Typography variant="body2" noWrap>
                                        {rowData ? rowData[column.key as keyof Row] : ""}
                                    </Typography>
                                </div>
                            )}
                        />
                    </div>
                </div>
            </div>
        </SectionBlock>
    );
}
