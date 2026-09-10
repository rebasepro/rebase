import React, { useState, useEffect, useRef, useCallback } from "react";
import { LayoutList, Table2, Columns3 } from "lucide-react";
import { EntityViewDemo } from "./EntityViewDemo";
import { OrdersListDemo } from "./OrdersListDemo";

/* The panel's own view modes, under the panel's own names: `list`, `table`,
   `cards`, `kanban` in ViewModeToggle, labelled List / Table / Cards / Board.
   "Spreadsheet" and "Kanban" were names the product does not use — on the page
   whose claim is that this IS the product, and beside a view button already
   reading "Table". */
const TABS = [
  { id: "list", label: "List", icon: LayoutList },
  { id: "table", label: "Table", icon: Table2 },
  { id: "kanban", label: "Board", icon: Columns3 },
] as const;

const AUTO_ADVANCE_MS = 12_000;

interface AdminDemoCarouselProps {
  height?: number;
  showTabs?: boolean;
  defaultTab?: number;
  autoPlay?: boolean;
  scale?: number;
}

export function AdminDemoCarousel({
  height = 600,
  showTabs = true,
  defaultTab = 0,
  autoPlay = true,
  scale = 1,
}: AdminDemoCarouselProps) {
  const [activeTab, setActiveTab] = useState<number>(defaultTab);
  const [progress, setProgress] = useState(0);
  const startTimeRef = useRef(Date.now());
  const rafRef = useRef<number | null>(null);

  const switchTo = useCallback((index: number) => {
    setActiveTab(index);
    setProgress(0);
    startTimeRef.current = Date.now();
  }, []);

  // Auto-advance with smooth progress bar
  useEffect(() => {
    if (!autoPlay) return;

    startTimeRef.current = Date.now();

    const tick = () => {
      const elapsed = Date.now() - startTimeRef.current;
      const pct = Math.min(elapsed / AUTO_ADVANCE_MS, 1);
      setProgress(pct);

      if (pct >= 1) {
        setActiveTab((prev) => (prev + 1) % TABS.length);
        startTimeRef.current = Date.now();
        setProgress(0);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [activeTab, autoPlay]);

  const handleTabClick = useCallback(
    (index: number) => {
      switchTo(index);
    },
    [switchTo]
  );

  // Content area (height) + tabs row with margin (~56px if visible)
  const tabsHeight = showTabs ? 56 : 0;
  const totalMinHeight = height + tabsHeight;

  const rootStyle: React.CSSProperties = {
    minHeight: totalMinHeight,
    ...(scale !== 1 ? { zoom: scale } : {}),
  };

  return (
    // `items-center`: the tab row is furniture belonging to the frame, not to
    // the reading column, and the frame no longer shares the column's left edge
    // — it bleeds past the shell on both sides. Left-aligned, the tabs hung off
    // a bled edge that agrees with nothing; centred under the frame they read as
    // its own control.
    <div className="not-content flex flex-col items-center" style={rootStyle}>
      {/* The panel's own edge. There used to be a drawn browser above it —
          traffic lights and an `admin.yourdomain.com` pill — which was a second
          frame around a thing that already has one, and a fake one: it told the
          reader nothing the screenshot underneath does not, at the cost of 44px
          and a mac window nobody is looking at. */}
      <div className="w-full rounded-2xl overflow-hidden border border-hairline bg-surface-frame shadow-[0_0_0_1px_rgba(15,23,42,0.55),0_24px_120px_rgba(0,0,0,0.65)]">
        {/* Demo content area */}
        <div className="relative w-full" style={{ height }} inert={true} aria-hidden="true">
          {TABS.map((tab, index) => (
            <div
              key={tab.id}
              className="absolute inset-0 transition-all duration-500 ease-in-out"
              style={{
                opacity: activeTab === index ? 1 : 0,
                transform:
                  activeTab === index
                    ? "translateX(0)"
                    : index < activeTab
                      ? "translateX(-2%)"
                      : "translateX(2%)",
                pointerEvents: activeTab === index ? "auto" : "none",
                zIndex: activeTab === index ? 1 : 0,
              }}
            >
              {index === 0 && <OrdersListDemo height={height} />}
              {index === 1 && <EntityViewDemo fixedViewMode="table" height={height} />}
              {index === 2 && <EntityViewDemo fixedViewMode="kanban" height={height} />}
            </div>
          ))}
        </div>
      </div>

      {/* Tab indicators — below the browser frame */}
      {showTabs && (
        <div className="flex items-center gap-2 mt-5">
          {TABS.map((tab, index) => {
            const isActive = activeTab === index;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabClick(index)}
                className={`relative overflow-hidden flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium transition-all duration-300 cursor-pointer select-none ${
                  isActive
                    ? "bg-surface-raised text-white border border-hairline"
                    : "bg-surface-raised text-surface-500 border border-hairline hover:text-surface-300 hover:border-hairline-strong"
                }`}
              >
                {/* Progress fill for active tab */}
                {isActive && (
                  <div
                    className="absolute inset-0 rounded-full overflow-hidden pointer-events-none"
                    style={{ zIndex: 0 }}
                  >
                    <div
                      className="h-full bg-primary/20"
                      style={{
                        width: `${progress * 100}%`,
                        transition: "none",
                      }}
                    />
                  </div>
                )}
                <Icon size={13} className="relative z-10" />
                <span className="relative z-10">{tab.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
