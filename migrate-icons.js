const fs = require('fs');
const path = require('path');

const iconMap = {
    AddIcon: 'Plus',
    DeleteIcon: 'Trash2',
    CloseIcon: 'X',
    SearchIcon: 'Search',
    CheckIcon: 'Check',
    KeyboardArrowDownIcon: 'ChevronDown',
    ArrowBackIcon: 'ArrowLeft',
    RefreshIcon: 'RefreshCw',
    ErrorIcon: 'AlertCircle',
    SettingsIcon: 'Settings',
    MoreVertIcon: 'MoreVertical',
    MailIcon: 'Mail',
    CodeIcon: 'Code',
    ContentCopyIcon: 'Copy',
    ChevronRightIcon: 'ChevronRight',
    WarningIcon: 'AlertTriangle',
    ListIcon: 'List',
    HistoryIcon: 'History',
    FolderIcon: 'Folder',
    DownloadIcon: 'Download',
    ScheduleIcon: 'Calendar',
    PlayArrowIcon: 'Play',
    PersonIcon: 'User',
    FormatListNumberedIcon: 'ListOrdered',
    FormatListBulletedIcon: 'List',
    CloudUploadIcon: 'UploadCloud',
    RemoveIcon: 'Minus',
    LinkIcon: 'Link',
    FormatQuoteIcon: 'Quote',
    EditIcon: 'Pencil',
    DarkModeIcon: 'Moon',
    AddLinkIcon: 'Link',
    ViewKanbanIcon: 'Kanban',
    UploadFileIcon: 'Upload',
    SendIcon: 'Send',
    RepeatIcon: 'Repeat',
    LightModeIcon: 'Sun',
    KeyboardTabIcon: 'ArrowRightToLine',
    KeyIcon: 'Key',
    FilterListIcon: 'Filter',
    BallotIcon: 'Vote',
    ArrowUpwardIcon: 'ArrowUp',
    AccountCircleIcon: 'CircleUser',
    ArticleIcon: 'FileText',
    AppsIcon: 'LayoutGrid',
    ViewColumnIcon: 'Columns',
    MenuIcon: 'Menu',
    ExpandMoreIcon: 'ChevronDown',
    ChevronLeftIcon: 'ChevronLeft',
    CheckCircleIcon: 'CheckCircle',
    InfoIcon: 'Info',
    SaveIcon: 'Save',
    HomeIcon: 'Home',
    LockIcon: 'Lock',
    VisibilityIcon: 'Eye',
    VisibilityOffIcon: 'EyeOff',
    ArrowForwardIcon: 'ArrowRight',
    CancelIcon: 'XCircle',
    LocalOfferIcon: 'Tag',
    PeopleIcon: 'Users',
    ShoppingCartIcon: 'ShoppingCart',
    InventoryIcon: 'Package',
    ConfirmationNumberIcon: 'Ticket',
    ReceiptIcon: 'ReceiptText',
    AutorenewIcon: 'RefreshCcw',
    DescriptionIcon: 'FileText',
    FileDownloadIcon: 'Download',
    KeyboardArrowUpIcon: 'ChevronUp',
    KeyboardArrowRightIcon: 'ChevronRight',
    KeyboardArrowLeftIcon: 'ChevronLeft',
    OpenInNewIcon: 'ExternalLink',
    StarIcon: 'Star',
    StarBorderIcon: 'Star',
    HelpOutlineIcon: 'HelpCircle',
    LanguageIcon: 'Globe',
    DashboardIcon: 'LayoutDashboard',
    MapIcon: 'Map',
    PlaceIcon: 'MapPin',
    LocationOnIcon: 'MapPin',
    AccountBoxIcon: 'UserSquare',
    PhotoIcon: 'Image',
    ImageIcon: 'Image',
    MovieIcon: 'Film',
    VideocamIcon: 'Video',
    MusicNoteIcon: 'Music',
    AttachFileIcon: 'Paperclip',
    InsertLinkIcon: 'Link',
    InsertDriveFileIcon: 'File',
    SecurityIcon: 'Shield',
    ExtensionIcon: 'Puzzle',
    BuildIcon: 'Wrench',
    VpnKeyIcon: 'Key',
    ExitToAppIcon: 'LogOut',
    ArrowDropDownIcon: 'ChevronDown',
    ArrowDropUpIcon: 'ChevronUp',
    RemoveCircleIcon: 'MinusCircle',
    AddCircleIcon: 'PlusCircle',
    RemoveCircleOutlineIcon: 'MinusCircle',
    AddCircleOutlineIcon: 'PlusCircle',
    FavoriteIcon: 'Heart',
    FavoriteBorderIcon: 'Heart',
    ThumbUpIcon: 'ThumbsUp',
    ThumbDownIcon: 'ThumbsDown',
    EventIcon: 'Calendar',
    MoreHorizIcon: 'MoreHorizontal',
    ArrowForwardIosIcon: 'ChevronRight',
    ArrowBackIosIcon: 'ChevronLeft',
    ArrowBackIosNewIcon: 'ChevronLeft',
    ChatIcon: 'MessageCircle',
    QuestionAnswerIcon: 'MessageSquare',
    ClearIcon: 'X',
    CreateIcon: 'Pencil',
    NotificationsIcon: 'Bell',
    AutoAwesomeIcon: 'Wand2',
    NotesIcon: 'Menu',
    NumbersIcon: 'Hash',
    TypeSpecimenIcon: 'Type',
    ImageAspectRatioIcon: 'Image',
    ToggleOnIcon: 'ToggleRight',
    TextFormatIcon: 'Type',
    DataObjectIcon: 'Braces',
    AdsClickIcon: 'MousePointerClick',
    TagIcon: 'Tag',
    SubjectIcon: 'AlignLeft',
    SortIcon: 'ArrowUpDown',
    TextFieldsIcon: 'Type',
    WebIcon: 'Globe'
};

const colorMap = {
    primary: 'text-primary',
    secondary: 'text-secondary',
    disabled: 'text-text-disabled dark:text-text-disabled-dark',
    error: 'text-red-500',
    success: 'text-green-500',
    warning: 'text-yellow-500'
};

const sizeMap = {
    smallest: '14',
    small: '16',
    medium: '20',
    large: '24'
};

function walkDir(dir, callback) {
    fs.readdirSync(dir).forEach(f => {
        const dirPath = path.join(dir, f);
        if (dirPath.includes('node_modules') || dirPath.includes('.git') || dirPath.includes('dist') || dirPath.includes('build')) return;
        const isDirectory = fs.statSync(dirPath).isDirectory();
        isDirectory ? walkDir(dirPath, callback) : callback(dirPath);
    });
}

function processFile(filePath) {
    if (!filePath.endsWith('.tsx') && !filePath.endsWith('.ts')) return;
    let content = fs.readFileSync(filePath, 'utf-8');
    let originalContent = content;
    let modified = false;

    let newContent = content;

    for (const [matIcon, lucIcon] of Object.entries(iconMap)) {
        if (!content.includes(matIcon)) continue;

        // Replace <MatIcon ... > or <MatIcon/>
        const tagRegex = new RegExp(`<${matIcon}([^>]*)>`, 'g');
        newContent = newContent.replace(tagRegex, (match, propsStr) => {
            modified = true;
            if (!propsStr) return `<${lucIcon}>`;
            
            let newProps = propsStr;
            newProps = newProps.replace(/size=(["'])(smallest|small|medium|large)\1/g, (m, q, s) => `size={${sizeMap[s]}}`);
            newProps = newProps.replace(/color=(["'])(primary|secondary|disabled|error|success|warning)\1/g, (m, q, c) => {
                let colorClass = colorMap[c];
                return `className="${colorClass}"`;
            });

            return `<${lucIcon}${newProps}>`;
        });
        
        // Also look for </MatIcon> just in case
        const closingTagRegex = new RegExp(`</${matIcon}>`, 'g');
        newContent = newContent.replace(closingTagRegex, (match) => {
            modified = true;
            return `</${lucIcon}>`;
        });
    }

    if (newContent !== originalContent) {
        fs.writeFileSync(filePath, newContent);
        console.log(`Updated tags in ${filePath}`);
    }
}

walkDir(path.join(__dirname, 'packages'), processFile);
walkDir(path.join(__dirname, 'app'), processFile);
walkDir(path.join(__dirname, 'website'), processFile);
