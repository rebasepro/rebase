import React from "react";
import { Checkbox, Label } from "@rebasepro/ui";
import { ReactNodeViewProps } from "./ReactNodeView";

export const TaskItemComponent: React.FC<ReactNodeViewProps> = ({ node, view, getPos }) => {
    const checked = node.attrs.checked;

    const handleCheckedChange = (isChecked: boolean) => {
        const pos = getPos();
        if (typeof pos !== "number") return;

        view.dispatch(
            view.state.tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                checked: isChecked
            })
        );
    };

    return (
        <Label contentEditable={false} className="flex items-start select-none px-1 cursor-pointer">
            <Checkbox
                checked={checked}
                onCheckedChange={handleCheckedChange}
                padding={false}
                size="small"
            />
        </Label>
    );
};
