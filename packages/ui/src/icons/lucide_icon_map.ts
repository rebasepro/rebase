/**
 * lucide's full `icons` map, behind a module boundary of its own.
 *
 * Only `loadLucideIcons` may reach this file, and only through `import()`.
 * Never import it statically: it exists so the bundler can give the map an
 * async chunk. A dynamic `import("lucide-react")` cannot do that, because
 * `lucide-react` is also imported statically (the kit's named icons, and every
 * app's own) and so already lives in a static chunk — the bundler keeps it
 * there and materialises the whole namespace, map included, on the critical
 * path. `test/lucide-icon-map-stays-lazy.test.ts` holds this in place.
 */
export { icons } from "lucide-react";
