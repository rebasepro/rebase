import fs from "fs";
import path from "path";
import zlib from "zlib";
import { promisify } from "util";
import type { Plugin } from "vite";
import { isPrecompressibleAsset, PRECOMPRESS_MIN_BYTES } from "@rebasepro/types";

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

/**
 * `.br` and `.gz` beside every content-hashed asset a Vite build writes.
 *
 * `serveSPA` serves a sibling when the browser accepts its encoding — no
 * compression CPU on any request, and brotli (about 15% smaller than gzip on
 * JavaScript) for the browsers that take it. Without siblings the runtime
 * compresses on the fly, and only ever with gzip: `CompressionStream` has no
 * brotli.
 *
 * `rebase build` writes the same siblings when it folds a frontend into a
 * bundle (`precompressStaticAssets` in the CLI). This is for a frontend built
 * by `vite build` alone and served by `serveSPA` — the Rebase Cloud console,
 * the example app — by the same rule, `isPrecompressibleAsset`: hashed, a
 * compressible type, at least {@link PRECOMPRESS_MIN_BYTES}. A sibling is
 * written only when it is smaller.
 *
 * Brotli at quality 9, not 11: on the example app's JavaScript, 11 is 8% smaller
 * and twenty times slower.
 *
 * @example
 * ```ts
 * plugins: [react(), rebasePrecompress()]
 * ```
 */
export function rebasePrecompress(): Plugin {
    return {
        name: "rebase:precompress",
        apply: "build",
        enforce: "post",
        async writeBundle(options, bundle) {
            const outDir = options.dir ?? (options.file ? path.dirname(options.file) : undefined);
            if (!outDir) return;
            await Promise.all(Object.keys(bundle).map(async (fileName) => {
                if (!isPrecompressibleAsset(path.basename(fileName))) return;
                const file = path.join(outDir, fileName);
                const source = await fs.promises.readFile(file);
                if (source.byteLength < PRECOMPRESS_MIN_BYTES) return;
                const [br, gz] = await Promise.all([
                    brotli(source, {
                        params: {
                            [zlib.constants.BROTLI_PARAM_QUALITY]: 9,
                            [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
                            [zlib.constants.BROTLI_PARAM_SIZE_HINT]: source.byteLength
                        }
                    }),
                    gzip(source, { level: 9 })
                ]);
                await Promise.all([
                    br.byteLength < source.byteLength ? fs.promises.writeFile(`${file}.br`, br) : undefined,
                    gz.byteLength < source.byteLength ? fs.promises.writeFile(`${file}.gz`, gz) : undefined
                ]);
            }));
        }
    };
}
