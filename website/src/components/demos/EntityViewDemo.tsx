import React, { useState, useCallback, useEffect } from "react";

import { imgDims } from "../../utils/imageDimensions";
// ─── Types ───────────────────────────────────────────────
interface Entity {
  id: string;
  title: string;
  image: string | null;
  status: "Available" | "Out of Stock" | "Discontinued";
  brand: string | null;
  category: string;
}

// ─── Mock Data ───────────────────────────────────────────
const MOCK_ENTITIES: Entity[] = [
  {
    "id": "PROD-1",
    "title": "Baseball Cap",
    "image": "/img/demo/products/baseball-cap.jpg",
    "status": "Available",
    "brand": "Authentic Pigment",
    "category": "clothing_man"
  },
  {
    "id": "PROD-2",
    "title": "Conceal invisible shelf",
    "image": "/img/demo/products/invisible-shelf.jpg",
    "status": "Available",
    "brand": "Umbra",
    "category": "home_storage"
  },
  {
    "id": "PROD-3",
    "title": "Aviator RB 3025",
    "image": "/img/demo/products/aviator-rb3025.jpg",
    "status": "Available",
    "brand": "Ray-Ban",
    "category": "sunglasses"
  },
  {
    "id": "PROD-4",
    "title": "Wine decanter",
    "image": "/img/demo/products/wine-decanter.jpg",
    "status": "Out of Stock",
    "brand": "Sagaform",
    "category": "serveware"
  },
  {
    "id": "PROD-5",
    "title": "Wobble Chess Set Walnut",
    "image": "/img/demo/products/chess-set.jpg",
    "status": "Available",
    "brand": "Umbra",
    "category": "toys_and_games"
  },
  {
    "id": "PROD-6",
    "title": "Pimentero",
    "image": "/img/demo/products/pimentero.jpg",
    "status": "Available",
    "brand": "Seletti",
    "category": "serveware"
  },
  {
    "id": "PROD-7",
    "title": "AAM32 1 Corkscrew",
    "image": "/img/demo/products/corkscrew.jpg",
    "status": "Available",
    "brand": "Alessi",
    "category": "kitchen"
  },
  {
    "id": "PROD-8",
    "title": " PREDATOR 2 ",
    "image": "/img/demo/products/predator-2.jpg",
    "status": "Available",
    "brand": "Ray-Ban",
    "category": "sunglasses"
  },
  {
    "id": "PROD-9",
    "title": "Casio Collection",
    "image": "/img/demo/products/casio-collection.jpg",
    "status": "Available",
    "brand": "Casio",
    "category": "watches"
  }
];

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  // CHIP_COLORS[hue + "Light"] in DARK mode — see packages/ui/src/util/chip_colors.ts.
  // These used to hold the light-mode stops (#93e088 / #ffa981 / #cccccc), which
  // is the same palette read off the wrong side of the theme.
  Available: { bg: "#20c933", text: "#0b1d05" },
  "Out of Stock": { bg: "#ff6f2c", text: "#581f10" },
  Discontinued: { bg: "#666666", text: "#eeeeee" },
};

// ─── Kanban Data (for TAGS collection) ───────────────────
// Matches production EntityBoardCard: thumbnail + title + ID
interface KanbanCard {
  id: string;
  title: string;
  image?: string | null;
}

interface KanbanColumn {
  id: string;
  title: string;
  color: string;
  cards: KanbanCard[];
}

const KANBAN_COLUMNS: KanbanColumn[] = [
  {
    id: "backlog",
    title: "Backlog",
    color: "rgb(156, 163, 175)",
    cards: [
      { id: "871492", title: "Dark mode", image: "/img/kanban/dark_mode.png" },
      { id: "871388", title: "Search indexing", image: "/img/kanban/search_indexing.png" },
      { id: "871204", title: "API documentation", image: "/img/kanban/api_docs.png" }
    ]
  },
  {
    id: "in_progress",
    title: "In Progress",
    color: "rgb(251, 191, 36)",
    cards: [
      { id: "871090", title: "Auth middleware refactor", image: "/img/kanban/auth.png" },
      { id: "870984", title: "Onboarding flow", image: "/img/kanban/onboarding.png" }
    ]
  },
  {
    id: "review",
    title: "Review",
    color: "rgb(96, 165, 250)",
    cards: [
      { id: "870812", title: "RLS policies", image: "/img/kanban/rls.png" }
    ]
  },
  {
    id: "done",
    title: "Done",
    color: "rgb(74, 222, 128)",
    cards: [
      { id: "870650", title: "CI/CD pipeline", image: "/img/kanban/cicd.png" },
      { id: "870511", title: "Export to CSV", image: "/img/kanban/export.png" }
    ]
  }
];

import {
  Filter, Pencil, MoreVertical, Image as ImageIcon, User, ChevronDown,
  Tag, Home, Languages, Moon, ChevronsRight, List, Kanban, Folder,
  Search, Settings, Trash2, Plus, X, Maximize2, Code, Check, Copy,
  LayoutGrid, TextCursorInput, Link, LayoutList
} from "lucide-react";

/* ─── Material icon helper ─── */
function MI({
  children,
  size = 20,
  className = "",
  filled = true
}: {
  children: string;
  size?: number;
  className?: string;
  filled?: boolean;
}) {
  const IconComponent: Record<string, React.ComponentType<{ size?: number }>> = {
    "filter_list": Filter,
    "edit": Pencil,
    "more_vert": MoreVertical,
    "image": ImageIcon,
    "person": User,
    "keyboard_arrow_down": ChevronDown,
    "tag": Tag,
    "home": Home,
    "translate": Languages,
    "dark_mode": Moon,
    "expand_more": ChevronDown,
    "keyboard_double_arrow_right": ChevronsRight,
    "list": List,
    "format_list_bulleted": LayoutList,
    "view_kanban": Kanban,
    "folder": Folder,
    "sell": Tag,
    "search": Search,
    "settings": Settings,
    "delete": Trash2,
    "add": Plus,
    "close": X,
    "open_in_full": Maximize2,
    "code": Code,
    "check": Check,
    "content_copy": Copy,
    "apps": LayoutGrid,
    "short_text": TextCursorInput,
    "add_link": Link
  };

  const Comp = IconComponent[children] || Folder;

  return (
    <span className={`inline-flex items-center justify-center select-none ${className}`}>
      <Comp size={size}/>
    </span>
  );
}

/* ─── Column Header ─── */
function ColHeader({
  icon,
  label,
  width,
  showFilter = true,
  align = "left"
}: {
  icon?: string;
  label: string;
  width: number;
  showFilter?: boolean;
  align?: "left" | "right" | "center";
}) {
  return (
    <div
      className="flex-shrink-0 h-full"
      style={{ minWidth: width,
maxWidth: width,
width }}
    >
      <div
        className="flex py-0 px-3 h-full text-xs uppercase font-semibold select-none items-center bg-surface-50 dark:bg-surface-900 text-text-secondary dark:text-surface-400 relative"
        style={{ minWidth: width,
maxWidth: width }}
      >
        <div className="overflow-hidden grow">
          <div
            className="flex items-center flex-row gap-1"
            style={{ justifyContent: align }}
          >
            {icon && (
              <MI size={18} className="opacity-60">
                {icon}
              </MI>
            )}
            <div className="truncate mx-0.5">{label}</div>
          </div>
        </div>
        {showFilter && (
          <div className="relative inline-block">
            <button aria-label="Filter column" className="p-1 rounded-full text-surface-400 hover:bg-surface-200/50 dark:hover:bg-surface-800/50">
              <MI size={18}>filter_list</MI>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Entity Row ─── */
function EntityRow({
  entity,
  isHovered,
  isSelected,
  highlightedField,
  onHover,
  onLeave,
  onClick
}: {
  entity: Entity;
  isHovered: boolean;
  isSelected: boolean;
  highlightedField?: string | null;
  onHover: () => void;
  onLeave: () => void;
  onClick: () => void;
}) {
  const statusColor = STATUS_COLORS[entity.status] || STATUS_COLORS.Draft;

  return (
    <div
      className={`flex min-w-full text-sm border-b border-surface-200/20 dark:border-surface-700/30 cursor-pointer transition-colors ${isSelected ? "bg-primary/5" : isHovered ? "bg-surface-100/50 dark:bg-surface-800/20" : ""}`}
      style={{ height: 54 }}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onClick={onClick}
    >
      {/* Row Actions — always visible (production: EntityCollectionRowActions) */}
      <div
        className="flex-shrink-0 h-full sticky left-0 z-10"
        style={{ minWidth: 138,
maxWidth: 138,
width: 138 }}
      >
        <div className="h-full flex items-center justify-center flex-col bg-surface-50/90 dark:bg-surface-900/90">
          <div className="w-34 flex justify-center gap-0.5">
            <button aria-label="Edit" className="p-1 rounded-full text-surface-400 hover:text-surface-600 dark:hover:text-surface-200">
              <MI size={18}>edit</MI>
            </button>
            <button aria-label="More options" className="p-1 rounded-full text-surface-400 hover:text-surface-600 dark:hover:text-surface-200">
              <MI size={20}>more_vert</MI>
            </button>
            <div className="p-1">
              <div className="border-2 w-4 h-4 rounded flex items-center justify-center bg-white dark:bg-surface-900 border-surface-400 dark:border-surface-500"/>
            </div>
          </div>
          <div className="w-[138px] overflow-hidden truncate font-mono text-xs text-text-secondary dark:text-text-secondary-dark px-2 text-center">
            {entity.id}
          </div>
        </div>
      </div>

      {/* Title */}
      <div
        className="flex-shrink-0 flex items-center px-2"
        style={{ minWidth: 280,
maxWidth: 280,
width: 280 }}
      >
        <div className="truncate text-sm text-surface-900 dark:text-white">
          {entity.title}
        </div>
      </div>

      {/* Image */}
      <div
        className="flex-shrink-0 flex items-center justify-center px-2"
        style={{ minWidth: 120,
maxWidth: 120,
width: 120 }}
      >
        {entity.image ? (
          <img
            src={entity.image} {...imgDims(entity.image)}
            alt=""
            className="w-[90px] h-[40px] object-cover rounded-md"
            loading="lazy"
          />
        ) : (
          <div className="w-[90px] h-[40px] rounded-md bg-surface-accent-200/50 dark:bg-white/[0.055] flex items-center justify-center">
            <MI size={18} className="text-surface-400">image</MI>
          </div>
        )}
      </div>

      {/* Status */}
      <div
        className={`flex-shrink-0 flex items-center px-2 transition-all duration-300 ${highlightedField === "status" ? "ring-2 ring-green-500 rounded-md" : ""}`}
        style={{ minWidth: 140,
maxWidth: 140,
width: 140 }}
      >
        <span
          className="chip whitespace-nowrap"
          style={{
            backgroundColor: statusColor.bg,
            color: statusColor.text
          }}
        >
          {entity.status}
        </span>
      </div>

      {/* Brand */}
      <div
        className="flex-shrink-0 flex items-center px-2"
        style={{ minWidth: 200,
maxWidth: 200,
width: 200 }}
      >
        {entity.brand ? (
          <div className="min-h-[38px] py-1 px-2 w-full rounded-md text-sm flex items-center bg-surface-200/20 dark:bg-surface-800/30">
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-primary">
                <MI size={20}>sell</MI>
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-surface-900 dark:text-white">
                  {entity.brand}
                </div>
              </div>
            </div>
            <MI size={16} className="text-surface-400 flex-shrink-0">
              keyboard_arrow_down
            </MI>
          </div>
        ) : (
          <div className="min-h-[38px] py-1 px-2 w-full rounded-md text-sm flex items-center bg-surface-200/20 dark:bg-surface-800/30 justify-between">
            <span className="text-surface-400">—</span>
            <MI size={16} className="text-surface-400">
              keyboard_arrow_down
            </MI>
          </div>
        )}
      </div>

      {/* Category */}
      <div
        className="flex-shrink-0 flex items-center px-2 overflow-hidden"
        style={{ minWidth: 240,
maxWidth: 240,
width: 240 }}
      >
        <div className="min-h-[38px] py-1 px-2 w-full rounded-md text-sm flex items-center bg-surface-200/20 dark:bg-surface-800/30">
          <div className="flex flex-wrap items-center gap-1 flex-1 min-w-0 overflow-hidden max-h-[38px]">
            <span
              className="chip chip-gray whitespace-nowrap"
            >
              <MI size={12} className="text-primary opacity-70">
                folder
              </MI>
              {entity.category}
            </span>
          </div>
          <MI size={16} className="text-surface-400 flex-shrink-0">
            keyboard_arrow_down
          </MI>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   Exact Scaffold.tsx + DefaultDrawer.tsx layout from production
   ═══════════════════════════════════════════════════════════ */
export type DemoViewMode = "list" | "table" | "cards" | "kanban";

export function EntityViewDemo({ fixedViewMode, height = 600 }: { fixedViewMode?: DemoViewMode; height?: number } = {}) {
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [formDirty, setFormDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, any>>({});
  // Inline table cell overrides (spreadsheet-style editing)
  const [tableOverrides, setTableOverrides] = useState<Record<string, Partial<Entity>>>({});
  // Green border highlight: { entityId, field }
  const [highlightedCell, setHighlightedCell] = useState<{ entityId: string; field: string } | null>(null);
  // Also highlight form fields
  const [highlightedFormField, setHighlightedFormField] = useState<string | null>(null);
  // Active collection (for switching between list/kanban)
  const [activeCollection, setActiveCollection] = useState<"posts" | "tags">("posts");
  // Current view mode
  const [viewMode, setViewMode] = useState<DemoViewMode>(fixedViewMode ?? "table");
  // Kanban drag animation state
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0,
y: 0 });
  const [kanbanHighlight, setKanbanHighlight] = useState<string | null>(null);
  // Which column the dragged card is hovering over (for spacer)
  const [dropTargetColumn, setDropTargetColumn] = useState<string | null>(null);
  // Source column of the dragged card (to compute overlay position)
  const [dragSourceColumn, setDragSourceColumn] = useState<string | null>(null);

  const flashCell = useCallback((entityId: string, field: string, durationMs = 1000) => {
    setHighlightedCell({ entityId,
field });
    setTimeout(() => setHighlightedCell(null), durationMs);
  }, []);

  const flashFormField = useCallback((field: string, durationMs = 1000) => {
    setHighlightedFormField(field);
    setTimeout(() => setHighlightedFormField(null), durationMs);
  }, []);

  const panelOpen = selectedEntityId !== null;
  const selectedEntity = MOCK_ENTITIES.find((e) => e.id === selectedEntityId);

  const openEntity = useCallback((id: string) => {
    const entity = MOCK_ENTITIES.find((e) => e.id === id);
    if (entity) {
      setSelectedEntityId(id);
      setFormValues({
        title: entity.title,
        image: entity.image,
        status: entity.status,
        brand: entity.brand,
        category: entity.category
      });
      setFormDirty(false);
    }
  }, []);

  const closePanel = useCallback(() => {
    setSelectedEntityId(null);
    setFormDirty(false);
  }, []);

  // Animation loop — never static for more than ~800ms
  useEffect(() => {
    let isMounted = true;
    let timer: any = null;
    const wait = (ms: number) =>
      new Promise<void>((r) => {
        timer = setTimeout(r, ms);
      });
    const guard = () => isMounted;

    const animateKanbanDrag = async (targetX: number, targetY: number, steps = 30) => {
      for (let i = 0; i <= steps; i++) {
        const progress = i / steps;
        const ease = 1 - Math.pow(1 - progress, 3);
        const x = ease * targetX;
        const y = ease * targetY + Math.sin(progress * Math.PI) * -8;
        setDragOffset({ x, y });
        await new Promise(r => { timer = setTimeout(r, 16); });
        if (!isMounted) return;
      }
    };

    // ── TABLE / SPREADSHEET focused loop ──
    const loopTable = async () => {
      while (isMounted) {
        setActiveCollection("posts");
        setHoveredRow("PROD-1");
        await wait(350); if (!guard()) return;
        setHoveredRow("PROD-2");
        await wait(300); if (!guard()) return;
        setHoveredRow("PROD-4");
        await wait(300); if (!guard()) return;

        setTableOverrides((prev) => ({ ...prev, "PROD-4": { status: "Available" } }));
        flashCell("PROD-4", "status");
        await wait(700); if (!guard()) return;

        setHoveredRow("PROD-5");
        await wait(300); if (!guard()) return;
        setHoveredRow("PROD-2");
        await wait(300); if (!guard()) return;

        openEntity("PROD-2");
        setHoveredRow(null);
        await wait(700); if (!guard()) return;

        setFormValues((prev) => ({ ...prev, status: "Out of Stock" }));
        setFormDirty(true);
        flashFormField("status");
        await wait(500); if (!guard()) return;

        setIsSaving(true);
        await wait(450); if (!guard()) return;
        setIsSaving(false);
        setFormDirty(false);
        await wait(350); if (!guard()) return;

        closePanel();
        await wait(400); if (!guard()) return;

        // Reset
        setHoveredRow(null);
        setTableOverrides({});
        await wait(500); if (!guard()) return;
      }
    };

    // ── KANBAN focused loop ──
    const loopKanban = async () => {
      while (isMounted) {
        setActiveCollection("posts");

        setKanbanHighlight("871090");
        await wait(500); if (!guard()) return;
        setKanbanHighlight("870984");
        await wait(400); if (!guard()) return;
        setKanbanHighlight(null);
        await wait(300); if (!guard()) return;

        setDragSourceColumn("in_progress");
        setDraggedCardId("870984");
        setDragOffset({ x: 0, y: 0 });
        await wait(200); if (!guard()) return;
        setDropTargetColumn("review");
        await animateKanbanDrag(260, -60);
        if (!guard()) return;
        await wait(300); if (!guard()) return;
        setDraggedCardId(null);
        setDragOffset({ x: 0, y: 0 });
        setDropTargetColumn(null);
        setDragSourceColumn(null);
        await wait(600); if (!guard()) return;

        setKanbanHighlight("871492");
        await wait(500); if (!guard()) return;
        setKanbanHighlight("871388");
        await wait(400); if (!guard()) return;
        setKanbanHighlight(null);
        await wait(300); if (!guard()) return;

        setDragSourceColumn("backlog");
        setDraggedCardId("871388");
        setDragOffset({ x: 0, y: 0 });
        await wait(200); if (!guard()) return;
        setDropTargetColumn("in_progress");
        await animateKanbanDrag(240, -30);
        if (!guard()) return;
        await wait(300); if (!guard()) return;
        setDraggedCardId(null);
        setDragOffset({ x: 0, y: 0 });
        setDropTargetColumn(null);
        setDragSourceColumn(null);
        await wait(800); if (!guard()) return;
      }
    };

    // ── FULL cycle (default — all view modes) ──
    const loopAll = async () => {
      while (isMounted) {
        setActiveCollection("posts");
        setViewMode("table");
        setHoveredRow("PROD-1");
        await wait(350); if (!guard()) return;
        setHoveredRow("PROD-2");
        await wait(300); if (!guard()) return;
        setHoveredRow("PROD-4");
        await wait(300); if (!guard()) return;

        setTableOverrides((prev) => ({ ...prev, "PROD-4": { status: "Available" } }));
        flashCell("PROD-4", "status");
        await wait(700); if (!guard()) return;

        setHoveredRow("PROD-5");
        await wait(300); if (!guard()) return;
        setHoveredRow("PROD-2");
        await wait(300); if (!guard()) return;

        openEntity("PROD-2");
        setHoveredRow(null);
        await wait(700); if (!guard()) return;

        setFormValues((prev) => ({ ...prev, status: "Out of Stock" }));
        setFormDirty(true);
        flashFormField("status");
        await wait(500); if (!guard()) return;

        setIsSaving(true);
        await wait(450); if (!guard()) return;
        setIsSaving(false);
        setFormDirty(false);
        await wait(350); if (!guard()) return;

        closePanel();
        await wait(400); if (!guard()) return;

        setViewMode("cards");
        await wait(600); if (!guard()) return;
        setHoveredRow("PROD-1");
        await wait(400); if (!guard()) return;
        setHoveredRow("PROD-3");
        await wait(400); if (!guard()) return;
        setHoveredRow("PROD-5");
        await wait(400); if (!guard()) return;

        openEntity("PROD-5");
        setHoveredRow(null);
        await wait(600); if (!guard()) return;

        closePanel();
        await wait(400); if (!guard()) return;

        setHoveredRow("PROD-7");
        await wait(300); if (!guard()) return;
        setHoveredRow("PROD-8");
        await wait(300); if (!guard()) return;
        setHoveredRow(null);
        await wait(300); if (!guard()) return;

        setViewMode("list");
        await wait(500); if (!guard()) return;
        setHoveredRow("PROD-1");
        await wait(250); if (!guard()) return;
        setHoveredRow("PROD-2");
        await wait(250); if (!guard()) return;
        setHoveredRow("PROD-4");
        await wait(250); if (!guard()) return;
        setHoveredRow("PROD-5");
        await wait(300); if (!guard()) return;

        openEntity("PROD-5");
        setHoveredRow(null);
        await wait(500); if (!guard()) return;

        closePanel();
        await wait(400); if (!guard()) return;

        setViewMode("kanban");
        setHoveredRow(null);
        setTableOverrides({});
        await wait(800); if (!guard()) return;

        setKanbanHighlight("871090");
        await wait(500); if (!guard()) return;
        setKanbanHighlight("870984");
        await wait(400); if (!guard()) return;
        setKanbanHighlight(null);
        await wait(300); if (!guard()) return;

        setDragSourceColumn("in_progress");
        setDraggedCardId("870984");
        setDragOffset({ x: 0, y: 0 });
        await wait(200); if (!guard()) return;
        setDropTargetColumn("review");
        await animateKanbanDrag(260, -60);
        if (!guard()) return;
        await wait(300); if (!guard()) return;
        setDraggedCardId(null);
        setDragOffset({ x: 0, y: 0 });
        setDropTargetColumn(null);
        setDragSourceColumn(null);
        await wait(600); if (!guard()) return;

        setKanbanHighlight("871492");
        await wait(500); if (!guard()) return;
        setKanbanHighlight("871388");
        await wait(400); if (!guard()) return;
        setKanbanHighlight(null);
        await wait(300); if (!guard()) return;

        setDragSourceColumn("backlog");
        setDraggedCardId("871388");
        setDragOffset({ x: 0, y: 0 });
        await wait(200); if (!guard()) return;
        setDropTargetColumn("in_progress");
        await animateKanbanDrag(240, -30);
        if (!guard()) return;
        await wait(300); if (!guard()) return;
        setDraggedCardId(null);
        setDragOffset({ x: 0, y: 0 });
        setDropTargetColumn(null);
        setDragSourceColumn(null);
        await wait(800); if (!guard()) return;

        setViewMode("table");
        await wait(400); if (!guard()) return;

        setHoveredRow("PROD-1");
        await wait(200); if (!guard()) return;
        setHoveredRow("PROD-2");
        await wait(200); if (!guard()) return;
        setHoveredRow("PROD-4");
        await wait(200); if (!guard()) return;
        setHoveredRow("PROD-1");
        await wait(350); if (!guard()) return;

        setTableOverrides((prev) => ({ ...prev, "PROD-1": { status: "Discontinued" } }));
        flashCell("PROD-1", "status");
        await wait(600); if (!guard()) return;

        openEntity("PROD-1");
        setHoveredRow(null);
        await wait(500); if (!guard()) return;

        setFormValues((prev) => ({ ...prev, status: "Available" }));
        setFormDirty(true);
        flashFormField("status");
        await wait(400); if (!guard()) return;

        setIsSaving(true);
        await wait(450); if (!guard()) return;
        setIsSaving(false);
        setFormDirty(false);
        setTableOverrides((prev) => ({ ...prev, "PROD-1": { status: "Available" } }));
        await wait(350); if (!guard()) return;

        closePanel();
        await wait(400); if (!guard()) return;

        setHoveredRow(null);
        setTableOverrides({});
        await wait(300); if (!guard()) return;
      }
    };

    if (fixedViewMode === "table") loopTable();
    else if (fixedViewMode === "kanban") loopKanban();
    else loopAll();

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [openEntity, closePanel, fixedViewMode]);

  /* ── Drawer nav items (production-identical: DrawerNavigationItem.tsx) ── */
  const NAV_ITEMS = [
    { icon: "folder",
label: "PRODUCTS",
key: "posts" as const,
active: activeCollection === "posts" },
    { icon: "person",
label: "USERS",
key: "authors" as const,
active: false },
    { icon: "sell",
label: "ORDERS",
key: "tags" as const,
active: activeCollection === "tags" }
  ];

  return (
    /* ── Scaffold root: exact Scaffold.tsx line 106 ── */
    <div
      className="flex overflow-hidden bg-surface-50 dark:bg-surface-900 text-surface-900 dark:text-white pointer-events-none select-none relative"
      style={{ height,
width: "100%" }}
    >
      {/* ═══ DrawerWrapper — exact Scaffold.tsx DrawerWrapper (large layout, collapsed) ═══ */}
      {/* z-20 relative, width: 72, inner has no-scrollbar overflow-y-auto border-r */}
      <div
        className="z-20 relative hidden sm:block"
        style={{
          width: 72,
          transition:
            "left 75ms cubic-bezier(0.4, 0, 0.6, 1) 0ms, opacity 75ms cubic-bezier(0.4, 0, 0.6, 1) 0ms, width 75ms cubic-bezier(0.4, 0, 0.6, 1) 0ms"
        }}
      >
        {/* Inner drawer — exact DrawerWrapper innerDrawer, relative mode */}
        <div
          className="h-full no-scrollbar overflow-y-auto overflow-x-hidden relative bg-surface-50 dark:bg-surface-900"
          style={{ width: 72 }}
        >
          <div className="flex flex-col h-full">
            {/* ─ DrawerLogo — exact DefaultDrawer.tsx DrawerLogo, collapsed ─ */}
            <div className="flex flex-row items-center shrink-0 pt-4 pb-0 px-2">
              {/* Logo — always visible, shrink-0 w-[56px] h-[40px] centered */}
              <div className="shrink-0 flex items-center justify-center w-[56px] h-[40px]">
                <img src="/img/rebase_logo.svg" width="306" height="306" alt="Rebase" className="w-[28px] h-[28px] object-contain"/>
              </div>
              {/* Title — hidden when collapsed: opacity-0 w-0 */}
              <div className="flex flex-row items-center overflow-hidden transition-all duration-200 ease-in-out opacity-0 w-0 ml-0"/>
            </div>

            {/* ─ DrawerNavigationGroup — exact DrawerNavigationGroup.tsx ─ */}
            <div className="mt-1 flex-grow overflow-scroll no-scrollbar">
              <div className="my-2 mx-2 flex flex-col">
                {/* Group header hidden when collapsed (opacity-0 invisible pointer-events-none) */}
                <div className="pl-4 pr-2 py-1 flex flex-row items-center opacity-0 invisible pointer-events-none">
                  <MI size={14} className="text-surface-500 dark:text-surface-400 mr-1">expand_more</MI>
                  <span className="text-xs text-surface-500 dark:text-surface-400 font-medium flex-grow line-clamp-1">
                    CONTENT
                  </span>
                </div>

                {/* Collapsible content with nav items — exact DrawerNavigationItem.tsx */}
                <div className="overflow-hidden bg-surface-50 dark:bg-surface-800/30 rounded-lg">
                  {NAV_ITEMS.map((item) => (
                    <div key={item.label}>
                      <div
                        className={`rounded-lg truncate flex flex-row items-center h-10 font-semibold text-xs ${
                          item.active
                            ? "bg-surface-accent-200/60 dark:bg-surface-800 dark:bg-opacity-50"
                            : "hover:bg-surface-accent-300/75 dark:hover:bg-surface-accent-800/75"
                        } text-text-primary dark:text-surface-200`}
                      >
                        {/* Icon wrap — exact DrawerNavigationItem.tsx: shrink-0 w-[56px] h-[40px] */}
                        <div className="shrink-0 flex items-center justify-center w-[56px] h-[40px] text-text-secondary dark:text-text-secondary-dark">
                          <MI size={18} filled>{item.icon}</MI>
                        </div>
                        {/* Label hidden when collapsed */}
                        <div className="text-text-primary dark:text-surface-200 opacity-0 hidden font-inherit truncate space-x-2">
                          {item.label}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ─ DrawerToggle — exact DefaultDrawer.tsx DrawerToggle ─ */}
            <div className="shrink-0 mt-auto px-2 py-2">
              <div className="flex flex-row items-center rounded-lg cursor-pointer hover:bg-surface-accent-100 dark:hover:bg-surface-800 transition-colors duration-150 py-2">
                <div className="shrink-0 flex items-center justify-center w-[56px] h-[24px] text-surface-500 dark:text-surface-400">
                  <MI size={18}>keyboard_double_arrow_right</MI>
                </div>
                {/* Label hidden when collapsed */}
                <div className="overflow-hidden transition-all duration-200 ease-in-out opacity-0 w-0"/>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Main — exact Scaffold.tsx line 131-148 ═══ */}
      <main className="flex flex-col grow overflow-auto">
        {/* Collection container — exact Scaffold.tsx line 137 */}
        <div className="border-surface-200/20 dark:border-surface-700/30 bg-surface-50 dark:bg-surface-900 grow overflow-auto m-0 mt-1 lg:m-0 lg:mx-2 lg:mb-2 lg:rounded-lg lg:border flex flex-col">
          {/* ── Collection Toolbar ── */}
          <div className="min-h-[48px] overflow-x-auto px-2 md:px-4 bg-surface-50 dark:bg-surface-900 border-b border-surface-200/40 dark:border-surface-700/40 flex flex-row justify-between items-center w-full shrink-0">
            {/* Left side */}
            <div className="flex items-center gap-1 mr-4">
              {/* View Mode Toggle — matches production ViewModeToggle */}
              <div className="flex items-center bg-surface-100 dark:bg-surface-800 rounded-md p-0.5 gap-0.5">
                {([
                  { mode: "list" as const, icon: "format_list_bulleted", label: "List" },
                  { mode: "table" as const, icon: "list", label: "Table" },
                  { mode: "cards" as const, icon: "apps", label: "Cards" },
                  { mode: "kanban" as const, icon: "view_kanban", label: "Board" }
                ] as const).map(({ mode, icon, label }) => (
                  <button
                    key={mode}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                      viewMode === mode
                        ? "bg-white dark:bg-surface-900 shadow-sm text-primary"
                        : "text-surface-500 hover:text-surface-700 dark:hover:text-surface-300"
                    }`}
                  >
                    <MI size={14}>{icon}</MI>
                    {viewMode === mode && <span className="text-xs">{label}</span>}
                  </button>
                ))}
              </div>
              <button aria-label="Filter" className="p-1.5 rounded-full text-surface-500 hover:bg-surface-200/50 dark:hover:bg-surface-800">
                <MI size={18}>filter_list</MI>
              </button>
            </div>
            {/* Right side */}
            <div className="flex items-center gap-1">
              {/* Search bar — matches production SearchBar expandable */}
              <div className="flex items-center h-8 rounded-lg bg-surface-accent-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700/60 px-2.5 gap-1.5 min-w-[160px]">
                <MI size={16} className="text-surface-400">search</MI>
                <span className="text-xs text-surface-400 whitespace-nowrap">Search</span>
              </div>
              <button aria-label="Settings" className="p-1.5 rounded-full text-surface-500">
                <MI size={18}>settings</MI>
              </button>
              <button aria-label="Delete" className="p-1.5 rounded-full text-surface-500 opacity-50">
                <MI size={18}>delete</MI>
              </button>
              <button aria-label="Add new entry" className="flex items-center gap-1 min-h-[32px] px-2 rounded-lg border border-primary bg-primary text-white text-sm font-semibold tracking-wide">
                <MI size={18}>add</MI>
              </button>
            </div>
          </div>

          {/* ── Content Area ── */}
          {(viewMode === "table" || viewMode === "list") ? (
            /* ── Table / List view ── */
            <div className="h-full w-full flex flex-col bg-white dark:bg-surface-950 overflow-auto">
              {/* Table header */}
              <div
                className="sticky top-0 z-10 flex min-w-fit border-b border-surface-200/20 dark:border-surface-700/30 bg-surface-50 dark:bg-surface-900"
                style={{ height: 44 }}
              >
                <ColHeader label="" width={138} showFilter={false} align="center"/>
                <ColHeader icon="short_text" label="Title" width={280}/>
                <ColHeader icon="image" label="Image" width={120} showFilter={false} align="center"/>
                <ColHeader icon="list" label="Status" width={140}/>
                <ColHeader icon="sell" label="Brand" width={200}/>
                <ColHeader icon="folder" label="Category" width={240}/>
                <div className="flex items-center justify-center w-16 text-surface-400">
                  <MI size={22}>add</MI>
                </div>
              </div>

              {/* Table body */}
              <div className="flex-1">
                {MOCK_ENTITIES.map((entity) => {
                  const merged = { ...entity,
...tableOverrides[entity.id] } as Entity;
                  return (
                    <EntityRow
                      key={entity.id}
                      entity={merged}
                      isHovered={hoveredRow === entity.id}
                      isSelected={selectedEntityId === entity.id}
                      highlightedField={highlightedCell?.entityId === entity.id ? highlightedCell.field : null}
                      onHover={() => setHoveredRow(entity.id)}
                      onLeave={() => setHoveredRow(null)}
                      onClick={() => openEntity(entity.id)}
                    />
                  );
                })}
              </div>
            </div>
          ) : viewMode === "cards" ? (
            /* ── Cards Grid View ── */
            <div className="h-full w-full overflow-auto bg-white dark:bg-surface-950 p-3 md:p-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {MOCK_ENTITIES.map((entity) => {
                  const merged = { ...entity, ...tableOverrides[entity.id] } as Entity;
                  const statusColor = STATUS_COLORS[merged.status] || STATUS_COLORS.Draft;
                  const isHovered = hoveredRow === entity.id;
                  return (
                    <div
                      key={entity.id}
                      className={`rounded-xl border overflow-hidden cursor-pointer transition-all duration-200 border-surface-200 dark:border-surface-700/60 bg-white dark:bg-surface-900 ${
                        isHovered
                          ? "ring-1 ring-primary/50 shadow-md scale-[1.02]"
                          : "hover:shadow-sm"
                      }`}
                      onMouseEnter={() => setHoveredRow(entity.id)}
                      onMouseLeave={() => setHoveredRow(null)}
                      onClick={() => openEntity(entity.id)}
                    >
                      {/* Card thumbnail */}
                      <div className="w-full h-28 rounded-t-xl bg-surface-accent-200/50 dark:bg-white/[0.055] overflow-hidden">
                        {merged.image ? (
                          <img src={merged.image} {...imgDims(merged.image)} alt={merged.title} className="w-full h-full object-cover" loading="lazy"/>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <MI size={28} className="text-surface-300 dark:text-surface-600">image</MI>
                          </div>
                        )}
                      </div>
                      {/* Card body */}
                      <div className="p-2.5">
                        <div className="line-clamp-2 text-sm font-medium text-surface-900 dark:text-white leading-tight mb-1.5">
                          {merged.title}
                        </div>
                        <div className="flex items-center justify-between">
                          <span
                            className="chip chip-xs"
                            style={{ backgroundColor: statusColor.bg, color: statusColor.text }}
                          >
                            {merged.status}
                          </span>
                          <span className="text-[10px] font-mono text-surface-400">#{entity.id}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* ── Kanban Board — matches production Board.tsx + BoardColumn.tsx + EntityBoardCard.tsx ── */
            <div className="flex-1 overflow-auto no-scrollbar relative">
              <div className="p-2 md:p-3 lg:p-4 h-full min-w-full inline-flex">
                {KANBAN_COLUMNS.map((col) => {
                  const colHasDraggedCard = col.cards.some(c => c.id === draggedCardId);

                  return (
                    <div
                      key={col.id}
                      className="border h-full w-80 min-w-80 mx-2 flex flex-col rounded-md border-surface-200 dark:border-surface-800"
                    >
                      {/* Column header */}
                      <div className="flex items-center justify-between px-2 rounded-t-md bg-surface-50 dark:bg-surface-800">
                        <div className="py-3 px-3 flex-grow select-none flex items-center gap-3 text-sm font-semibold text-surface-800 dark:text-surface-200">
                          <div
                            className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{ backgroundColor: col.color }}
                          />
                          {col.title}
                        </div>
                        <span className="text-xs text-surface-500 dark:text-surface-400 mr-1">
                          {col.cards.length}
                        </span>
                        <button aria-label="Add card" className="p-1 rounded-full opacity-60 hover:opacity-100 text-surface-500 dark:text-surface-400">
                          <MI size={18}>add</MI>
                        </button>
                      </div>

                      {/* Cards list */}
                      <div className="flex-1 overflow-y-auto px-2 pb-2">
                        {col.cards.map((card) => {
                          const isDragged = draggedCardId === card.id;
                          const isHighlighted = kanbanHighlight === card.id;

                          // Don't render the card inline if it's being dragged — it's rendered as an overlay
                          if (isDragged) {
                            return (
                              <div key={card.id} className="py-1">
                                {/* Ghost placeholder */}
                                <div className="h-[56px] rounded-lg border-2 border-dashed border-surface-300/40 dark:border-surface-700/50 bg-surface-100/30 dark:bg-surface-800/10 transition-all duration-200"/>
                              </div>
                            );
                          }

                          return (
                            <div key={card.id} className="py-1">
                              <div
                                className={`p-3 flex items-start border rounded-xl cursor-pointer transition-colors border-surface-200 dark:border-surface-700/60 bg-white dark:bg-surface-900 ${
                                  isHighlighted
                                    ? "ring-2 ring-primary"
                                    : "hover:bg-primary/5 dark:hover:bg-primary/5"
                                }`}
                              >
                                {card.image ? (
                                  <div className="w-10 h-10 rounded-md overflow-hidden shrink-0 mr-2">
                                    <img src={card.image} {...imgDims(card.image)} alt={card.title} className="w-full h-full object-cover" loading="lazy"/>
                                  </div>
                                ) : (
                                  <div className="w-10 h-10 rounded-md bg-surface-100 dark:bg-surface-800 shrink-0 mr-2 flex items-center justify-center">
                                    <MI size={18} className="text-surface-400">sell</MI>
                                  </div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="line-clamp-2 text-sm font-medium text-surface-900 dark:text-white">{card.title}</div>
                                  <div className="text-xs text-surface-500 font-mono truncate">{card.id}</div>
                                </div>
                              </div>
                            </div>
                          );
                        })}

                        {/* Drop target spacer — shows "make room" in target column */}
                        {dropTargetColumn === col.id && !colHasDraggedCard && (
                          <div className="py-1">
                            <div className="h-[56px] rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 dark:bg-primary/10 transition-all duration-300"/>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Drag overlay — rendered outside columns so it can float freely */}
              {draggedCardId && (() => {
                // Find the dragged card data
                let draggedCard: KanbanCard | null = null;
                let sourceColIndex = 0;
                let cardIndexInCol = 0;
                for (let ci = 0; ci < KANBAN_COLUMNS.length; ci++) {
                  const idx = KANBAN_COLUMNS[ci].cards.findIndex(c => c.id === draggedCardId);
                  if (idx !== -1) {
                    draggedCard = KANBAN_COLUMNS[ci].cards[idx];
                    sourceColIndex = ci;
                    cardIndexInCol = idx;
                    break;
                  }
                }
                if (!draggedCard) return null;

                // Calculate approximate position based on column index and card index
                // Column: p-4 (16px) + col index * (w-80=320px + mx-2*2=16px) + px-2 (8px)
                const colLeft = 16 + sourceColIndex * (320 + 16) + 8;
                // Card: header ~48px + card index * (56px card + 8px py-1*2)
                const cardTop = 48 + cardIndexInCol * 64 + 4;

                return (
                  <div
                    className="absolute z-50 w-[304px] pointer-events-none"
                    style={{
                      left: colLeft,
                      top: cardTop,
                      transform: `translate(${dragOffset.x}px, ${dragOffset.y}px) rotate(3deg)`,
                      transition: "none"
                    }}
                  >
                    <div
                      className="p-3 flex items-start border rounded-xl ring-2 ring-primary bg-white dark:bg-surface-900 border-surface-200 dark:border-surface-700/60"
                      style={{
                        boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
                        opacity: 0.95
                      }}
                    >
                      {draggedCard.image ? (
                        <div className="w-10 h-10 rounded-md overflow-hidden shrink-0 mr-2">
                          <img src={draggedCard.image} {...imgDims(draggedCard.image)} alt={draggedCard.title} className="w-full h-full object-cover"/>
                        </div>
                      ) : (
                        <div className="w-10 h-10 rounded-md bg-surface-100 dark:bg-surface-800 shrink-0 mr-2 flex items-center justify-center">
                          <MI size={18} className="text-surface-400">sell</MI>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="line-clamp-2 text-sm font-medium text-surface-900 dark:text-white">{draggedCard.title}</div>
                        <div className="text-xs text-surface-500 font-mono truncate">{draggedCard.id}</div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </main>

      {/* ═══ Side Panel Overlay — always rendered, CSS transition ═══ */}
      <div
        className="absolute inset-0 z-30 transition-opacity duration-200"
        style={{
          backgroundColor: panelOpen ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,0)",
          pointerEvents: panelOpen ? "auto" : "none"
        }}
        onClick={closePanel}
      />
      {/* ═══ Side Panel — always rendered, slides in/out ═══ */}
      <div
        className="absolute top-0 right-0 h-full w-[55%] max-w-[680px] min-w-[340px] z-40 bg-white dark:bg-surface-900 border-l border-surface-200/20 dark:border-surface-700/30 flex flex-col shadow-2xl transition-transform duration-300 ease-out"
        style={{ transform: panelOpen ? "translateX(0)" : "translateX(100%)" }}
      >
        {selectedEntity && (
          <>
            {/* Panel top bar */}
            <div className="h-14 flex items-center px-3 border-b border-surface-200/20 dark:border-surface-700/30 shrink-0 gap-1">
              <button aria-label="Close panel" className="p-1.5 rounded text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800">
                <MI size={18}>close</MI>
              </button>
              <button aria-label="Expand to full screen" className="p-1.5 rounded text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800">
                <MI size={16}>open_in_full</MI>
              </button>
              <div className="flex-1"/>
              <button aria-label="View code" className="px-3 py-2 text-xs text-surface-500">
                <MI size={16}>code</MI>
              </button>
              <button className="px-3 py-2 text-xs text-surface-900 dark:text-white font-medium border-b-2 border-primary">
                Product
              </button>
            </div>

            {/* Panel body */}
            <div className="flex-1 overflow-y-auto">
              <div className="flex flex-col w-full pt-6 pb-16 px-4 sm:px-6">
                {/* Dirty badge */}
                <div className="flex justify-end mb-2" style={{ minHeight: 22 }}>
                  {formDirty ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-semibold border border-amber-500/20" style={{ minWidth: 72 }}>
                      <MI size={12}>edit</MI> Modified
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-100 dark:bg-surface-800 text-surface-500 dark:text-surface-300 text-[10px] font-semibold border border-transparent" style={{ minWidth: 72 }}>
                      <MI size={12}>check</MI> Saved
                    </span>
                  )}
                </div>

                {/* Title */}
                <div className="text-xl font-semibold text-surface-900 dark:text-white leading-tight mb-2">
                  {formValues.title || "Untitled"}
                </div>

                {/* Path */}
                <div className="w-full rounded-md bg-surface-100 dark:bg-surface-950 px-3 py-1.5 mb-6">
                  <code className="text-[11px] text-surface-500">
                    products/{selectedEntityId}
                  </code>
                </div>

                {/* Form fields */}
                <div className="flex flex-col gap-3">
                  {/* Title field */}
                  <div className="field min-h-[48px] flex flex-col justify-center">
                    <span className="field-label text-primary">
                      Title <span className="text-red-500">*</span>
                    </span>
                    <div className="px-3 pt-6 pb-2 text-sm text-surface-900 dark:text-surface-200">
                      {formValues.title}
                    </div>
                  </div>

                  {/* Image field */}
                  <div className="field min-h-[64px] flex flex-col">
                    <span className="field-label">
                      Image
                    </span>
                    <div className="px-3 pt-6 pb-2">
                      {formValues.image ? (
                        <img src={formValues.image} {...imgDims(formValues.image)} alt="" className="w-[100px] h-[100px] object-cover rounded-md"/>
                      ) : (
                        <div className="w-[100px] h-[100px] rounded-md bg-surface-200/40 dark:bg-surface-700/50 flex items-center justify-center">
                          <MI size={24} className="text-surface-400">image</MI>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Status field */}
                  <div className={`field min-h-[48px] flex flex-col justify-center transition-all duration-300 ${highlightedFormField === "status" ? "ring-2 ring-green-500" : ""}`}>
                    <span className="field-label">
                      Status
                    </span>
                    <div className="px-3 pt-6 pb-2 flex items-center justify-between">
                      {formValues.status && (
                        <span
                          className="chip"
                          style={{
                            backgroundColor:
                              STATUS_COLORS[formValues.status]?.bg,
                            color: STATUS_COLORS[formValues.status]?.text
                          }}
                        >
                          {formValues.status}
                        </span>
                      )}
                      <MI size={18} className="text-surface-400">
                        expand_more
                      </MI>
                    </div>
                  </div>

                  {/* Brand field */}
                  <div className="field min-h-[48px] flex flex-col justify-center">
                    <span className="field-label">
                      Brand
                    </span>
                    <div className="px-3 pt-6 pb-2 flex items-center justify-between">
                      {formValues.brand ? (
                        <div className="flex items-center gap-2">
                          <MI size={20} className="text-primary">
                            sell
                          </MI>
                          <div>
                            <div className="text-sm font-medium text-surface-900 dark:text-white">
                              {formValues.brand}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <span className="text-surface-400 text-sm">—</span>
                      )}
                      <MI size={18} className="text-surface-400">
                        expand_more
                      </MI>
                    </div>
                  </div>

                  {/* Category field */}
                  <div className="field min-h-[48px] flex flex-col justify-center">
                    <span className="field-label">
                      Category
                    </span>
                    <div className="px-3 pt-6 pb-2 flex items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-1 flex-1">
                        {formValues.category ? (
                          <span
                            className="chip chip-gray"
                          >
                            <MI
                              size={12}
                              className="text-primary opacity-70"
                            >
                              folder
                            </MI>
                            {formValues.category}
                          </span>
                        ) : (
                          <span className="text-surface-400 text-sm">
                            —
                          </span>
                        )}
                      </div>
                      <MI
                        size={18}
                        className="text-surface-400 flex-shrink-0"
                      >
                        expand_more
                      </MI>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Panel bottom bar */}
            <div className="flex items-center justify-between px-3 py-2.5 border-t border-surface-200/20 dark:border-surface-700/30 bg-white dark:bg-surface-900 shrink-0">
              <div className="flex items-center gap-1">
                <button aria-label="Copy" className="p-1.5 rounded text-surface-500">
                  <MI size={16}>content_copy</MI>
                </button>
                <button aria-label="Delete" className="p-1.5 rounded text-surface-500">
                  <MI size={16}>delete</MI>
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button className="min-h-[40px] px-3 rounded-lg border border-transparent text-primary text-sm font-semibold tracking-wide">
                  Discard
                </button>
                <button
                  disabled={!formDirty || isSaving}
                  className="min-h-[40px] px-3 rounded-lg border border-transparent text-primary text-sm font-semibold tracking-wide disabled:opacity-30"
                >
                  {isSaving ? "Saving..." : "Save"}
                </button>
                <button className="min-h-[40px] px-3 rounded-lg border border-primary bg-primary text-white text-sm font-semibold tracking-wide">
                  Save and close
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
