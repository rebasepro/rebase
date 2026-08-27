import React from "react";
import type { PreviewSize } from "../../types/components/PropertyPreviewProps";
import { PropertyPreview } from "../../preview";
import { StorageThumbnail } from "../../preview/components/StorageThumbnail";
import { UrlComponentPreview } from "../../preview/components/UrlComponentPreview";
import { Chip } from "@rebasepro/ui";
import type { PreviewSlot } from "./usePreviewSlots";

export interface SlotValueProps {
    slot: PreviewSlot | undefined;
    size: PreviewSize;
    /**
     * Relations and references render as one line of linked text rather than as
     * a card. Defaults to true: a slot is a line in a row or a card, and a
     * relation that renders its own bordered card there — with its own id line
     * and its own side-panel button — is a card inside a card.
     *
     * Pass `false` only for a slot with room for one, which in practice is
     * none of them.
     */
    textOnly?: boolean;
    /** Images only: fill the container rather than fitting inside it. */
    fill?: boolean;
}

/**
 * One display slot, rendered.
 *
 * A slot's value arrives one of two ways and they cannot be rendered the same:
 *
 * - **From a property** — render it with that property's own preview, so an
 *   enum status keeps its colour, a date keeps its format and a storage path
 *   becomes a thumbnail. This is why a declared path beats a resolver whenever
 *   the value is actually on the record.
 * - **From a resolver** — there is no property, because the value was computed
 *   or fetched. All that can be said about it is that it is text.
 *
 * The branch lives here, once, rather than at each of the fourteen places the
 * list row, the card and the board card render a slot. That count is the reason:
 * the last time a rule like this was inlined per call site, it drifted into
 * seven versions.
 */
export function SlotValue({ slot, size, textOnly = true, fill }: SlotValueProps) {

    if (!slot || slot.value === undefined || slot.value === null) return null;

    if (!slot.property || !slot.propertyKey) {
        // A computed image is still an image. "There is no property, so all that
        // can be said about it is that it is text" holds for a title and fails
        // here: `display.image` accepts "a storage path or a URL … so a resolver
        // may return either", and both used to be printed as their own string
        // inside the image frame.
        if (slot.role === "image" && typeof slot.value === "string" && slot.value.trim()) {
            return <ComputedImage value={slot.value.trim()} size={size} fill={fill}/>;
        }

        // Computed. Arrays (a `tags` resolver) join rather than rendering as
        // "[object Object]" via String().
        const text = Array.isArray(slot.value)
            ? slot.value.map(item => String(item)).join(", ")
            : String(slot.value);
        return <>{text}</>;
    }

    return <PropertyPreview
        propertyKey={slot.propertyKey}
        value={slot.value as never}
        property={slot.property}
        size={size}
        textOnly={textOnly}
        fill={fill}/>;
}

/**
 * The `tags` slot, as chips beside the status.
 *
 * Honours both arms the same way the rest of the file does. A declared **path**
 * goes through {@link SlotValue}, so an array of enum values keeps its own
 * colours — that is the stated advantage of naming a property. A **resolver**
 * returns bare strings with no property to render them as, so they become plain
 * chips; a single string is accepted as one tag, which the role's type documents.
 *
 * Lives here rather than in the list, the card and the board card because that is
 * three copies of the same decision, and this file exists to hold exactly one.
 */
export function TagChips({ slot, max = 4 }: { slot: PreviewSlot, max?: number }) {

    if (slot.property && slot.propertyKey) {
        return <SlotValue slot={slot} size="small"/>;
    }

    const values = (Array.isArray(slot.value) ? slot.value : [slot.value])
        .filter(item => item !== undefined && item !== null && String(item).trim() !== "")
        .map(item => String(item));

    if (values.length === 0) return null;

    const shown = values.slice(0, max);
    const hidden = values.length - shown.length;

    return <>
        {shown.map(value => (
            <Chip key={value}
                size="smallest"
                className="!text-[10px] !leading-tight !py-0 shrink-0 max-w-[100px] truncate">
                {value}
            </Chip>
        ))}
        {hidden > 0 && (
            <span className="text-[10px] text-surface-400 dark:text-surface-500 shrink-0">+{hidden}</span>
        )}
    </>;
}

/**
 * Whether a computed image string can be fetched as-is, or has to be resolved
 * through storage first.
 *
 * Exported because it is the whole decision: rendering either branch needs a
 * provider (a storage source, a DOM), and the thing worth pinning is which
 * branch a given string takes. `//host/x` is protocol-relative and equally
 * fetchable; `data:` and `blob:` are already the bytes.
 */
export function isFetchableImageUrl(value: string): boolean {
    return /^(https?:)?\/\//i.test(value) || /^(data|blob):/i.test(value);
}

/**
 * A string a resolver returned for the `image` role, rendered as a picture.
 *
 * Two things can arrive here and they need different handling, which is the whole
 * reason a property-path image is preferable: a storage property knows which
 * backend holds it, and a bare string does not.
 *
 * - An **absolute URL** is already fetchable. Rendering it through the storage
 *   layer would ask a bucket to sign a path that was never in it.
 * - Anything else is read as a **storage path** on the default source, which is
 *   the only source a value with no property can be attributed to. A resolver
 *   pointing at a named source should name the property instead.
 */
function ComputedImage({ value, size, fill }: { value: string, size: PreviewSize, fill?: boolean }) {
    const isAbsolute = isFetchableImageUrl(value);

    if (isAbsolute) {
        return <UrlComponentPreview previewType="image"
            url={value}
            size={size}
            fill={fill}
            hint={value}/>;
    }

    return <StorageThumbnail storagePathOrDownloadUrl={value}
        storeUrl={false}
        size={size}
        fill={fill}/>;
}
