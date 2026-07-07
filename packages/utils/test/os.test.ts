import { getOS, getAltSymbol } from "../src/os";

describe("os utils", () => {
    const originalNavigator = global.navigator;

    afterEach(() => {
        // @ts-ignore
        global.navigator = originalNavigator;
    });

    it("should return Windows for Win user agent", () => {
        // @ts-ignore
        global.navigator = { userAgent: "Windows NT 10.0; Win64; x64" };
        expect(getOS()).toBe("Windows");
        expect(getAltSymbol()).toBe("Alt");
    });

    it("should return MacOS for Mac user agent", () => {
        // @ts-ignore
        global.navigator = { userAgent: "Macintosh; Intel Mac OS X 10_15_7" };
        expect(getOS()).toBe("MacOS");
        expect(getAltSymbol()).toBe("⌥");
    });

    it("should return Linux for Linux user agent", () => {
        // @ts-ignore
        global.navigator = { userAgent: "X11; Linux x86_64" };
        expect(getOS()).toBe("Linux");
        expect(getAltSymbol()).toBe("Alt");
    });

    it("should return Unknown for unknown user agent", () => {
        // @ts-ignore
        global.navigator = { userAgent: "Unknown Browser" };
        expect(getOS()).toBe("Unknown");
        expect(getAltSymbol()).toBe("Alt");
    });
});
