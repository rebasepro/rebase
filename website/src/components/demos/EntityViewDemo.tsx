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
  price: number;
  featured: boolean;
}

// ─── Mock Data ───────────────────────────────────────────
const MOCK_ENTITIES: Entity[] = [
  {
    "id": "PROD-1",
    "title": "Baseball Cap",
    "image": "/img/demo/products/baseball-cap.jpg",
    "status": "Available",
    "brand": "Authentic Pigment",
    "category": "clothing_man",
    "price": 24.9,
    "featured": false
  },
  {
    "id": "PROD-2",
    "title": "Conceal invisible shelf",
    "image": "/img/demo/products/invisible-shelf.jpg",
    "status": "Available",
    "brand": "Umbra",
    "category": "home_storage",
    "price": 32.5,
    "featured": true
  },
  {
    "id": "PROD-3",
    "title": "Aviator RB 3025",
    "image": "/img/demo/products/aviator-rb3025.jpg",
    "status": "Available",
    "brand": "Ray-Ban",
    "category": "sunglasses",
    "price": 154.0,
    "featured": true
  },
  {
    "id": "PROD-4",
    "title": "Wine decanter",
    "image": "/img/demo/products/wine-decanter.jpg",
    "status": "Out of Stock",
    "brand": "Sagaform",
    "category": "serveware",
    "price": 20.34,
    "featured": false
  },
  {
    "id": "PROD-5",
    "title": "Wobble Chess Set Walnut",
    "image": "/img/demo/products/chess-set.jpg",
    "status": "Available",
    "brand": "Umbra",
    "category": "toys_and_games",
    "price": 89.0,
    "featured": false
  },
  {
    "id": "PROD-6",
    "title": "Pimentero",
    "image": "/img/demo/products/pimentero.jpg",
    "status": "Available",
    "brand": "Seletti",
    "category": "serveware",
    "price": 18.2,
    "featured": false
  },
  {
    "id": "PROD-7",
    "title": "AAM32 1 Corkscrew",
    "image": "/img/demo/products/corkscrew.jpg",
    "status": "Available",
    "brand": "Alessi",
    "category": "kitchen",
    "price": 42.75,
    "featured": true
  },
  {
    "id": "PROD-8",
    "title": " PREDATOR 2 ",
    "image": "/img/demo/products/predator-2.jpg",
    "status": "Available",
    "brand": "Ray-Ban",
    "category": "sunglasses",
    "price": 129.9,
    "featured": false
  },
  {
    "id": "PROD-9",
    "title": "Casio Collection",
    "image": "/img/demo/products/casio-collection.jpg",
    "status": "Available",
    "brand": "Casio",
    "category": "watches",
    "price": 59.9,
    "featured": false
  }
];

/**
 * An enum value is a chip, and a chip is TINTED — the hue's solid stop at 14%
 * behind hue-coloured ink. That has been the product's default variant since
 * 2026-09-08 (`darkTintColor` / `darkTintText` in chip_colors.ts); the solid
 * stops these replaced painted a status as a block of colour rather than a
 * label, and left the site showing a green so loud the product never draws it.
 *
 * The classes come from the `chip-*` utilities in global.css, which are
 * generated from CHIP_COLORS — the one place the palette lives on the site.
 */
const STATUS_CHIP: Record<string, string> = {
  Available: "chip-green",
  "Out of Stock": "chip-orange",
  Discontinued: "chip-gray",
};

/**
 * Enum chips are seeded per value in the product, so no two values in a column
 * share a hue. Fixed here rather than hashed so the same category keeps the
 * same colour between the table, the cards and the side panel.
 */
const CATEGORY_CHIP: Record<string, string> = {
  clothing_man: "chip-pink",
  home_storage: "chip-cyan",
  sunglasses: "chip-blue",
  serveware: "chip-teal",
  toys_and_games: "chip-purple",
  kitchen: "chip-orange",
  watches: "chip-indigo",
};

const statusChip = (status: string) => STATUS_CHIP[status] ?? "chip-gray";
const categoryChip = (category: string) => CATEGORY_CHIP[category] ?? "chip-gray";

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
    // The dot is `CHIP_COLORS[key].darkColor` — the hue's own solid stop
    // (BoardColumnTitle.tsx), not a Tailwind grey that belongs to no palette.
    color: "#666666",
    cards: [
      { id: "871492", title: "Dark mode", image: "/img/kanban/dark_mode.png" },
      { id: "871388", title: "Search indexing", image: "/img/kanban/search_indexing.png" },
      { id: "871204", title: "API documentation", image: "/img/kanban/api_docs.png" },
      // No image: the product falls back to the collection's icon in a raised
      // well, which is what most board cards actually look like.
      { id: "871150", title: "Rate limit headers" },
      { id: "871101", title: "Audit log retention" }
    ]
  },
  {
    id: "in_progress",
    title: "In Progress",
    color: "#fcb400",
    cards: [
      { id: "871090", title: "Auth middleware refactor", image: "/img/kanban/auth.png" },
      { id: "870984", title: "Onboarding flow", image: "/img/kanban/onboarding.png" },
      { id: "870902", title: "Storage quota banner" }
    ]
  },
  {
    id: "review",
    title: "Review",
    color: "#2d7ff9",
    cards: [
      { id: "870812", title: "RLS policies", image: "/img/kanban/rls.png" },
      { id: "870799", title: "Webhook retries" },
      { id: "870744", title: "Seed data CLI" }
    ]
  },
  {
    id: "done",
    title: "Done",
    color: "#20c933",
    cards: [
      { id: "870650", title: "CI/CD pipeline", image: "/img/kanban/cicd.png" },
      { id: "870511", title: "Export to CSV", image: "/img/kanban/export.png" },
      { id: "870402", title: "Locale fallbacks" }
    ]
  }
];

import {
  Filter, Funnel, Pencil, MoreVertical, Image as ImageIcon, User, ChevronDown,
  Tag, Home, Languages, Moon, ChevronsRight, List, Kanban, Folder, Table2,
  Search, Settings, Trash2, Plus, X, Maximize2, Code, Check, Copy,
  LayoutGrid, TextCursorInput, Link, LayoutList, ShoppingCart
} from "lucide-react";

import { AdminDrawer, AdminToolbar, SHELL_ROOT, SHELL_SHEET } from "./admin/AdminChrome";

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

/* ─── Table geometry ───
   `getRowHeight("l")` is 96px — the size that carries thumbnails. The 54px rows
   this replaced were off the product's ladder entirely (36 / 42 / 48 / 96 / 160),
   and letterboxed every product photo into a 90×40 crop the app never draws. */
const ROW_HEIGHT = 96;
/* Sized to land the last column on the sheet's edge at the 1088px the browser
   frame is capped at: the product scrolls a wider table, a screenshot cannot. */
const COL = {
  id: 128,
  title: 210,
  image: 120,
  status: 128,
  brand: 150,
  category: 149,
  price: 100
};

/* ─── Column Header ─── (VirtualTableHeader.tsx: 40px, uppercase, a funnel each) */
function ColHeader({
  label,
  width,
  control = "filter",
  align = "left"
}: {
  label: string;
  width: number;
  control?: "filter" | "search" | "none";
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
        className="flex py-0 px-3 h-full text-xs uppercase font-semibold select-none items-center bg-surface-sheet text-text-secondary dark:text-text-secondary-dark relative z-0"
        style={{ minWidth: width,
maxWidth: width }}
      >
        <div className="overflow-hidden grow">
          <div className="flex items-center flex-row">
            <div
              className="truncate w-full mr-1 overflow-hidden"
              style={{ textAlign: align }}
            >
              {label}
            </div>
          </div>
        </div>
        {control !== "none" && (
          <div className="flex-shrink-0">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full text-surface-accent-500 dark:text-surface-accent-300">
              {control === "search" ? <Search size={20}/> : <Funnel size={14}/>}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Entity Row ─── (VirtualTableRow + EntityTableCell)

   Cells are plain: a table cell is padding, an optional selection border and
   the value. The `bg-surface-field` boxes with a chevron that used to wrap the
   brand and category values were a field editor drawn at rest — the product
   only shows the editing affordances on the cell you have selected. */
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

  const cellSurface = isSelected || isHovered ? "bg-surface-card-hover" : "bg-surface-card";

  const cell = (
    children: React.ReactNode,
    width: number,
    { align = "left", padded = true, saved = false }: {
      align?: "left" | "right" | "center";
      padded?: boolean;
      saved?: boolean;
    } = {}
  ) => (
    <div className="flex-shrink-0" style={{ minWidth: width,
maxWidth: width,
width }}>
      <div
        className={`transition-colors duration-500 flex relative h-full rounded-md ${padded ? "p-4" : "p-0"} border-4 overflow-hidden ${
          saved ? "bg-primary/20 border-primary" : "border-transparent"
        }`}
        style={{
          justifyContent: align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start",
          alignItems: "center",
          width,
          textAlign: align
        }}
      >
        <div className="flex flex-col max-h-full w-full">
          <div style={{ display: "flex",
width: "100%",
justifyContent: align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start" }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div
      className={`group flex min-w-full text-sm border-b border-hairline cursor-pointer ${cellSurface}`}
      style={{ height: ROW_HEIGHT,
width: "fit-content" }}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onClick={onClick}
    >
      {/* Row actions (CollectionRowActions): the id is what the row rests on,
          and the tools cover it only while the row is hovered or selected. */}
      <div className="flex-shrink-0" style={{ minWidth: COL.id,
maxWidth: COL.id,
width: COL.id }}>
        <div className={`h-full flex items-center justify-center flex-col relative ${cellSurface}`}
          style={{ width: COL.id }}>
          <div
            className={`absolute inset-0 flex items-center justify-center gap-0.5 transition-opacity duration-100 ${cellSurface} ${
              isHovered || isSelected ? "opacity-100" : "opacity-0"
            }`}
          >
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full text-surface-accent-500 dark:text-surface-accent-300">
              <Pencil size={16}/>
            </span>
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full text-surface-accent-500 dark:text-surface-accent-300">
              <MoreVertical size={18}/>
            </span>
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full">
              <span className="border-2 w-4 h-4 rounded-sm flex items-center justify-center bg-surface-card border-surface-accent-800 dark:border-surface-accent-500"/>
            </span>
          </div>
          <div className="w-[138px] overflow-hidden truncate font-mono text-xs text-text-secondary dark:text-text-secondary-dark max-w-full text-ellipsis px-2 flex items-center justify-center gap-1">
            <span className="min-w-0 truncate text-center">{entity.id}</span>
          </div>
        </div>
      </div>

      {cell(<span className="truncate">{entity.title}</span>, COL.title)}

      {cell(
        <div className="relative p-2 max-w-full">
          <div className="relative flex items-center justify-center" style={{ width: 100,
height: 100 }}>
            {entity.image
              ? <img src={entity.image} {...imgDims(entity.image)} alt="" loading="lazy"
                className="rounded-md" style={{ maxWidth: "100%",
maxHeight: "100%" }}/>
              : <div className="w-full h-full rounded-md bg-surface-field flex items-center justify-center">
                <ImageIcon size={18} className="text-text-disabled dark:text-text-disabled-dark"/>
              </div>}
          </div>
        </div>,
        COL.image,
        { padded: false }
      )}

      {cell(
        <span className={`chip ${statusChip(entity.status)}`}>{entity.status}</span>,
        COL.status,
        { saved: highlightedField === "status" }
      )}

      {/* A relation, at a row size that carries small previews: one line of
          text with the glyph that marks it as pointing elsewhere. */}
      {cell(
        entity.brand
          ? <span className="inline-flex items-center gap-1 min-w-0 max-w-full align-middle">
            <Link size={12} className="shrink-0 opacity-40"/>
            <span className="truncate">{entity.brand}</span>
          </span>
          : <span className="text-text-disabled dark:text-text-disabled-dark">—</span>,
        COL.brand
      )}

      {cell(
        <div className="flex flex-wrap gap-1.5">
          <span className={`chip ${categoryChip(entity.category)}`}>{entity.category}</span>
        </div>,
        COL.category
      )}

      {/* A number is right-aligned and monospaced, so the decimal points line
          up down the column — the product's own number preview. */}
      {cell(
        <span className="font-mono tabular-nums">{entity.price.toFixed(2)}</span>,
        COL.price,
        { align: "right" }
      )}
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
        category: entity.category,
        price: entity.price,
        featured: entity.featured
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
    { icon: Folder,
label: "Products",
active: activeCollection === "posts" },
    { icon: User,
label: "Users",
active: false },
    { icon: ShoppingCart,
label: "Orders",
active: activeCollection === "tags" }
  ];

  return (
    /* ── Scaffold root (Scaffold.tsx): the frame is the ground; the sheet below
       is one step up from it, inset and hairlined. ── */
    <div
      className={SHELL_ROOT}
      style={{ height,
width: "100%" }}
    >
      <AdminDrawer items={NAV_ITEMS}/>

      {/* ═══ Main — exact Scaffold.tsx line 131-148 ═══ */}
      <main className="flex flex-col grow overflow-auto">
        {/* Collection container — exact Scaffold.tsx line 137 */}
        <div className={SHELL_SHEET}>
          {/* ── Collection Toolbar (CollectionViewStartActions + ViewModeToggle +
              CollectionViewActions): a labelled view trigger, filter and sort,
              the collection's saved filters, then search and the row of quiet
              end actions. The four-icon segmented rail and the blue slab that
              used to sit here are both controls the product retired. ── */}
          <AdminToolbar
            viewIcon={viewMode === "kanban" ? Kanban : viewMode === "cards" ? LayoutGrid : viewMode === "list" ? LayoutList : Table2}
            viewLabel={viewMode === "kanban" ? "Board" : viewMode === "cards" ? "Cards" : viewMode === "list" ? "List" : "Table"}
            presets={viewMode === "kanban"
              ? ["My tasks", "Due this week"]
              : ["Available", "Low stock (< 10)", "New arrivals"]}
            addLabel={viewMode === "kanban" ? "Add Task" : "Add Product"}
            count={viewMode === "kanban" ? "11" : "9"}
          />

          {/* ── Content Area ── */}
          {(viewMode === "table" || viewMode === "list") ? (
            /* ── Table / List view ── */
            <div className="h-full w-full flex flex-col bg-surface-card overflow-auto">
              {/* Table header — 40px, and no per-column glyph: the product
                  draws the property name and its filter, nothing else. */}
              <div
                className="sticky top-0 z-20 flex min-w-fit border-b border-hairline bg-surface-sheet"
                style={{ height: 40 }}
              >
                <ColHeader label="ID" width={COL.id} control="search" align="center"/>
                <ColHeader label="Title" width={COL.title}/>
                <ColHeader label="Image" width={COL.image}/>
                <ColHeader label="Status" width={COL.status}/>
                <ColHeader label="Brand" width={COL.brand}/>
                <ColHeader label="Category" width={COL.category}/>
                <ColHeader label="Price" width={COL.price} align="right"/>
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
            <div className="h-full w-full overflow-auto bg-surface-sheet p-3 md:p-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {MOCK_ENTITIES.map((entity) => {
                  const merged = { ...entity, ...tableOverrides[entity.id] } as Entity;
                  const isHovered = hoveredRow === entity.id;
                  return (
                    <div
                      key={entity.id}
                      /* Card.tsx `cardMixin`: a card sits ABOVE the sheet, so it
                         takes the card surface — it used to take the sheet's,
                         which in dark mode is darker than the ground it sits on. */
                      className={`rounded-xl border overflow-hidden cursor-pointer transition-all duration-200 border-hairline bg-surface-card ${
                        isHovered
                          ? "ring-2 ring-primary/50 shadow-lg -translate-y-0.5"
                          : "hover:shadow-lg"
                      }`}
                      onMouseEnter={() => setHoveredRow(entity.id)}
                      onMouseLeave={() => setHoveredRow(null)}
                      onClick={() => openEntity(entity.id)}
                    >
                      {/* Card thumbnail */}
                      <div className="w-full aspect-[4/3] bg-surface-raised overflow-hidden relative">
                        {merged.image ? (
                          <img src={merged.image} {...imgDims(merged.image)} alt={merged.title} className="w-full h-full object-cover" loading="lazy"/>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <ImageIcon size={28} className="text-text-disabled dark:text-text-disabled-dark"/>
                          </div>
                        )}
                      </div>
                      {/* Card body */}
                      <div className="p-2.5">
                        <div className="line-clamp-2 text-sm font-medium text-surface-900 dark:text-white leading-tight mb-1.5">
                          {merged.title}
                        </div>
                        <div className="flex items-center justify-between">
                          <span className={`chip chip-xs ${statusChip(merged.status)}`}>
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
                      className="border h-full w-80 min-w-80 mx-2 flex flex-col rounded-md border-hairline"
                    >
                      {/* Column header (BoardColumn.tsx: the field surface) */}
                      <div className="flex items-center justify-between px-2 rounded-t-md bg-surface-field">
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
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full opacity-60 text-surface-accent-500 dark:text-surface-accent-300">
                          <Plus size={18}/>
                        </span>
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
                                <div className="h-[56px] rounded-lg border-2 border-dashed border-hairline bg-surface-field transition-all duration-200"/>
                              </div>
                            );
                          }

                          return (
                            <div key={card.id} className="py-1">
                              <div
                                className={`p-2 flex items-start border rounded-lg cursor-pointer transition-all duration-200 border-hairline bg-surface-card ${
                                  isHighlighted
                                    ? "ring-2 ring-primary"
                                    : "hover:bg-surface-hover"
                                }`}
                              >
                                {card.image ? (
                                  <div className="w-10 h-10 rounded-md overflow-hidden shrink-0 mr-2">
                                    <img src={card.image} {...imgDims(card.image)} alt={card.title} className="w-full h-full object-cover" loading="lazy"/>
                                  </div>
                                ) : (
                                  <div className="w-10 h-10 rounded-md bg-surface-raised shrink-0 mr-2 flex items-center justify-center">
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
                      className="p-2 flex items-start border rounded-lg ring-2 ring-primary bg-surface-raised border-hairline"
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
                        <div className="w-10 h-10 rounded-md bg-surface-raised shrink-0 mr-2 flex items-center justify-center">
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
        className="absolute top-0 right-0 h-full w-[55%] max-w-[680px] min-w-[340px] z-40 bg-surface-card border-l border-hairline flex flex-col shadow-2xl transition-transform duration-300 ease-out"
        style={{ transform: panelOpen ? "translateX(0)" : "translateX(100%)" }}
      >
        {selectedEntity && (
          <>
            {/* Panel top bar */}
            <div className="h-14 flex items-center px-3 border-b border-hairline shrink-0 gap-1">
              <button aria-label="Close panel" className="p-1.5 rounded text-surface-400 hover:bg-surface-hover">
                <MI size={18}>close</MI>
              </button>
              <button aria-label="Expand to full screen" className="p-1.5 rounded text-surface-400 hover:bg-surface-hover">
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
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-raised text-surface-500 dark:text-surface-300 text-[10px] font-semibold border border-transparent" style={{ minWidth: 72 }}>
                      <MI size={12}>check</MI> Saved
                    </span>
                  )}
                </div>

                {/* Title */}
                <div className="text-xl font-semibold text-surface-900 dark:text-white leading-tight mb-2">
                  {formValues.title || "Untitled"}
                </div>

                {/* Path */}
                <div className="w-full rounded-md bg-surface-well px-3 py-1.5 mb-6">
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
                        <div className="w-[100px] h-[100px] rounded-md bg-surface-raised flex items-center justify-center">
                          <MI size={24} className="text-surface-400">image</MI>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Status field */}
                  <div className={`field min-h-[48px] flex flex-col justify-center transition-all duration-300 ${highlightedFormField === "status" ? "ring-2 ring-primary" : ""}`}>
                    <span className="field-label">
                      Status
                    </span>
                    <div className="px-3 pt-6 pb-2 flex items-center justify-between">
                      {formValues.status && (
                        <span className={`chip ${statusChip(formValues.status)}`}>
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
                        <span className="inline-flex items-center gap-1.5 min-w-0 max-w-full">
                          <Link size={13} className="shrink-0 opacity-40"/>
                          <span className="text-sm font-medium text-surface-900 dark:text-white truncate">
                            {formValues.brand}
                          </span>
                        </span>
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
                          <span className={`chip ${categoryChip(formValues.category)}`}>
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

                  {/* Number: mono and tabular, as the product previews it. */}
                  <div className="field min-h-[48px] flex flex-col justify-center">
                    <span className="field-label">
                      Price
                    </span>
                    <div className="px-3 pt-6 pb-2 text-sm font-mono tabular-nums text-surface-900 dark:text-surface-200">
                      {typeof formValues.price === "number" ? formValues.price.toFixed(2) : "—"}
                    </div>
                  </div>

                  {/* BooleanSwitch, `size="medium"` — geometry and both palettes
                      come from the `switch-*` utilities in global.css. */}
                  <div className="field min-h-[48px] flex flex-row items-center justify-between pl-3 pr-3 pt-4 pb-2">
                    <span className="field-label">
                      Featured
                    </span>
                    <span className="text-sm text-surface-900 dark:text-surface-200 pt-2">
                      {formValues.featured ? "Yes" : "No"}
                    </span>
                    <span className={`switch-track mt-2 ${formValues.featured ? "switch-track-on" : ""}`}>
                      <span className={`switch-knob ${formValues.featured ? "switch-knob-on" : ""}`}/>
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Panel bottom bar */}
            <div className="flex items-center justify-between px-3 py-2.5 border-t border-hairline bg-surface-card shrink-0">
              <div className="flex items-center gap-1">
                <button aria-label="Copy" className="p-1.5 rounded text-surface-500">
                  <MI size={16}>content_copy</MI>
                </button>
                <button aria-label="Delete" className="p-1.5 rounded text-surface-500">
                  <MI size={16}>delete</MI>
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button className="min-h-[40px] px-3 rounded-lg border border-transparent text-primary text-sm font-medium">
                  Discard
                </button>
                <button
                  disabled={!formDirty || isSaving}
                  className="min-h-[40px] px-3 rounded-lg border border-transparent text-primary text-sm font-medium disabled:opacity-30"
                >
                  {isSaving ? "Saving..." : "Save"}
                </button>
                <button className="min-h-[40px] px-3 rounded-lg border border-primary bg-primary text-white text-sm font-medium">
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
