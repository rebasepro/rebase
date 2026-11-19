import { stripVTControlCharacters } from "util";
import { diagnoseDbError } from "../src/cli-errors";

const DEPENDENCY_DROP = {
    code: "2BP01",
    message: "cannot drop type posts_status because other objects depend on it"
};

describe("the dependency-drop remedy", () => {
    it("directs the reader to inspect the plan without suggesting a cascade drop", () => {
        const banner = stripVTControlCharacters(diagnoseDbError(DEPENDENCY_DROP) ?? "");
        expect(banner).toContain("A schema change was blocked by dependent objects");
        expect(banner).toContain("If the plan removes an object you need");
        expect(banner).toContain("use a versioned migration");
        expect(banner).not.toContain("CASCADE");
    });
});
