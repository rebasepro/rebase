#!/usr/bin/env node
/**
 * Mirror the git-tracked `app/seed-assets/` tree into the local-storage uploads
 * directory that the server actually serves from.
 *
 * Why this exists: the demo's images used to reach the container only because
 * `COPY app ./app` picked up the builder's `app/uploads/` working tree. That
 * directory is gitignored, so it is populated on a long-lived checkout and
 * EMPTY in a fresh clone, a git worktree, or CI — and a build from one of those
 * silently produced an image where every image 404s. `seed-assets/` is tracked,
 * so mirroring it at build time makes the image's asset content reproducible
 * from git alone.
 *
 * Layout must match what LocalStorageController reads and what seed.ts writes:
 *   {uploads}/{bucket}/{prefix}/{file}      (bucket defaults to "default")
 * plus a sibling `<file>.metadata.json` — see `copyStaticAssets` in
 * app/backend/src/seed.ts, whose sidecar shape this mirrors.
 *
 * Idempotent: existing files and sidecars are left untouched.
 *
 * Usage: node tooling/scripts/mirror-seed-assets.mjs [seedAssetsDir] [uploadsDir]
 */

import fs from "node:fs";
import path from "node:path";

/**
 * seed-assets subdirectory → storage path prefix.
 *
 * Mirrors the `seedAssets(<dir>, <prefix>)` call sites in
 * app/backend/src/seed.ts. Two of them do not map 1:1 (`hero` and `content`
 * both live under `posts/`), so this cannot be derived from directory names.
 * An unmapped subdirectory fails the build rather than being skipped, so adding
 * assets without teaching this script about them cannot ship a half-empty image.
 */
const PREFIXES = {
    hero: "posts/hero",
    content: "posts/content",
    author_pictures: "author_pictures",
    product_images: "product_images",
    exercise_images: "exercise_images"
};

/** Bucket subdirectory used by LocalStorageController when none is given. */
const DEFAULT_BUCKET = "default";

const CONTENT_TYPES = {
    png: "image/png",
    webp: "image/webp",
    avif: "image/avif",
    svg: "image/svg+xml",
    gif: "image/gif"
};

function contentTypeFor(file) {
    const ext = file.split(".").pop()?.toLowerCase() ?? "";
    return CONTENT_TYPES[ext] ?? "image/jpeg";
}

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const seedAssetsDir = path.resolve(process.argv[2] ?? path.join(repoRoot, "app/seed-assets"));
const uploadsDir = path.resolve(process.argv[3] ?? path.join(repoRoot, "app/uploads"));

if (!fs.existsSync(seedAssetsDir)) {
    console.error(`❌ seed-assets directory not found: ${seedAssetsDir}`);
    process.exit(1);
}

const subdirs = fs
    .readdirSync(seedAssetsDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);

const unmapped = subdirs.filter(d => !(d in PREFIXES));
if (unmapped.length > 0) {
    console.error(
        `❌ seed-assets subdirectories have no storage prefix mapping: ${unmapped.join(", ")}\n` +
        "   Add them to PREFIXES in tooling/scripts/mirror-seed-assets.mjs (and to a seedAssets() call\n" +
        "   in app/backend/src/seed.ts) so their files reach the served uploads directory."
    );
    process.exit(1);
}

let copied = 0;
let skipped = 0;
let sidecars = 0;

for (const subdir of subdirs) {
    const srcDir = path.join(seedAssetsDir, subdir);
    const destDir = path.join(uploadsDir, DEFAULT_BUCKET, PREFIXES[subdir]);
    fs.mkdirSync(destDir, { recursive: true });

    const files = fs
        .readdirSync(srcDir, { withFileTypes: true })
        .filter(e => e.isFile() && !e.name.endsWith(".metadata.json"))
        .map(e => e.name);

    for (const file of files) {
        const destPath = path.join(destDir, file);

        if (fs.existsSync(destPath)) {
            skipped++;
        } else {
            fs.copyFileSync(path.join(srcDir, file), destPath);
            copied++;
        }

        const metaPath = `${destPath}.metadata.json`;
        if (!fs.existsSync(metaPath)) {
            fs.writeFileSync(
                metaPath,
                JSON.stringify(
                    {
                        contentType: contentTypeFor(file),
                        size: fs.statSync(destPath).size,
                        uploadedAt: "2025-01-01T00:00:00.000Z"
                    },
                    null,
                    2
                )
            );
            sidecars++;
        }
    }

    console.log(`  ${subdir} → ${DEFAULT_BUCKET}/${PREFIXES[subdir]}/ (${files.length} files)`);
}

const total = copied + skipped;
if (total === 0) {
    console.error(`❌ No seed assets found under ${seedAssetsDir} — the image would ship with no images.`);
    process.exit(1);
}

console.log(`✅ Seed assets mirrored into ${uploadsDir}: ${copied} copied, ${skipped} already present, ${sidecars} metadata sidecars written.`);
