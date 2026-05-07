import { DataRow, FilterType } from "./sql";
import { DatakiUser } from "./users";
import { WidgetDeltaUpdate } from "./chat";
import { DataSource } from "./datasources";

/**
 * Dashboard-level theme definition.
 * Keys map 1:1 to `--dataki-*` CSS custom properties (camelCased).
 * All fields are optional — missing values fall back to system defaults.
 */
export type DashboardTheme = {
    /** Optional name, used when saving to a team theme library */
    name?: string;

    /**
     * Pin the whole app to light or dark mode while this dashboard is active.
     * When undefined the user's system / localStorage preference is respected.
     */
    mode?: "light" | "dark";

    // ── Global ──────────────────────────────────────────
    /** Dashboard background color */
    bg?: string;
    /** Default text color */
    text?: string;
    /** Global font family (any Google Font or system font) */
    fontFamily?: string;
    /** Base font size in px */
    fontSize?: number;

    // ── Widget cards ────────────────────────────────────
    /** Widget card background */
    widgetBg?: string;
    /** Widget card border color */
    widgetBorderColor?: string;
    /** Widget card border width in px */
    widgetBorderWidth?: number;
    /** Widget card border radius in px */
    widgetBorderRadius?: number;
    /** Widget card box-shadow (CSS string) */
    widgetShadow?: string;
    /** Widget inner padding in px */
    widgetPadding?: number;

    // ── Widget titles ───────────────────────────────────
    titleFontFamily?: string;
    titleFontSize?: number;
    titleFontWeight?: number | string;
    titleColor?: string;
    /** Show/hide widget title bar */
    titleVisible?: boolean;

    // ── Charts (Vega / Vega-Lite) ───────────────────────
    /** Ordered color palette for chart data marks */
    chartColorPalette?: string[];
    /** Axis / label text color */
    chartTextColor?: string;
    /** Grid line color */
    chartGridColor?: string;
    /** Chart-specific font override */
    chartFontFamily?: string;
    /** Chart area background */
    chartBg?: string;

    // ── Scorecards ──────────────────────────────────────
    scorecardValueColor?: string;
    scorecardLabelColor?: string;

    // ── Tables ──────────────────────────────────────────
    tableHeaderBg?: string;
    tableHeaderColor?: string;
    tableBorderColor?: string;
    tableStripeColor?: string;
};

export type DashboardUpdateType =
    "text_update"
    | "title_update"
    | "widget_create"
    | "widget_update"
    | "widget_move"
    | "widget_resize"
    | "widget_remove"
    | "widgets_remove"
    | "page_update"
    | "dashboard_delete"
    | "dashboard_create"
    | "dashboard_revert"
    | "filter_add"
    | "filter_update"
    | "filter_remove"
    | "public_update"
    | "permissions_update"
    | "embed_config_update"
    | "theme_update";

export type Permission = {
    uid?: string,
    team_id?: string,
    type: "read" | "write";
};

export type EmbedConfig = {
    enabled: boolean;
    allowedDomains?: string[];
    embedApiKey?: string;
};

export type Dashboard = {
    id: string;
    title?: string;
    description?: string;
    pages: DashboardPage[];
    _users_read?: string[];
    _users_write?: string[];
    _users?: string[];
    owner?: string;
    permissions?: Permission[],
    public?: boolean, // anyone with the link can view this dashboard
    allowedOrigins?: string[], // @deprecated - use embedConfig.allowedDomains
    embedConfig?: EmbedConfig, // embed configuration
    created_at: Date,
    updated_at: Date,
    updated_by?: string;
    deleted?: boolean,
    revision?: string;
    updated_type?: DashboardUpdateType,
    updatedByUser?: DatakiUser,
    /** Dashboard-level theme overrides */
    theme?: DashboardTheme,
}

export type DashboardPage = {
    id: string;
    title?: string;
    paper?: {
        size?: WidgetSize,
        position?: Position
    }
    widgets: DashboardItem[];
    filters: DashboardFilterConfig[];
}

export interface FilterConfig {
    /** The data key which can be used in SQL queries or logic */
    key: string;
    /** User-visible label for the filter */
    label: string;
    /** The type of input widget that should be rendered */
    type: FilterType;
    /** For enum types - the SQL query to fetch the options */
    sqlQuery?: string;
    /** For "enum" type filters - list of options */
    options?: FilterOption[];
    /** Optionally a placeholder text for textfields */
    placeholder?: string;
    /** The default value if applicable */
    defaultValue?: string | number | boolean | Date | (string | number)[];
    /** The data sources that this filter can use */
    dataSources: DataSource[];
}

export interface FilterOption {
    label: string;
    value: string | number | boolean;
}

export type DashboardFilterConfig = FilterConfig & {
    position: Position,
}


export type DashboardItem = DashboardWidgetConfig | TextItem | FilterWidgetItem;

export type TextItem = {
    id: string;
    type: "title" | "subtitle" | "text";
    text: string;
    position: Position,
    size: WidgetSize
}

export type FilterWidgetItem = DryFilterWidgetConfig & {
    id: string;
    size: WidgetSize,
    position: Position
}

export type DashboardWidgetConfig = (DryChartWidgetConfig | DryTableWidgetConfig | DryScorecardWidgetConfig) & {
    id: string;
    size: WidgetSize,
    position: Position
}

// Vega-Lite Configuration Types
export type VegaEncoding = {
    x?: VegaFieldDef;
    y?: VegaFieldDef;
    color?: VegaFieldDef;
    size?: VegaFieldDef;
    opacity?: VegaFieldDef;
    tooltip?: VegaFieldDef | VegaFieldDef[];
    theta?: VegaFieldDef;
    xOffset?: VegaFieldDef;
};

export type VegaFieldDef = {
    field?: string;
    type?: "quantitative" | "temporal" | "ordinal" | "nominal";
    title?: string;
    aggregate?: "sum" | "mean" | "median" | "min" | "max" | "count";
    timeUnit?: string;
    axis?: {
        title?: string;
        format?: string;
        labelAngle?: number;
    };
    scale?: {
        domain?: any[];
        range?: any[];
        scheme?: string;
    };
    legend?: {
        title?: string;
    } | null;
    value?: any; // For fixed values like colors
    sort?: string | string[];
};

export type VegaMark = "bar" | "line" | "point" | "area" | "circle" | "square" | "tick" | "rect" | "arc";

// DryChartConfig supports Vega-Lite, full Vega v5, and legacy Chart.js formats
export type DryChartConfig = {
    $schema?: string;
    projection?: { [key: string]: any };
    layer?: any[];
    // Vega-Lite fields
    mark?: VegaMark | { type: VegaMark;[key: string]: any };
    encoding?: VegaEncoding;
    config?: {
        mark?: any;
        axis?: any;
        legend?: any;
        view?: any;
        background?: string;
    };
    transform?: any[];
    // Full Vega v5 fields
    marks?: any[];
    scales?: any[];
    axes?: any[];
    signals?: any[];
    legends?: any[];
    data?: any[];
};

/**
 * Formatting options for scorecard numbers.
 * Uses Intl.NumberFormat standard.
 */
export interface ScorecardFormat {
    /** * The style of formatting.
     * 'decimal': 1,234.5
     * 'currency': $1,234.50
     * 'percent': 12.5%
     */
    style: "decimal" | "currency" | "percent";

    /** * How to display the number.
     * 'standard': 1,234,567 (default)
     * 'compact': 1.2M
     */
    notation?: "standard" | "compact";

    /** Required if style is 'currency' (e.g., "USD", "EUR") */
    currency?: string;

    /** Number of decimal places to show */
    decimals?: number;

    /** If true, adds a '+' sign for positive numbers (e.g., +12.5%) */
    showSign?: boolean;
}

export type DryWidgetConfig =
    DryChartWidgetConfig
    | DryTableWidgetConfig
    | DryScorecardWidgetConfig
    | DryFilterWidgetConfig
    | DryFilterSuggestionConfig
    | DryDashboardDeltaUpdateConfig;

export type DryFilterSuggestionConfig = {
    id?: string;
    type: "filter_suggestion";
    filter: FilterConfig;
    widgetUpdates: WidgetDeltaUpdate[]
}

export type DryDashboardDeltaUpdateConfig = {
    type: "dashboard_delta_update";
    widgetId: string;
    delta: Partial<DryChartWidgetConfig | DryTableWidgetConfig | DryScorecardWidgetConfig>;
}

export function isDryWidgetConfig(config: object): config is DryWidgetConfig {
    return "type" in config && (config.type === "chart" || config.type === "table" || config.type === "scorecard" || config.type === "filter");
}

export type DryFilterWidgetConfig = {
    id?: string;
    type: "filter";
    key: string;
    label: string;
    filterType: FilterType;
    sqlQuery?: string;
    options?: FilterOption[];
    placeholder?: string;
    defaultValue?: string | number | boolean | Date | (string | number)[];
    dataSources: DataSource[];
    size?: WidgetSize;
}

export type DryChartWidgetConfig = {
    id?: string;
    title: string;
    dataSources: DataSource[];
    description: string;
    sql: string;
    type: "chart";
    chart?: DryChartConfig;
    size?: WidgetSize
}

export type DryTableWidgetConfig = {
    id?: string;
    title: string;
    dataSources: DataSource[];
    description: string;
    sql: string;
    type: "table";
    table?: TableConfig;
    size?: WidgetSize
}

export type DryScorecardWidgetConfig = {
    id?: string;
    title: string;
    dataSources: DataSource[];
    description: string;
    sql: string;
    type: "scorecard";
    scorecard: {
        /** Main value configuration */
        value: {
            /** The column name from the SQL result for the main value (e.g., "current_revenue") */
            field: string;
            /** How to format this number */
            format?: ScorecardFormat;
        };
        /** Comparison value configuration (optional) */
        comparison?: {
            /** * The column name from the SQL result for the comparison value.
             * This value MUST be a number (e.g., the result of `(current - previous) / previous`).
             */
            field: string;
            /** How to format this number (e.g., { style: 'percent', showSign: true }) */
            format?: ScorecardFormat;
            /** * Determines the color (green/red) based on the 'field' value.
             * 'increase_is_good': Positive numbers are green, negative are red.
             * 'decrease_is_good': Positive numbers are red, negative are green (e.g., for bounce rate).
             */
            intent: "increase_is_good" | "decrease_is_good";
        };
        /** Optional Material Icon name (e.g., "shopping_cart", "attach_money") */
        icon?: string;
    };
    size?: WidgetSize
};

export type WidgetConfig = {
    title: string;
    description: string;
    sql: string;
    type: "chart" | "table" | "scorecard";
    chart?: HydratedChartConfig,
    table?: HydratedTableConfig,
    scorecard?: HydratedScorecardConfig
}

export type HydratedTableConfig = {
    data: DataRow[];
    columns: TableColumn[]
};

// Full Vega-Lite specification after hydration with actual data
// Also supports Vega specs (which use marks, scales, signals instead of encoding)
export type HydratedChartConfig = {
    $schema?: string;
    // Vega-Lite properties
    data?: {
        values: DataRow[];
    } | any[];
    mark?: VegaMark | { type: VegaMark;[key: string]: any };
    encoding?: VegaEncoding;
    layer?: any[];
    // Vega properties
    marks?: any[];
    scales?: any[];
    axes?: any[];
    signals?: any[];
    legends?: any[];
    // Common properties
    projection?: { [key: string]: any };
    datasets?: { [name: string]: DataRow[] };
    config?: {
        mark?: any;
        axis?: any;
        legend?: any;
        title?: any;
        view?: any;
        background?: any;
    };
    transform?: any[];
    width?: number;
    height?: number;
    autosize?: string | { type: string; contains?: string; resize?: boolean };
    padding?: any;
    background?: string;
    description?: string;
    title?: any;
};

export type HydratedScorecardConfig = {
    data: DataRow;
};

export type TableConfig = {
    columns: TableColumn[]
};

export type TableColumn = {
    key: string,
    name: string,
    width?: number,
    dataType?: DataType
};

export type DataType = "string" | "number" | "date" | "object" | "array";

export type Position = {
    x: number,
    y: number
};

export type WidgetSize = { width: number, height: number };
