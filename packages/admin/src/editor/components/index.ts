export { EditorBubble } from "./editor-bubble";
export { EditorBubbleItem } from "./editor-bubble-item";
export { SlashCommandMenu } from "./SlashCommandMenu";
export { ImageBubble } from "./image-bubble";
export { TableBubble } from "./table-bubble";

export type JSONContent = {
    type?: string;
    attrs?: Record<string, unknown>;
    content?: JSONContent[];
    marks?: { type: string; attrs?: Record<string, unknown> }[];
    text?: string;
    [key: string]: unknown;
};
