export * from "./icon_keys";
export * from "./cool_icon_keys";
export * from "./Icon";
export * from "./GitHubIcon";
export * from "./HandleIcon";

export type { LucideProps, LucideIcon } from "lucide-react";
export * from "./LucideIconByName";

/**
 * lucide's full `icons` map, keyed by PascalCase name.
 *
 * Read the cost before reaching for it. The map holds a reference to every
 * icon in the library, so importing it pulls all ~1,750 into whatever chunk
 * you import it from — measured at **822 kB uncompressed**. There is no
 * tree-shaking that helps: the object literal names them all.
 *
 * It used to be reached by this package's own navigation chrome, which put
 * that 822 kB in the entry chunk, modulepreloaded on the login screen, for
 * every visitor of every Rebase admin panel. Those call sites now use
 * {@link LucideIconByName}, so the weight is no longer anybody's by default —
 * it is yours only if you import this binding.
 *
 * Prefer, in order:
 *
 * - {@link LucideIconByName} — renders by name, fetches the set on first use;
 * - {@link iconKeys} — a plain string array, if you only need to know whether
 *   a name exists (costs nothing);
 * - {@link loadLucideIcons} — the same map, `await`ed, so it lands in an async
 *   chunk instead of your entry;
 * - this, when you genuinely need the whole map synchronously at module scope.
 *
 * @see LucideIconByName
 * @see loadLucideIcons
 */
export { icons as lucideIcons } from "lucide-react";

// Re-export individual icon components used across the monorepo.
// Sub-packages import these from @rebasepro/ui instead of declaring a direct
// lucide-react dependency.  When a new icon is needed, add it here.
export {
    AlertCircleIcon,
    AlertTriangleIcon,
    AlignLeftIcon,
    AppWindow,
    ArrowDownIcon,
    ArrowDownToLineIcon,
    ArrowLeftIcon,
    ArrowRightFromLineIcon,
    ArrowRightIcon,
    ArrowRightLeftIcon,
    ArrowRightToLineIcon,
    ArrowUpDownIcon,
    ArrowUpIcon,
    ArrowUpToLineIcon,
    BoldIcon,
    BookOpenIcon,
    CalendarIcon,
    CheckCircle2Icon,
    CheckCircleIcon,
    CheckIcon,
    CheckSquareIcon,
    ChevronDownIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    ChevronUpIcon,
    ChevronsLeftIcon,
    ChevronsRightIcon,
    ChevronsUpDownIcon,
    CircleDotIcon,
    CircleIcon,
    CircleUserIcon,
    CodeIcon,
    ColumnsIcon,
    CopyIcon,
    DatabaseIcon,
    DollarSignIcon,
    DownloadIcon,
    ExternalLinkIcon,
    EyeIcon,
    EyeOffIcon,
    FileIcon,
    FileSearchIcon,
    FileTextIcon,
    FilterIcon,
    FilterXIcon,
    FlagIcon,
    FolderIcon,
    FolderKanbanIcon,
    FolderPlusIcon,
    FolderUpIcon,
    FunctionSquareIcon,
    GitBranchIcon,
    GlobeIcon,
    HashIcon,
    Heading1Icon,
    Heading2Icon,
    Heading3Icon,
    HelpCircleIcon,
    HistoryIcon,
    HomeIcon,
    ImageIcon,
    ImageOffIcon,
    InfoIcon,
    ItalicIcon,
    KanbanIcon,
    KeyIcon,
    KeyRoundIcon,
    LanguagesIcon,
    LayoutGridIcon,
    LinkIcon,
    Link2Icon,
    Unlink2Icon,
    ListIcon,
    LockIcon,
    ListOrderedIcon,
    ListPlusIcon,
    ListTodoIcon,
    LoaderIcon,
    LogOutIcon,
    MailIcon,
    Maximize2Icon,
    MenuIcon,
    MessageCircleIcon,
    MinusCircleIcon,
    MinusIcon,
    MoonIcon,
    MoreVerticalIcon,
    Music2Icon,
    PanelLeftCloseIcon,
    PanelLeftIcon,
    PanelLeftOpenIcon,
    PauseIcon,
    PenLineIcon,
    PencilIcon,
    PhoneIcon,
    PinIcon,
    PlayIcon,
    PlusIcon,
    QuoteIcon,
    RefreshCcwIcon,
    RefreshCwIcon,
    RepeatIcon,
    Rows3Icon,
    SaveIcon,
    SearchIcon,
    SendIcon,
    SettingsIcon,
    ShieldIcon,
    ShoppingCartIcon,
    SlidersHorizontalIcon,
    SquareIcon,
    StarIcon,
    StickyNoteIcon,
    StrikethroughIcon,
    SunIcon,
    SunMoonIcon,
    TableIcon,
    TagIcon,
    TerminalIcon,
    TextIcon,
    Trash2Icon,
    TrendingUpIcon,
    TypeIcon,
    UnderlineIcon,
    UndoIcon,
    UploadCloudIcon,
    UploadIcon,
    UserCheckIcon,
    UserIcon,
    UserPlus,
    UsersIcon,
    VideoIcon,
    VoteIcon,
    Wand2Icon,
    WrenchIcon,
    XCircleIcon,
    XIcon
} from "lucide-react";
