/**
 * An icon name that names no icon says so, once.
 *
 * `getIcon` returned nothing for an unknown name and the table drew a
 * placeholder picked from its slug, so a scaffold shipping "Article" and
 * "Person" (Material names) showed the wrong icons with nothing saying why.
 */
import { getIcon } from "../src/util/icons";

describe("an unknown icon name", () => {
    afterEach(() => jest.restoreAllMocks());

    it("draws nothing and warns once per name", () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        expect(getIcon("NoSuchIconAnywhere")).toBeUndefined();
        expect(getIcon("NoSuchIconAnywhere")).toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toMatch(/no icon named "NoSuchIconAnywhere".*Lucide/);
    });

    it("stays quiet for a name that exists, in any spelling the lookup takes", () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        expect(getIcon("FileText")).toBeDefined();
        expect(getIcon("file_text")).toBeDefined();
        expect(warn).not.toHaveBeenCalled();
    });
});
