import { EntityValues } from "@rebasepro/types";
import { EditorAIController } from "@rebasepro/cms";

export type GenerateParams<M extends Record<string, unknown>> = {
    values: EntityValues<M>;
    /** Free-text instruction from the operator, if they gave one. */
    instructions?: string;
    /** Restrict the run to one field. */
    propertyKey?: string;
    propertyInstructions?: string;
};

/**
 * One field the model wants to write, awaiting the operator's decision.
 *
 * Nothing here has touched the form. That is the entire point of the type: the
 * previous design streamed generated text straight into the live fields, which
 * meant a half-written sentence was indistinguishable from a bug, the
 * operator's own words were overwritten by heuristics that tried to guess
 * whether to append or replace, and there was no way back other than retyping.
 */
export type ProposedField = {
    /** Dotted property path, e.g. `seo.title`. */
    key: string;
    /** The property's display name, falling back to its key. */
    label: string;
    /** What is in the form right now — shown so an overwrite is visible. */
    currentValue: unknown;
    /** What the model proposes. Grows while `pending`. */
    proposed: unknown;
    /** Still streaming. */
    pending: boolean;
    /** Whether Apply will write this one. */
    selected: boolean;
};

export type AutofillReview = {
    status: "generating" | "ready" | "failed";
    /** Set when `status` is `failed`. */
    error?: string;
    /** In arrival order, so the list reads as the model works. */
    fields: ProposedField[];
    /** What was asked for, shown back to the operator while they review. */
    instructions?: string;
};

export type DataEnhancementController = {
    /**
     * Whether autofill can actually be used right now.
     *
     * The conjunction of two separate things: the host app allows it for this
     * collection ({@link DataEnhancementPluginProps.getConfigForPath}), *and*
     * the service reported itself available. The second half is what the
     * FireCMS-era plugin lacked — it rendered its button unconditionally
     * against a host that no longer existed, so every click 404'd.
     */
    enabled: boolean;

    /** The run in flight or awaiting review; `null` when there is neither. */
    review: AutofillReview | null;

    /** Start a run. Opens {@link review}; never writes to the form. */
    generate: <M extends Record<string, unknown>>(params: GenerateParams<M>) => Promise<void>;

    /** Include or exclude one field from what Apply will write. */
    toggleField: (key: string) => void;

    /** Select or deselect every field at once. */
    toggleAll: (selected: boolean) => void;

    /**
     * Write the selected fields to the form and close the review.
     *
     * The only path by which this plugin mutates a record, and it runs once per
     * run rather than once per token — so it is a single undo step and a single
     * dirty transition, not hundreds.
     */
    applyReview: () => void;

    /** Close the review, writing nothing. The record is untouched. */
    dismissReview: () => void;

    getSamplePrompts: (entityName: string, input?: string) => Promise<SamplePromptsResult>;

    editorAIController?: EditorAIController;
};

/** What `GET /status` answers. Everything else is gated on `available`. */
export type AiStatus = {
    available: boolean;
    model?: string;
    features?: string[];
};

export type AutofillResult = {
    /** Every field the service completed, keyed by property path. */
    suggestions: Record<string, unknown>;
    usage?: { inputTokens?: number; outputTokens?: number };
};

export type SamplePrompt = {
    prompt: string;
    type: "recent" | "sample";
};

export type SamplePromptsResult = {
    prompts: SamplePrompt[];
};

/**
 * The autofill request body.
 *
 * The property schema travels with every request because the service has no
 * access to the caller's collections — it is a hosted endpoint reachable from
 * any self-hosted admin panel. That is the cost of not putting an LLM
 * dependency in `@rebasepro/server`; had the route lived in the backend it
 * could have read the collection registry and this would be three fields.
 */
export type AutofillRequest = {
    entityName: string;
    entityDescription?: string;
    values: Record<string, unknown>;
    properties: Record<string, InputProperty>;
    propertyKey?: string;
    propertyInstructions?: string;
    instructions?: string;
};

export type InputProperty = {
    name?: string;
    description?: string;
    type: string;
    fieldConfigId: string;
    enum?: string[];
    disabled?: boolean;
    of?: InputProperty;
    oneOf?: {
        properties: Record<string, InputProperty>;
        typeField?: string;
        valueField?: string;
    };
};
