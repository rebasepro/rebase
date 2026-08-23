// Test-only executable entry, mirroring `bin/rebase.js` for a source checkout.
// `entry` takes the full process.argv, not a sliced one.
import { entry } from "../../cli";

entry(process.argv).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
});
