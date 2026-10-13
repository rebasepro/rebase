import { useEffect, useRef, useState } from "react";
import { Button, CheckIcon, cls, focusedDisabled, iconSize, Popover, TextField, Trash2Icon, Typography } from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";
import { useProseMirrorContext } from "../hooks/useProseMirrorContext";
import { getMarkAttributes, isMarkActive, setMark, unsetMark } from "../utils/prosemirror-utils";
import { schema } from "../schema";

export function isValidUrl(url: string) {
    try {
        new URL(url);
        return true;
    } catch (e) {
        return false;
    }
}

export function getUrlFromString(str: string) {
    if (isValidUrl(str)) return str;
    try {
        if (str.includes(".") && !str.includes(" ")) {
            return new URL(`https://${str}`).toString();
        }
        return null;
    } catch (e) {
        return null;
    }
}

interface LinkSelectorProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export const LinkSelector = ({
    open,
    onOpenChange
}: LinkSelectorProps) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const { state, view } = useProseMirrorContext();
    const { t } = useTranslation();

    const [error, setError] = useState<string | null>(null);
    // `TextField` is controlled: a `defaultValue` alone left the box reset to
    // empty on every keystroke, so no link could be typed into it.
    const [value, setValue] = useState("");

    const href = state ? (getMarkAttributes(state, schema.marks.link).href || "") : "";

    // Opening the box shows the selection's link, with no error, and focuses it
    useEffect(() => {
        if (!open) return;
        setError(null);
        setValue(href);
        inputRef.current?.focus();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- seeded once per opening; the selection's link is read at that moment
    }, [open]);

    if (!state || !view) return null;

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        // The popover renders in a portal, but React still sends its events up
        // the component tree: without this the record form around the editor
        // receives the submit and saves.
        e.stopPropagation();
        if (!value) return;
        const url = getUrlFromString(value);
        if (!url) {
            setError(t("editor_invalid_url"));
            return;
        }
        setError(null);
        setMark(schema.marks.link, { href: url })(view.state, view.dispatch);
        view.focus();
        onOpenChange(false);
    };

    const handleRemoveLink = () => {
        unsetMark(schema.marks.link)(view.state, view.dispatch);
        view.focus();
        onOpenChange(false);
    };

    const isActive = isMarkActive(state, schema.marks.link);

    return (
        <Popover modal={true}
            open={open}
            onOpenChange={onOpenChange}
            trigger={<Button variant="text"
                type="button"
                className="gap-2 rounded-none"
                color={"text"}>
                <p className={cls("underline decoration-stone-400 underline-offset-4", {
                    "text-blue-500": isActive
                })}>
                    {t("editor_link")}
                </p>
            </Button>}>
            <form
                onSubmit={handleSubmit}
                className="flex flex-col p-1 gap-1"
            >
                <div className="flex gap-1">
                <TextField
                    inputRef={inputRef}
                    autoFocus={open}
                    aria-label={t("editor_paste_or_type_link")}
                    placeholder={t("editor_paste_or_type_link")}
                    value={value}
                    onChange={(e) => {
                        setValue(e.target.value);
                        if (error) setError(null);
                    }}
                    error={!!error}
                    size="small"
                    className="flex-grow text-surface-900 dark:text-white"
                    inputClassName={cls("bg-transparent p-1 text-sm outline-none", focusedDisabled)}
                />

                {href ? (
                    <Button
                        size={"small"}
                        variant="text"
                        type="button"
                        color={"text"}
                        className="flex items-center"
                        onClick={handleRemoveLink}
                    >
                        <Trash2Icon size={iconSize.small}/>
                    </Button>
                ) : (
                    <Button size={"small"}
                        type="submit"
                        variant={"text"}>
                        <CheckIcon size={iconSize.small}/>
                    </Button>
                )}
                </div>
                {error && (
                    <Typography variant="caption" color="error" className="px-1">
                        {error}
                    </Typography>
                )}
            </form>
        </Popover>
    );
};
