/**
 * The built entry point for `generate-drizzle-schema`.
 *
 * `generate-drizzle-schema.ts` guards its own `main()` with
 * `import.meta.url.endsWith(process.argv[1])`, because `src/index.ts` re-exports
 * the module and importing the driver must not run the generator. That guard is
 * correct when the file IS the process entry — which is how it runs from source
 * under tsx — and silently false once the module is bundled: the executed file
 * is a stub, the code lives in a shared chunk, and the chunk's `import.meta.url`
 * is not the stub's path. The generator then did nothing, exited 0, and the
 * caller reported success over an unwritten schema.
 *
 * So the built path gets an entry that says what it means.
 */
import { main } from "../generate-drizzle-schema";

main().catch(() => {
    process.exitCode = 1;
});
