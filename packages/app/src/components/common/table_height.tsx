/**
 * @group Components
 */
export type TableSize = "xs" | "s" | "m" | "l" | "xl";

export function getRowHeight(size: TableSize): number {
    switch (size) {
        // Density pass (2026-09-08): the old ladder was 54 / 80 / 140 / 280 / 400,
        // sized for image thumbnails at every step, so the default "m" row was
        // 140px of mostly air around one line of text. Now xs..m are text rows
        // (small previews: a chip, a date, one inline reference) and only l/xl
        // make room for medium and large thumbnails.
        case "xl":
            return 160;
        case "l":
            return 96;
        case "m":
            return 48;
        case "s":
            return 42;
        case "xs":
            return 36;
        default:
            throw Error("Missing mapping for collection size -> height");
    }
}
