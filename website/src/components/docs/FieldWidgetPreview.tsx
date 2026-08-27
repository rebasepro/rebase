"use client";
import React, { useState, useCallback } from "react";
import { RichTextEditor } from "@rebasepro/cms/editor";
import {
    TextField,
    TextareaAutosize,
    BooleanSwitchWithLabel,
    Select,
    SelectItem,
    MultiSelect,
    MultiSelectItem,
    DateTimeField,
    FileUpload,
    Chip,
    ExpandablePanel,

    Button,
    IconButton,
    Typography,
    cls,
    defaultBorderMixin,
    fieldBackgroundMixin,
    fieldBackgroundHoverMixin,
    fieldBackgroundDisabledMixin,
    paperMixin,
    // Icons matching getDefaultIconForProperty
    TextIcon,
    AlignLeftIcon,
    MailIcon,
    GlobeIcon,
    UploadIcon,
    HashIcon,
    FlagIcon,
    CalendarIcon,
    RepeatIcon,
    Rows3Icon,
    VoteIcon,
    LinkIcon,
    HandleIcon,
    MinusIcon,
    PlusIcon,
    ChevronDownIcon,
    ArrowRightToLineIcon,
    iconSize
} from "@rebasepro/ui";

/**
 * All possible field widget preview variants.
 * Used inline in the properties.mdx documentation.
 */
export type FieldVariant =
    | "text"
    | "multiline"
    | "markdown"
    | "email"
    | "url"
    | "file_upload"
    | "select"
    | "multi_select"
    | "number"
    | "boolean"
    | "date"
    | "date_time"
    | "repeat"
    | "multi_file_upload"
    | "block"
    | "group"
    | "key_value"
    | "reference";

export function FieldWidgetPreview({ variant }: { variant: FieldVariant }) {
    return (
        <div className="not-content my-4 max-w-lg">
            <FieldWidget variant={variant}/>
        </div>
    );
}

function FieldWidget({ variant }: { variant: FieldVariant }) {
    switch (variant) {
        case "text":
            return <TextFieldPreview/>;
        case "multiline":
            return <MultilinePreview/>;
        case "markdown":
            return <MarkdownPreview/>;
        case "email":
            return <EmailPreview/>;
        case "url":
            return <UrlPreview/>;
        case "file_upload":
            return <FileUploadPreview/>;
        case "select":
            return <SelectPreview/>;
        case "multi_select":
            return <MultiSelectPreview/>;
        case "number":
            return <NumberPreview/>;
        case "boolean":
            return <BooleanPreview/>;
        case "date":
            return <DatePreview/>;
        case "date_time":
            return <DateTimePreview/>;
        case "repeat":
            return <RepeatPreview/>;
        case "multi_file_upload":
            return <MultiFileUploadPreview/>;
        case "block":
            return <BlockPreview/>;
        case "group":
            return <GroupPreview/>;
        case "key_value":
            return <KeyValuePreview/>;
        case "reference":
            return <ReferencePreview/>;
        default:
            return null;
    }
}

// --- Shared label component matching LabelWithIcon from admin ---

function LabelWithIcon({ icon, title, required }: { icon: React.ReactNode; title: string; required?: boolean }) {
    return (
        <div className="align-middle inline-flex items-center my-0.5 gap-2">
            {icon}
            <span className="text-start font-medium text-sm">
                {title}{required ? " *" : ""}
            </span>
        </div>
    );
}

// --- Shared array item wrapper matching ArrayContainerItem ---

function ArrayItemRow({ children }: { children: React.ReactNode }) {
    return (
        <div className="relative rounded-md">
            <div className="flex items-start">
                <div className="flex-grow w-[calc(100%-48px)] text-text-primary dark:text-text-primary-dark">
                    {children}
                </div>
                <div className="pl-2 pt-1 pb-1 flex flex-col items-center">
                    <IconButton size="small" className="cursor-grab">
                        <HandleIcon/>
                    </IconButton>
                </div>
            </div>
        </div>
    );
}

// --- Individual widget previews matching real field bindings ---

// TextFieldBinding: uses <TextField> with LabelWithIcon label
function TextFieldPreview() {
    const [v, setV] = useState("Acme Corporation");
    return (
        <>
            <TextField
                value={v}
                onChange={e => setV(e.target.value)}
                label={<LabelWithIcon icon={<TextIcon size={iconSize.small}/>} title="Name" required/>}
                size="large"
            />
        </>
    );
}

// TextFieldBinding multiline: uses <TextareaAutosize> inside a styled container
function MultilinePreview() {
    const [v, setV] = useState("A longer description that spans multiple lines in the text area.");
    return (
        <div className={cls(
            "rounded-md relative max-w-full min-h-[64px]",
            fieldBackgroundMixin,
            fieldBackgroundHoverMixin
        )}>
            <div className="pointer-events-none absolute top-1 text-xs font-medium px-3 text-text-secondary dark:text-text-secondary-dark">
                <LabelWithIcon icon={<AlignLeftIcon size={iconSize.small}/>} title="Description"/>
            </div>
            <TextareaAutosize
                value={v}
                onChange={e => setV(e.target.value)}
                className="rounded-md resize-none w-full outline-none p-[32px] text-base bg-transparent min-h-[64px] px-3 pt-8"
            />
        </div>
    );
}

// MarkdownEditorFieldBinding: LabelWithIconAndTooltip + ProseMirror-like editor container
function MarkdownPreview() {
    const handleImageUpload = useCallback(async (file: File): Promise<string> => {
        return URL.createObjectURL(file);
    }, []);

    return (
        <>
            <div className="flex items-center w-full">
                <div className="h-8 text-text-secondary dark:text-text-secondary-dark ml-3.5 flex items-center">
                    <LabelWithIcon icon={<AlignLeftIcon size={iconSize.small}/>} title="Blog text"/>
                </div>
            </div>
            <div className={cls("rounded-md", fieldBackgroundMixin, fieldBackgroundHoverMixin)}>
                <div className="prose dark:prose-invert max-w-none
                    prose-headings:font-title prose-headings:font-normal
                    prose-strong:font-semibold
                    prose-blockquote:font-normal
                    prose-a:font-normal
                    prose-code:font-normal
                    [&_.ProseMirror]:min-h-[200px] [&_.ProseMirror]:p-8 [&_.ProseMirror]:focus:outline-none
                ">
                    <RichTextEditor
                        content={"## Hello World\n\nThis is a **markdown** editor with *rich text* support.\n\n- Bullet one\n- Bullet two\n\n> A blockquote example"}
                        handleImageUpload={handleImageUpload}
                    />
                </div>
            </div>
        </>
    );
}

// TextFieldBinding with email: <TextField> with MailIcon endAdornment
function EmailPreview() {
    const [v, setV] = useState("user@example.com");
    return (
        <TextField
            value={v}
            onChange={e => setV(e.target.value)}
            label={<LabelWithIcon icon={<MailIcon size={iconSize.small}/>} title="User email" required/>}
            type="email"
            size="large"
        />
    );
}

// TextFieldBinding with url: <TextField> with GlobeIcon
function UrlPreview() {
    const [v, setV] = useState("https://amazon.com/dp/B09V3KXJPB");
    return (
        <TextField
            value={v}
            onChange={e => setV(e.target.value)}
            label={<LabelWithIcon icon={<GlobeIcon size={iconSize.small}/>} title="Amazon link"/>}
            type="url"
            size="large"
        />
    );
}

// StorageUploadFieldBinding: LabelWithIconAndTooltip + dropzone with min-height
function FileUploadPreview() {
    return (
        <>
            <div className="h-8 text-text-secondary dark:text-text-secondary-dark ml-3.5 flex items-center">
                <LabelWithIcon icon={<UploadIcon size={iconSize.small}/>} title="Main image"/>
            </div>
            <div className={cls(
                fieldBackgroundMixin,
                fieldBackgroundHoverMixin,
                "box-border relative pt-[2px] items-center border border-transparent min-h-[254px] outline-none rounded-md duration-200 flex"
            )}>
                <div className="flex items-center p-1 px-4 min-h-[250px]"/>
                <div className="flex-grow min-h-[38px] box-border m-2 text-center">
                    <Typography align="center" variant="label">
                        Drag and drop a file here or click
                    </Typography>
                </div>
            </div>
        </>
    );
}

// SelectFieldBinding: <Select> with LabelWithIcon, Chip items
function SelectPreview() {
    const [v, setV] = useState("electronics");
    return (
        <Select
            value={v}
            onValueChange={setV}
            label={<LabelWithIcon icon={<TextIcon size={iconSize.small}/>} title="Category"/>}
            renderValue={(val: string) => {
                const map: Record<string, { label: string; color: string }> = {
                    electronics: { label: "Electronics", color: "blueDark" },
                    clothing: { label: "Clothing", color: "pinkLight" },
                    books: { label: "Books", color: "orangeLight" }
                };
                const item = map[val];
                return item
                    ? <Chip colorScheme={item.color as "blueDark" | "pinkLight" | "orangeLight"} size="small">{item.label}</Chip>
                    : val;
            }}
            fullWidth
        >
            <SelectItem value="electronics">
                <Chip colorScheme="blueDark" size="small">Electronics</Chip>
            </SelectItem>
            <SelectItem value="clothing">
                <Chip colorScheme="pinkLight" size="small">Clothing</Chip>
            </SelectItem>
            <SelectItem value="books">
                <Chip colorScheme="orangeLight" size="small">Books</Chip>
            </SelectItem>
        </Select>
    );
}

// MultiSelectFieldBinding: <MultiSelect> with LabelWithIcon
function MultiSelectPreview() {
    const [v, setV] = useState<string[]>(["es", "en"]);
    return (
        <MultiSelect value={v} onValueChange={setV}
            label={<LabelWithIcon icon={<TextIcon size={iconSize.small}/>} title="Available locales"/>}
        >
            <MultiSelectItem value="es">Spanish</MultiSelectItem>
            <MultiSelectItem value="en">English</MultiSelectItem>
            <MultiSelectItem value="fr">French</MultiSelectItem>
        </MultiSelect>
    );
}

// TextFieldBinding for number: <TextField type="number"> with HashIcon
function NumberPreview() {
    const [v, setV] = useState("49.99");
    return (
        <TextField
            value={v}
            onChange={e => setV(e.target.value)}
            label={<LabelWithIcon icon={<HashIcon size={iconSize.small}/>} title="Price" required/>}
            type="number"
            size="large"
        />
    );
}

// SwitchFieldBinding: <BooleanSwitchWithLabel> with LabelWithIcon
function BooleanPreview() {
    const [v, setV] = useState<boolean>(true);
    return (
        <BooleanSwitchWithLabel
            value={v}
            onValueChange={setV}
            label={<LabelWithIcon icon={<FlagIcon size={iconSize.small}/>} title="Selectable"/>}
            size="large"
        />
    );
}

// DateTimeFieldBinding with mode="date": uses CalendarIcon label
function DatePreview() {
    return (
        <DateTimeField
            value={new Date()}
            onChange={() => {}}
            label={<LabelWithIcon icon={<CalendarIcon size={iconSize.small}/>} title="Expiry date"/>}
            mode="date"
        />
    );
}

// DateTimeFieldBinding with mode="date_time"
function DateTimePreview() {
    return (
        <DateTimeField
            value={new Date()}
            onChange={() => {}}
            label={<LabelWithIcon icon={<CalendarIcon size={iconSize.small}/>} title="Arrival time"/>}
            mode="date_time"
        />
    );
}

// RepeatFieldBinding: ExpandablePanel with LabelWithIconAndTooltip title + ArrayContainer items
function RepeatPreview() {
    const [items, setItems] = useState(["react", "typescript", "node"]);
    const title = (
        <>
            <div className="h-8 flex grow text-text-secondary dark:text-text-secondary-dark items-center">
                <LabelWithIcon icon={<RepeatIcon size={iconSize.small}/>} title="Tags"/>
            </div>
            <Typography variant="caption" className="px-4">({items.length})</Typography>
        </>
    );
    return (
        <ExpandablePanel initiallyExpanded={true}
            innerClassName="px-2 md:px-4 pb-2 md:pb-4 pt-1 md:pt-2"
            title={title}>
            <div className="space-y-1">
                {items.map((item, i) => (
                    <ArrayItemRow key={i}>
                        <TextField value={item} onChange={e => {
                            const next = [...items];
                            next[i] = e.target.value;
                            setItems(next);
                        }} size="medium"/>
                    </ArrayItemRow>
                ))}
                <div className="my-4 justify-center text-left">
                    <Button variant="text" size="medium" startIcon={<PlusIcon/>}>
                        Add to Tags
                    </Button>
                </div>
            </div>
        </ExpandablePanel>
    );
}

// StorageUploadFieldBinding for array: ExpandablePanel + dropzone inside
function MultiFileUploadPreview() {
    const title = (
        <div className="h-8 flex grow text-text-secondary dark:text-text-secondary-dark items-center">
            <LabelWithIcon icon={<UploadIcon size={iconSize.small}/>} title="Images"/>
        </div>
    );
    return (
        <ExpandablePanel initiallyExpanded={true}
            innerClassName="px-2 md:px-4 pb-2 md:pb-4 pt-1 md:pt-2"
            title={title}>
            <div className={cls(
                fieldBackgroundMixin,
                fieldBackgroundHoverMixin,
                "box-border relative pt-[2px] items-center border border-transparent min-h-[180px] outline-none rounded-md duration-200 flex"
            )}>
                <div className="flex items-center p-1 px-4 min-h-[180px]"/>
                <div className="flex-grow min-h-[38px] box-border m-2 text-center">
                    <Typography align="center" variant="label">
                        Drag and drop files here or click
                    </Typography>
                </div>
            </div>
        </ExpandablePanel>
    );
}

// BlockFieldBinding: ExpandablePanel + ArrayContainer with BlockEntry (Select type + field)
function BlockPreview() {
    const title = (
        <div className="text-text-secondary dark:text-text-secondary-dark flex items-center">
            <LabelWithIcon icon={<Rows3Icon size={iconSize.small}/>} title="Content"/>
        </div>
    );
    return (
        <ExpandablePanel initiallyExpanded={true}
            innerClassName="px-2 md:px-4 pb-2 md:pb-4 pt-1 md:pt-2"
            title={title}>
            <div className="flex flex-col gap-3">
                {/* Block entry 1: text */}
                <ArrayItemRow>
                    <div className={cls(paperMixin, "bg-transparent p-2")}>
                        <Select
                            className="mb-2"
                            size="medium"
                            fullWidth
                            value="text"
                            renderValue={() => <Chip size="small">text</Chip>}
                            onValueChange={() => {}}
                        >
                            <SelectItem value="text"><Chip size="small">text</Chip></SelectItem>
                            <SelectItem value="image"><Chip size="small">image</Chip></SelectItem>
                        </Select>
                        <TextField value="A sample paragraph" onChange={() => {}}
                            label={<LabelWithIcon icon={<AlignLeftIcon size={iconSize.small}/>} title="Text"/>}
                            multiline
                            size="medium"/>
                    </div>
                </ArrayItemRow>
                {/* Block entry 2: image */}
                <ArrayItemRow>
                    <div className={cls(paperMixin, "bg-transparent p-2")}>
                        <Select
                            className="mb-2"
                            size="medium"
                            fullWidth
                            value="image"
                            renderValue={() => <Chip size="small">image</Chip>}
                            onValueChange={() => {}}
                        >
                            <SelectItem value="text"><Chip size="small">text</Chip></SelectItem>
                            <SelectItem value="image"><Chip size="small">image</Chip></SelectItem>
                        </Select>
                        <div className="h-8 text-text-secondary dark:text-text-secondary-dark ml-3.5 flex items-center">
                            <LabelWithIcon icon={<UploadIcon size={iconSize.small}/>} title="Image"/>
                        </div>
                        <div className={cls(
                            fieldBackgroundMixin, fieldBackgroundHoverMixin,
                            "box-border relative items-center border border-transparent min-h-[120px] outline-none rounded-md flex"
                        )}>
                            <div className="flex-grow min-h-[38px] box-border m-2 text-center">
                                <Typography align="center" variant="label">Drag and drop</Typography>
                            </div>
                        </div>
                    </div>
                </ArrayItemRow>
                <div className="my-4 justify-center text-left">
                    <Button variant="text" size="medium" startIcon={<PlusIcon/>}>
                        Add to Content
                    </Button>
                </div>
            </div>
        </ExpandablePanel>
    );
}

// MapFieldBinding: ExpandablePanel with bg-white/bg-surface-900 inner + child fields
function GroupPreview() {
    const [street, setStreet] = useState("123 Main St");
    const [zip, setZip] = useState("10001");
    const title = (
        <div className="text-text-secondary dark:text-text-secondary-dark flex items-center">
            <LabelWithIcon icon={<VoteIcon size={iconSize.small}/>} title="Address"/>
        </div>
    );
    return (
        <ExpandablePanel initiallyExpanded={true}
            innerClassName="px-2 md:px-4 pb-2 md:pb-4 pt-1 md:pt-2 bg-white dark:bg-surface-900"
            title={title}>
            <div className="py-1 flex flex-col space-y-2">
                <TextField value={street} onChange={e => setStreet(e.target.value)}
                    label={<LabelWithIcon icon={<TextIcon size={iconSize.small}/>} title="Street"/>}
                    size="large"/>
                <TextField value={zip} onChange={e => setZip(e.target.value)}
                    label={<LabelWithIcon icon={<TextIcon size={iconSize.small}/>} title="Postal code"/>}
                    size="large"/>
            </div>
        </ExpandablePanel>
    );
}

// KeyValueFieldBinding: ExpandablePanel + rows with key(30%)/value(grow)/type dropdown/delete
function KeyValuePreview() {
    const title = (
        <div className="text-text-secondary dark:text-text-secondary-dark flex items-center">
            <LabelWithIcon icon={<VoteIcon size={iconSize.small}/>} title="Key value"/>
        </div>
    );
    return (
        <ExpandablePanel initiallyExpanded={true}
            innerClassName="px-2 md:px-4 pb-2 md:pb-4 pt-1 md:pt-2"
            title={title}>
            <div className="py-1 flex flex-col gap-1">
                {/* Row 1 */}
                <div className="font-mono flex flex-row gap-1">
                    <div className="w-[300px] max-w-[30%]">
                        <TextField value="color" onChange={() => {}} placeholder="key" size="medium"/>
                    </div>
                    <div className="grow">
                        <TextField value="blue" onChange={() => {}} placeholder="value" size="medium"/>
                    </div>
                    <div className="flex flex-col">
                        <IconButton size="smallest">
                            <ChevronDownIcon size={iconSize.small}/>
                        </IconButton>
                        <IconButton size="smallest" aria-label="delete">
                            <MinusIcon size={iconSize.smallest}/>
                        </IconButton>
                    </div>
                </div>
                {/* Row 2 */}
                <div className="font-mono flex flex-row gap-1">
                    <div className="w-[300px] max-w-[30%]">
                        <TextField value="size" onChange={() => {}} placeholder="key" size="medium"/>
                    </div>
                    <div className="grow">
                        <TextField value="large" onChange={() => {}} placeholder="value" size="medium"/>
                    </div>
                    <div className="flex flex-col">
                        <IconButton size="smallest">
                            <ChevronDownIcon size={iconSize.small}/>
                        </IconButton>
                        <IconButton size="smallest" aria-label="delete">
                            <MinusIcon size={iconSize.smallest}/>
                        </IconButton>
                    </div>
                </div>
                {/* Add button */}
                <Button variant="text" size="small" className="w-full" startIcon={<PlusIcon/>}>
                    Add to Key value
                </Button>
            </div>
        </ExpandablePanel>
    );
}

// ReferenceFieldBinding: LabelWithIconAndTooltip + EntityPreviewContainer card
function ReferencePreview() {
    return (
        <>
            <div className="h-8 text-text-secondary dark:text-text-secondary-dark ml-3.5 flex items-center">
                <LabelWithIcon icon={<LinkIcon size={iconSize.small}/>} title="Related client"/>
            </div>
            {/* EntityPreviewContainer */}
            <div
                className={cls(
                    "bg-white dark:bg-surface-900",
                    "min-h-[44px] w-full items-center",
                    "hover:bg-surface-accent-50 dark:hover:bg-surface-800",
                    "px-2 py-1 flex border rounded-lg cursor-pointer",
                    defaultBorderMixin
                )}
            >
                {/* Icon area */}
                <div className="flex shrink-0 w-8 h-8 ml-1 mr-2 m-2 self-start">
                    <LinkIcon size={20} className="m-auto text-primary"/>
                </div>
                {/* Content */}
                <div className="flex flex-col grow w-full m-1 shrink min-w-0 text-text-primary dark:text-text-primary-dark flex-1 mr-2">
                    <div className="block whitespace-nowrap overflow-hidden truncate">
                        <Typography variant="caption" color="disabled" className="font-mono">
                            clt_9f8a2b3c
                        </Typography>
                    </div>
                    <div className="truncate my-0.5 text-sm font-medium text-text-primary dark:text-text-primary-dark">
                        John Doe
                    </div>
                    <div className="truncate my-0">
                        <Typography variant="caption" color="secondary">john@example.com</Typography>
                    </div>
                </div>
                {/* Arrow icon */}
                <div className="flex-shrink-0">
                    <IconButton color="inherit" size="small" className="self-start">
                        <ArrowRightToLineIcon/>
                    </IconButton>
                </div>
            </div>
        </>
    );
}
