/**
 * The one rule the build and the runtime read a content hash with — see
 * `isContentHashedFileName`. A Vite build's own names are checked in the CLI's
 * `precompress-hash-names.test.ts`; these are the edges.
 */
import { isContentHashedFileName } from "../src";

describe("isContentHashedFileName", () => {
    it.each([
        ["index-vgugiqRO.js", "Vite's eight characters, no `-` in them"],
        ["index-C-WpENHZ.js", "a `-` inside the hash"],
        ["vendor-react-router-Cb-YeB-k.js", "a `-` in the name and two in the hash"],
        ["page10-D6Dq--fD.js", "two `-` together in the hash"],
        ["index--AbCdEf1.js", "a hash that starts with `-`"],
        ["index-AbCdEf1-.css", "a hash that ends with `-`"],
        ["index-Ab_dEf1z.css", "an `_` in the hash"],
        ["rebase-admin-DTJBWfJW.css", "a capitals-only hash"],
        ["index-vgugiqROa1b2.js", "a longer hash after the last `-`"]
    ])("reads %s as hashed: %s", (name) => {
        expect(isContentHashedFileName(name)).toBe(true);
    });

    it.each([
        ["vendor-analytics.js", "lowercase prose after the last `-`"],
        ["vendor-analytics-dashboard.js", "lowercase prose, `-` nine from the end"],
        ["index.js", "no `-` at all"],
        ["index-abc.js", "too short to be a hash"],
        ["favicon.svg", "no hash"],
        [".hidden-AbCdEf12", "no extension"]
    ])("reads %s as not hashed: %s", (name) => {
        expect(isContentHashedFileName(name)).toBe(false);
    });
});
