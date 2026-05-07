import {
    DryChartWidgetConfig,
    DryFilterSuggestionConfig, DryScorecardWidgetConfig,
    DryTableWidgetConfig,
    DryWidgetConfig,
    WidgetConfig
} from "./dashboards";
import { ParamFilter } from "./sql";
import { ImageData } from "./image";
import { DataSource, FileDataSource } from "./datasources";

export type ChatMessage = {
    id: string;
    text?: string;
    thoughtText?: string;
    user: "USER" | "SYSTEM" | "FUNCTION_CALL";
    function_call?: FunctionCall;
    date: Date;
    attachedFiles?: FileDataSource[]; // Files uploaded with this message
    negative_feedback?: {
        reason?: FeedbackSlug;
        message?: string;
    };
};

export type FunctionCall =
    PythonFunctionCall
    | SQLFunctionCall
    | GenerateWidgetFunctionCall
    | GenerateFilterFunctionCall
    | DataContextFunctionCall
    | FilterInstructionsFunctionCall
    | PythonInstructionsFunctionCall
    | MapInstructionsFunctionCall
    | AdvancedChartInstructionsFunctionCall;

export type PythonFunctionCall = {
    name: "executePythonScript";
    id: string;
    params: {
        python_code: string;
    };
    response?: PythonFunctionCallResponse;
    thoughtSignature?: string; // Gemini's encrypted reasoning context
}

export type PythonFunctionCallResponse = {
    status: string; // e.g. "success", "error", "invocation_error"
    return_code: number;
    stdout: string;
    stderr: string;
    images: ImageData[];
};

export type DataContextFunctionCall = {
    name: "getDataContexts";
    id: string;
    params: {
        dataSources: DataSource[],
    };
    response?: { completed: boolean };
    thoughtSignature?: string; // Gemini's encrypted reasoning context
}

export type SQLFunctionCall = {
    name: "makeSQLQuery";
    id: string;
    params: {
        sql: string;
        dataSources: DataSource[];
        paramFilters: ParamFilter[],
    };
    response?: SQLFunctionCallResponse;
    thoughtSignature?: string; // Gemini's encrypted reasoning context
}

export type SQLFunctionCallResponse = {
    file_name?: string;
    gcs_path?: string;
};

export type GenerateWidgetFunctionCall = {
    name: "generateWidget";
    id: string;
    params: {
        config: DryChartWidgetConfig | DryTableWidgetConfig | DryScorecardWidgetConfig;
    };
    response?: GenerateWidgetFunctionCallResponse;
    thoughtSignature?: string; // Gemini's encrypted reasoning context
}

export type GenerateWidgetFunctionCallResponse = {
    config: DryChartWidgetConfig | DryTableWidgetConfig | DryScorecardWidgetConfig;
    hydratedConfig: WidgetConfig;
    isLimited?: string | boolean; // if the widget is limited, e.g. by the number of rows
};

export type GenerateFilterFunctionCall = {
    name: "generateFilter";
    id: string;
    params: {
        config: DryFilterSuggestionConfig;
    };
    response?: GenerateFilterFunctionCallResponse;
    thoughtSignature?: string; // Gemini's encrypted reasoning context
}

export type GenerateFilterFunctionCallResponse = {
    config: DryFilterSuggestionConfig;
};

export type FilterInstructionsFunctionCall = {
    name: "getFilterInstructions";
    id: string;
    params: Record<string, never>;
    response?: { instructions?: string };
    thoughtSignature?: string;
}

export type PythonInstructionsFunctionCall = {
    name: "getPythonInstructions";
    id: string;
    params: Record<string, never>;
    response?: { instructions?: string };
    thoughtSignature?: string;
}

export type MapInstructionsFunctionCall = {
    name: "getMapInstructions";
    id: string;
    params: Record<string, never>;
    response?: { instructions?: string };
    thoughtSignature?: string;
}

export type AdvancedChartInstructionsFunctionCall = {
    name: "getAdvancedChartInstructions";
    id: string;
    params: Record<string, never>;
    response?: { instructions?: string };
    thoughtSignature?: string;
}

export type FeedbackSlug = "not_helpful"
    | "not_factually_correct"
    | "chart_is_incorrect"
    | "incorrect_code"
    | "unsafe_or_problematic"
    | "other"
    | null;

export type ChatSessionItem = LoadingItem | DryWidgetConfig | MarkdownTextItem;

export type LoadingItem = {
    type: "loading";
}

export type MarkdownTextItem = {
    type: "text";
    text: string;
}

export type ChatSession = {
    id: string;
    dashboardId: string | null;
    name?: string;
    created_at: Date;
    updated_at: Date;
    projectId?: string;
    dataSources: DataSource[];
    messages: ChatMessage[];
    // is this session for a specific widget?
    widgetId?: string | null,
    initialMessage?: string | null;
};

export type WidgetDeltaUpdate = {
    widgetId: string;
    delta: Partial<DryChartWidgetConfig | DryTableWidgetConfig | DryScorecardWidgetConfig>;
};

export type LLMOutput = {
    items: ChatSessionItem[];
    text: string;
}
