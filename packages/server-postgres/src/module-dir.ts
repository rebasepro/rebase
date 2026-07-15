import path from "path";
import { fileURLToPath } from "url";

// Isolated in its own module so the jest CommonJS transform can swap it for a
// __dirname shim via moduleNameMapper — `import.meta` is a syntax error once
// ts-jest transpiles to CJS.
export const moduleDir = path.dirname(fileURLToPath(import.meta.url));
