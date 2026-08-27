import { InferPropertyType } from "@rebasepro/types";
import { Property } from "@rebasepro/types";

/**
 * @group Preview components
 */
export type PreviewSize = "small" | "medium" | "large";

/**
 * @group Preview components
 */
export interface PropertyPreviewProps<P extends Property | Property, CustomProps = unknown> {
    /**
     * Name of the property
     */
    propertyKey?: string;

    value: InferPropertyType<P> | any;

    /**
     * Property this display is related to, now strongly typed to P
     */
    property: P;

    /**
     * Desired size of the preview, depending on the context.
     */
    size: PreviewSize;

    /**
     * Max height assigned to the preview, depending on the context.
     * It may be undefined if unlimited.
     */
    height?: number;

    /**
     * Max height width to the preview, depending on the context.
     * It may be undefined if unlimited.
     */
    width?: number;

    /**
     * Additional properties set by the developer
     */
    customProps?: CustomProps;

    /**
     * If the preview should be interactive or not.
     * This applies only to videos.
     */
    interactive?: boolean;

    /**
     * If true, image previews will fill their container completely.
     * Only applies to image type properties.
     */
    fill?: boolean;

    /**
     * If true, relations/references will render as plain text strings rather than full cards.
     */
    textOnly?: boolean;

    /**
     * The preview has one line and cannot grow — it fills a slot in a card, a
     * chip, or a table cell of fixed height.
     *
     * Properties whose natural rendering is a block (Markdown, multi-line text,
     * maps, arrays) render a one-line stand-in instead: an opening excerpt, or
     * a count. Left unset, {@link PropertyPreview} infers it from the entity
     * preview nesting depth, which is where the constraint actually comes from;
     * pass it explicitly only to force the compact form somewhere the nesting
     * does not say so.
     */
    compact?: boolean;

    /**
     * The caller has already labelled this value, so the preview must not
     * repeat the property name. A boolean is the one that does: it renders its
     * name beside the checkbox, which reads as a caption in a table cell and as
     * a stutter under a field label — "VIP" over a checkbox saying "VIP".
     */
    hideLabel?: boolean;

}
