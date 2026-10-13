import React, { PropsWithChildren, useContext } from "react";
import type { EditorAIController } from "../editor/types";

const EditorAIControllerContext = React.createContext<EditorAIController | undefined>(undefined);

/**
 * Gives every markdown field below it an AI controller: the rich-text editor's
 * "Autocomplete" slash command, which continues the text from the cursor.
 *
 * A plugin mounts one in its form-scoped provider (`plugin-ai` does, while its
 * service is available and `getConfigForPath` allows the collection). Pass
 * `controller={undefined}` to turn it off below. A field whose
 * `customProps.editorProps.aiController` names one uses that one instead.
 *
 * @group Form fields
 */
export function EditorAIControllerProvider({ controller, children }: PropsWithChildren<{ controller: EditorAIController | undefined }>) {
    return <EditorAIControllerContext.Provider value={controller}>{children}</EditorAIControllerContext.Provider>;
}

/** The controller the nearest {@link EditorAIControllerProvider} gives, if any. */
export function useProvidedEditorAIController(): EditorAIController | undefined {
    return useContext(EditorAIControllerContext);
}
