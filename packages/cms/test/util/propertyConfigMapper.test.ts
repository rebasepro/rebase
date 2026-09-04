import { mapPropertiesToConfigs, mapPropertyToConfig } from "../../src/util/propertyConfigMapper";
import type { Properties, StringProperty } from "@rebasepro/types";

/**
 * A column header has to say something, and `name` is optional on a property —
 * a headless project has no UI and no reason to invent labels. The panel
 * derives one from the key, the same way the collection editor already suggests
 * a name, so a derived label reads the same wherever it appears.
 */
describe("mapPropertyToConfig — the label", () => {
    it("keeps the author's name when there is one", () => {
        const property = { type: "string", name: "Job title" } as StringProperty;
        expect(mapPropertyToConfig(property, "jobTitle").name).toBe("Job title");
    });

    it("derives one from the key when there is not", () => {
        const properties: Properties = {
            publishDate: { type: "date" },
            hero_image: { type: "string" },
            photoURL: { type: "string" }
        } as unknown as Properties;
        const configs = mapPropertiesToConfigs(properties);
        expect(configs.publishDate.name).toBe("Publish Date");
        expect(configs.hero_image.name).toBe("Hero Image");
        // Acronyms survive: not "Photo Url".
        expect(configs.photoURL.name).toBe("Photo URL");
    });

    it("never renders `undefined` as a column header", () => {
        for (const config of Object.values(mapPropertiesToConfigs(
            { title: { type: "string" } } as unknown as Properties))) {
            expect(config.name).toBeTruthy();
            expect(config.name).not.toContain("undefined");
        }
    });
});
