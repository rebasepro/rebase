import React from "react";
import {
    IconButton,
    PencilIcon,
    Trash2Icon,
    PlusIcon,
    SettingsIcon,
    // Gallery — ~40 representative icons from the lucide re-export vocabulary
    // (exact names verified against packages/ui/dist/icons/index.d.ts).
    SearchIcon,
    DownloadIcon,
    UploadIcon,
    CopyIcon,
    SaveIcon,
    XIcon,
    CheckIcon,
    CheckCircleIcon,
    XCircleIcon,
    AlertTriangleIcon,
    InfoIcon,
    HelpCircleIcon,
    ChevronDownIcon,
    ChevronRightIcon,
    ArrowRightIcon,
    ArrowUpDownIcon,
    ExternalLinkIcon,
    MoreVerticalIcon,
    ImageIcon,
    FileIcon,
    FolderIcon,
    DatabaseIcon,
    CodeIcon,
    TerminalIcon,
    PlayIcon,
    PauseIcon,
    RefreshCwIcon,
    MailIcon,
    MessageCircleIcon,
    SendIcon,
    UserIcon,
    UsersIcon,
    LockIcon,
    KeyIcon,
    ShieldIcon,
    CalendarIcon
} from "@rebasepro/ui";

// Ported from UIReferenceView's "IconButton — sizes" section.
export const Sizes = () => (
    <div className="flex flex-wrap gap-3 items-center p-4">
        {([
            { s: "smallest" as const, size: 14 },
            { s: "small" as const, size: 16 },
            { s: "medium" as const, size: 20 },
            { s: "large" as const, size: 24 }
        ]).map(({ s, size }) => (
            <div key={s} className="flex flex-col items-center gap-1">
                <IconButton size={s} aria-label={`${s} edit`}><PencilIcon size={size}/></IconButton>
                <span className="text-xs text-surface-500">{s}</span>
            </div>
        ))}
    </div>
);

export const Variants = () => (
    <div className="flex flex-wrap gap-3 items-center p-4">
        <div className="flex flex-col items-center gap-1">
            <IconButton variant="ghost" aria-label="Settings"><SettingsIcon size={20}/></IconButton>
            <span className="text-xs text-surface-500">ghost</span>
        </div>
        <div className="flex flex-col items-center gap-1">
            <IconButton variant="filled" aria-label="Add"><PlusIcon size={20}/></IconButton>
            <span className="text-xs text-surface-500">filled</span>
        </div>
    </div>
);

export const Shapes = () => (
    <div className="flex flex-wrap gap-3 items-center p-4">
        <div className="flex flex-col items-center gap-1">
            <IconButton shape="circular" variant="filled" aria-label="Circular"><PlusIcon size={20}/></IconButton>
            <span className="text-xs text-surface-500">circular</span>
        </div>
        <div className="flex flex-col items-center gap-1">
            <IconButton shape="square" variant="filled" aria-label="Square"><SettingsIcon size={20}/></IconButton>
            <span className="text-xs text-surface-500">square</span>
        </div>
    </div>
);

export const States = () => (
    <div className="flex flex-wrap gap-3 items-center p-4">
        <div className="flex flex-col items-center gap-1">
            <IconButton disabled aria-label="Delete (disabled)"><Trash2Icon size={20}/></IconButton>
            <span className="text-xs text-surface-500">disabled</span>
        </div>
        <div className="flex flex-col items-center gap-1">
            <IconButton toggled aria-label="Bold (toggled)"><PencilIcon size={20}/></IconButton>
            <span className="text-xs text-surface-500">toggled</span>
        </div>
    </div>
);

// The design system's icon vocabulary — ~40 representative lucide re-exports,
// each shown inside an IconButton and labelled with its exact export name.
const GALLERY_ICONS: { name: string; Icon: React.ComponentType<{ size?: number }> }[] = [
    { name: "PlusIcon", Icon: PlusIcon },
    { name: "Trash2Icon", Icon: Trash2Icon },
    { name: "PencilIcon", Icon: PencilIcon },
    { name: "SearchIcon", Icon: SearchIcon },
    { name: "SettingsIcon", Icon: SettingsIcon },
    { name: "DownloadIcon", Icon: DownloadIcon },
    { name: "UploadIcon", Icon: UploadIcon },
    { name: "CopyIcon", Icon: CopyIcon },
    { name: "SaveIcon", Icon: SaveIcon },
    { name: "XIcon", Icon: XIcon },
    { name: "CheckIcon", Icon: CheckIcon },
    { name: "CheckCircleIcon", Icon: CheckCircleIcon },
    { name: "XCircleIcon", Icon: XCircleIcon },
    { name: "AlertTriangleIcon", Icon: AlertTriangleIcon },
    { name: "InfoIcon", Icon: InfoIcon },
    { name: "HelpCircleIcon", Icon: HelpCircleIcon },
    { name: "ChevronDownIcon", Icon: ChevronDownIcon },
    { name: "ChevronRightIcon", Icon: ChevronRightIcon },
    { name: "ArrowRightIcon", Icon: ArrowRightIcon },
    { name: "ArrowUpDownIcon", Icon: ArrowUpDownIcon },
    { name: "ExternalLinkIcon", Icon: ExternalLinkIcon },
    { name: "MoreVerticalIcon", Icon: MoreVerticalIcon },
    { name: "ImageIcon", Icon: ImageIcon },
    { name: "FileIcon", Icon: FileIcon },
    { name: "FolderIcon", Icon: FolderIcon },
    { name: "DatabaseIcon", Icon: DatabaseIcon },
    { name: "CodeIcon", Icon: CodeIcon },
    { name: "TerminalIcon", Icon: TerminalIcon },
    { name: "PlayIcon", Icon: PlayIcon },
    { name: "PauseIcon", Icon: PauseIcon },
    { name: "RefreshCwIcon", Icon: RefreshCwIcon },
    { name: "MailIcon", Icon: MailIcon },
    { name: "MessageCircleIcon", Icon: MessageCircleIcon },
    { name: "SendIcon", Icon: SendIcon },
    { name: "UserIcon", Icon: UserIcon },
    { name: "UsersIcon", Icon: UsersIcon },
    { name: "LockIcon", Icon: LockIcon },
    { name: "KeyIcon", Icon: KeyIcon },
    { name: "ShieldIcon", Icon: ShieldIcon },
    { name: "CalendarIcon", Icon: CalendarIcon }
];

export const IconGallery = () => (
    <div className="p-4 w-[700px]">
        <div className="text-xs font-mono text-surface-500 mb-3">
            {GALLERY_ICONS.length} icons from @rebasepro/ui (lucide-react re-exports)
        </div>
        <div className="grid grid-cols-7 gap-4">
            {GALLERY_ICONS.map(({ name, Icon }) => (
                <div key={name} className="flex flex-col items-center gap-1">
                    <IconButton size="small" aria-label={name}><Icon size={18}/></IconButton>
                    <span className="text-[10px] font-mono text-surface-500 text-center leading-tight break-all">{name}</span>
                </div>
            ))}
        </div>
    </div>
);
