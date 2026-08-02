/**
 * Single consolidated seed script for the Rebase demo.
 * Uploads static seed images to storage (local or S3/MinIO) and seeds all collections.
 * Run with: npx tsx src/seed.ts
 */
import { createPostgresDatabaseConnection } from "@rebasepro/server-postgres";
import { env } from "./env.js";
import {
    authors, posts, tags, products, orders,
    postsTags, customers, orderItems, tickets, productLocales, exercises,
    postsStatus, productsCategory, productsStatus, productLocalesLocale,
    ordersStatus, ordersPayment_status, ordersCurrency,
    ticketsStatus, ticketsPriority, ticketsCategory,
    exercisesDifficulty, exercisesCategory, exercisesStatus
} from "./schema.generated.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Locate the `app/` project root — the directory that actually contains the
 * `seed-assets/` and `uploads/` folders (siblings of `backend/`). This must
 * work in two very different layouts:
 *   - source / manual run (`npx tsx src/seed.ts`): __dirname = app/backend/src
 *   - compiled container run (cron): __dirname = app/backend/dist/backend/src
 * Anchoring paths off __dirname directly breaks in the compiled layout because
 * tsc nests the output under dist/backend/ and never copies the data files.
 * Walking up to the nearest ancestor that has `seed-assets/` resolves both.
 */
function findAppRoot(start: string): string {
    let dir = start;
    for (let i = 0; i < 8; i++) {
        if (fs.existsSync(path.join(dir, "seed-assets"))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return path.resolve(start, "../.."); // fallback: original source-layout assumption
}
const APP_ROOT = findAppRoot(__dirname);
// Local-storage upload dir: prefer the server's configured STORAGE_PATH (set in
// the container) so seeded assets land where the running server actually serves
// them; fall back to the in-repo uploads dir for local/manual runs.
const UPLOADS_DIR = process.env.STORAGE_PATH
    ? path.join(process.env.STORAGE_PATH, "default")
    : path.join(APP_ROOT, "uploads/default");
const SEED_ASSETS_DIR = path.join(APP_ROOT, "seed-assets");

// ── S3 helpers (lazy-loaded only when STORAGE_TYPE=s3) ────────────────
const isS3 = env.STORAGE_TYPE === "s3";
let _s3Client: InstanceType<typeof import("@aws-sdk/client-s3").S3Client> | null = null;

async function getS3Client() {
    if (_s3Client) return _s3Client;
    const { S3Client } = await import("@aws-sdk/client-s3");
    _s3Client = new S3Client({
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION || "us-east-1",
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
        credentials: {
            accessKeyId: env.S3_ACCESS_KEY_ID || "",
            secretAccessKey: env.S3_SECRET_ACCESS_KEY || "",
        },
    });
    return _s3Client;
}

function getContentType(file: string): string {
    const ext = file.split(".").pop()?.toLowerCase() ?? "jpg";
    const map: Record<string, string> = {
        jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
        webp: "image/webp", avif: "image/avif", gif: "image/gif",
    };
    return map[ext] || "application/octet-stream";
}

/**
 * Upload seed assets from a local directory to S3.
 * Skips files that already exist in the bucket.
 * Returns the list of relative storage keys.
 */
async function uploadAssetsToS3(assetSubdir: string, storagePrefix: string): Promise<string[]> {
    const srcDir = path.join(SEED_ASSETS_DIR, assetSubdir);
    if (!fs.existsSync(srcDir)) {
        console.warn(`  ⚠️ Seed assets not found: ${srcDir}`);
        return [];
    }

    const { PutObjectCommand, HeadObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await getS3Client();
    const bucket = env.S3_BUCKET!;

    const files = fs.readdirSync(srcDir).filter(f => !f.endsWith(".metadata.json"));
    const keys: string[] = [];
    let uploaded = 0;

    for (const file of files) {
        const key = `${storagePrefix}${file}`;
        keys.push(key);

        // Check if already exists
        try {
            await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
            continue; // already exists
        } catch {
            // doesn't exist, upload it
        }

        const body = fs.readFileSync(path.join(srcDir, file));
        await client.send(new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: getContentType(file),
        }));
        uploaded++;
    }

    if (uploaded > 0) {
        console.log(`  📤 Uploaded ${uploaded} new files to s3://${bucket}/${storagePrefix}`);
    }
    return keys;
}

// ── Deterministic RNG & UUIDs ─────────────────────────────────────────
let _seed = 1337;
function random() {
    let t = _seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
Math.random = random;

function generateUUID(prefix: string, index: number): string {
    const hash = createHash("sha256").update(`${prefix}-${index}`).digest("hex");
    return `${hash.substring(0, 8)}-${hash.substring(8, 12)}-4${hash.substring(13, 16)}-a${hash.substring(17, 20)}-${hash.substring(20, 32)}`;
}

const ORDER_KEY_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * The nth key in the fractional-indexing order the admin panel writes.
 *
 * Board ordering is a `fractional-indexing` key, not a number: dropping a card
 * asks that library for a key *between* its two new neighbours. Seeding
 * `String(i)` produced values it rejects outright ("invalid order key head:
 * 1"), so every drag fell through to the library's fallback and every card
 * landed at the bottom with the same key — and `"6"` sorted after `"55"`
 * anyway, since the column is ordered as text.
 *
 * The format is a length marker followed by base36 digits — exactly what
 * `generateNKeysBetween(null, null, n, ORDER_KEY_DIGITS)` emits in the admin
 * package. Lower case only, because the column is sorted by Postgres and its
 * default collation does not order upper case the way byte comparison does.
 */
function orderKey(index: number): string {
    const digits: string[] = [];
    let remaining = index;
    let width = 1;
    let capacity = ORDER_KEY_ALPHABET.length;
    while (remaining >= capacity) {
        remaining -= capacity;
        width += 1;
        capacity *= ORDER_KEY_ALPHABET.length;
    }
    let value = remaining;
    for (let i = 0; i < width; i++) {
        digits.unshift(ORDER_KEY_ALPHABET[value % ORDER_KEY_ALPHABET.length]);
        value = Math.floor(value / ORDER_KEY_ALPHABET.length);
    }
    // The marker sits at the middle of the alphabet, so keys can also be
    // generated before the first one later on.
    return ORDER_KEY_ALPHABET[ORDER_KEY_ALPHABET.indexOf("i") + width - 1] + digits.join("");
}

// ── Static seed-asset helpers ─────────────────────────────────────────
/**
 * Copy all files from a seed-assets subdirectory into the uploads directory (local storage).
 * Writes .metadata.json for each file. Skips files already present.
 * Returns the list of relative storage paths.
 */
function copyStaticAssets(assetSubdir: string, uploadsSubdir: string): string[] {
    const srcDir = path.join(SEED_ASSETS_DIR, assetSubdir);
    const destDir = path.join(UPLOADS_DIR, uploadsSubdir);
    fs.mkdirSync(destDir, { recursive: true });

    if (!fs.existsSync(srcDir)) {
        console.warn(`  ⚠️ Seed assets not found: ${srcDir}`);
        return [];
    }

    const files = fs.readdirSync(srcDir).filter(f => !f.endsWith(".metadata.json"));
    const paths: string[] = [];

    for (const file of files) {
        const destPath = path.join(destDir, file);
        const relativePath = `${uploadsSubdir}${file}`;

        if (!fs.existsSync(destPath)) {
            fs.copyFileSync(path.join(srcDir, file), destPath);
        }

        // Write metadata if missing
        const metaPath = destPath + ".metadata.json";
        if (!fs.existsSync(metaPath)) {
            const ext = file.split(".").pop()?.toLowerCase() ?? "jpg";
            const contentType = ext === "png" ? "image/png"
                : ext === "webp" ? "image/webp"
                : ext === "avif" ? "image/avif"
                : "image/jpeg";
            const stat = fs.statSync(destPath);
            fs.writeFileSync(metaPath, JSON.stringify({
                contentType,
                size: stat.size,
                uploadedAt: "2025-01-01T00:00:00.000Z"
            }, null, 2));
        }

        paths.push(relativePath);
    }

    return paths;
}

/**
 * Unified helper: copies seed assets to local storage or uploads to S3,
 * depending on the current STORAGE_TYPE configuration.
 */
async function seedAssets(assetSubdir: string, storagePrefix: string): Promise<string[]> {
    if (isS3) {
        return uploadAssetsToS3(assetSubdir, storagePrefix);
    }
    return copyStaticAssets(assetSubdir, storagePrefix);
}

// ── Helpers ───────────────────────────────────────────────────────────
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function pickN<T>(arr: T[], n: number): T[] {
    const s = [...arr].sort(() => Math.random() - 0.5);
    return s.slice(0, n);
}
function slugify(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
function randomDate(startDaysAgo: number, endDaysAgo: number): string {
    const now = Date.now();
    return new Date(now - startDaysAgo * 86400000 + Math.random() * (startDaysAgo - endDaysAgo) * 86400000).toISOString();
}
function currentYear(): number { return new Date().getFullYear(); }


// ── Blog post topics (no PHP, TypeScript-heavy) ───────────────────────
const topics = [
    "Getting Started with React Server Components",
    "Building Type-Safe APIs with tRPC and Zod",
    "PostgreSQL Performance Tuning: A Practical Guide",
    "The Complete Guide to CSS Container Queries",
    "Microservices vs Monoliths: Making the Right Choice",
    "Introduction to WebAssembly for Web Developers",
    "Securing Your Node.js Application: Best Practices",
    "Understanding the V8 Engine: How JavaScript Executes",
    "Docker for Full-Stack Developers: From Dev to Prod",
    "Machine Learning Fundamentals with Python",
    "Rust for Systems Programming: Why It Matters",
    "Building Real-Time Applications with WebSockets",
    "GraphQL vs REST: A Comprehensive Comparison",
    "Kubernetes for Beginners: Container Orchestration Demystified",
    "Advanced TypeScript Patterns for Large Codebases",
    "Testing React Applications with Vitest and Testing Library",
    "AWS Lambda and Serverless Architecture Deep Dive",
    "Modern Authentication: JWTs, OAuth 2.0, and Beyond",
    "The Future of AI-Assisted Development",
    "React Native vs Flutter: Cross-Platform Showdown",
    "CI/CD Pipelines with GitHub Actions",
    "Drizzle ORM: The TypeScript-First Database Toolkit",
    "Understanding Web Vitals and Core Performance Metrics",
    "Astro and the Island Architecture: A New Way to Build",
    "Building a Design System with Tailwind CSS",
    "Hono: The Ultrafast Web Framework for the Edge",
    "From Express to Hono: Migrating Your Node.js API",
    "Data Modeling Best Practices for PostgreSQL",
    "Tailwind CSS at Scale: Custom Plugins and Design Tokens",
    "Observability in Production: Logs, Metrics, and Traces",
    "Astro + React: Building Hybrid Static and Dynamic Sites",
    "Building CLI Tools with Node.js and Commander",
    "The Art of Code Review: Beyond Bug Finding",
    "PostgreSQL Full-Text Search vs Elasticsearch",
    "Practical Event-Driven Architecture with Node.js",
    "TypeScript Generics: From Basics to Advanced",
    "Building a Blog Engine with Astro and Tailwind CSS",
    "Zero-Trust Security Architecture for Modern Apps",
    "Effective Debugging Strategies for Node.js Applications",
    "Horizontal Scaling Strategies for PostgreSQL",
    "State Management in React: What Actually Works in 2025",
    "Building Progressive Web Apps with Astro",
    "Hono Middleware Patterns: Auth, CORS, and Logging",
    "Tailwind CSS vs Styled Components: A Practical Comparison",
    "TypeScript Monorepos with Turborepo and pnpm",
    "Node.js Streams and Backpressure: A Deep Dive",
    "The Developer's Guide to Technical Writing",
    "PostgreSQL JSON Columns: When and How to Use Them",
    "React Server Components and Astro: Complementary Tools",
    "Deploying Hono to Cloudflare Workers and Deno Deploy"
];

const markdownIntros = [
    "In this comprehensive guide, we'll explore the key concepts and practical techniques that every developer should know. Whether you're just starting out or looking to deepen your expertise, this article has something for you.",
    "The landscape of software development is constantly evolving. What worked a year ago might not be the best approach today. Let's dive into the current state of the art and discover what's changed.",
    "As applications grow in complexity, choosing the right tools and patterns becomes critical. In this post, we'll walk through real-world examples and battle-tested approaches that scale.",
    "Have you ever wondered why some teams ship faster with fewer bugs? The answer often lies in the fundamentals. Let's revisit the basics with a modern perspective.",
    "Performance isn't just a nice-to-have — it's a competitive advantage. In this article, we'll look at concrete techniques to make your applications faster and more efficient."
];

const markdownSections = [
    "## Getting Started\n\nBefore diving in, let's set up our development environment:\n\n- **Node.js 20+** installed\n- A modern code editor (VS Code recommended)\n- Basic familiarity with the command line\n\n```bash\nnpm create my-project@latest\ncd my-project\nnpm install\n```\n\nOnce set up, you're ready to start building.",

    "## Core Concepts\n\nThe architecture follows a simple principle: **separation of concerns**.\n\n1. **Presentation Layer** — handles UI rendering\n2. **Business Logic Layer** — domain-specific rules\n3. **Data Access Layer** — manages persistence\n\nThis separation makes code easier to test and maintain.",

    "## Best Practices\n\n- **Write tests first** — TDD catches bugs early\n- **Keep functions small** — each function does one thing\n- **Use meaningful names** — code is read more than written\n- **Prefer composition over inheritance**\n\n> \"Any fool can write code that a computer can understand. Good programmers write code that humans can understand.\" — Martin Fowler",

    "## Performance Optimization\n\n```typescript\n// Before: O(n²)\nconst result = items.filter(item =>\n  otherItems.some(other => other.id === item.id)\n);\n\n// After: O(n) with a Set\nconst idSet = new Set(otherItems.map(o => o.id));\nconst result = items.filter(item => idSet.has(item.id));\n```\n\nSmall changes like this have dramatic impact on large datasets.",

    "## Error Handling\n\nRobust error handling separates production code from prototypes:\n\n```typescript\nasync function fetchData(url: string) {\n  const response = await fetch(url);\n  if (!response.ok) {\n    throw new HttpError(response.status);\n  }\n  return response.json();\n}\n```",

    "## Architecture Patterns\n\n| Pattern | Pros | Cons |\n|---------|------|------|\n| Monolith | Simple deployment | Harder to scale |\n| Microservices | Independent scaling | Operational complexity |\n| Modular Monolith | Best of both | Requires discipline |\n\n**There's no one-size-fits-all solution.** Choose what matches your team.",

    "## Security Considerations\n\n- Validate and sanitize all user input\n- Use parameterized queries to prevent SQL injection\n- Implement rate limiting on public endpoints\n- Store secrets in environment variables\n\n```typescript\n// Never do this\nconst query = `SELECT * FROM users WHERE id = '${userId}'`;\n\n// Do this instead\nconst query = db.select().from(users).where(eq(users.id, userId));\n```",

    "## Deployment Strategies\n\n- **Blue-Green Deployments** — two identical production environments\n- **Canary Releases** — gradually route traffic to new version\n- **Feature Flags** — decouple deployment from feature release\n\nThe goal is to make deployments boring.",

    "## Monitoring and Observability\n\n1. **Structured Logging** — JSON logs with trace IDs\n2. **Metrics** — request latency, error rates\n3. **Distributed Tracing** — follow requests across services\n4. **Alerting** — actionable alerts, not noise\n\nInvest in observability early.",

    "## Conclusion\n\nThe technologies we've discussed represent the current state of the art, but they'll continue to evolve. The most important skill isn't mastering any particular tool — it's the ability to learn, adapt, and make pragmatic decisions.\n\nStay curious, keep building.",

    "## The React Mental Model\n\nReact's component model has fundamentally changed how we think about UI development. Instead of imperatively mutating the DOM, we describe *what* the UI should look like and let the framework figure out the rest.\n\n> \"React is not a framework. It's a library for building composable user interfaces. It encourages the creation of reusable UI components which present data that changes over time.\" — React Documentation\n\nThis declarative approach scales remarkably well. A team of fifty engineers can work on the same codebase without stepping on each other's toes, because each component is a self-contained unit with clear inputs and outputs.\n\n```tsx\nfunction PostCard({ title, excerpt, author }: PostCardProps) {\n  return (\n    <article className=\"rounded-lg border p-6 hover:shadow-md transition-shadow\">\n      <h3 className=\"text-lg font-semibold\">{title}</h3>\n      <p className=\"mt-2 text-gray-600\">{excerpt}</p>\n      <span className=\"mt-4 text-sm text-gray-400\">By {author}</span>\n    </article>\n  );\n}\n```\n\nNotice how Tailwind CSS classes make the styling intent immediately obvious. No jumping between files, no naming debates.",

    "## Why PostgreSQL Keeps Winning\n\nIn a world of shiny new databases, PostgreSQL remains the reliable workhorse that powers everything from startups to Fortune 500 companies.\n\n> \"PostgreSQL is the most advanced open-source relational database in the world. Full stop.\" — Bruce Momjian, PostgreSQL Core Team\n\nWhat makes Postgres special isn't any single feature — it's the *combination* of rock-solid reliability, extensibility, and a feature set that rivals commercial databases costing six figures.\n\n```sql\n-- Full-text search, JSONB, CTEs, window functions — all built in\nSELECT title, ts_rank(search_vector, query) AS rank\nFROM posts, to_tsquery('english', 'react & typescript') AS query\nWHERE search_vector @@ query\nORDER BY rank DESC\nLIMIT 20;\n```\n\nWith features like JSONB columns, row-level security, and logical replication, Postgres adapts to almost any workload without forcing you into a different database.",

    "## Tailwind CSS: Utility-First Done Right\n\nWhen Tailwind CSS first appeared, many developers dismissed it as \"inline styles with extra steps.\" They were wrong.\n\n> \"I've written CSS for over 20 years, and Tailwind CSS is the most productive way I've ever styled anything. Once you get past the initial learning curve, you'll never want to go back.\" — Adam Wathan, Creator of Tailwind CSS\n\nThe key insight is that utility classes aren't just about writing CSS faster — they're about **eliminating the decision fatigue** that comes with naming things and organizing stylesheets.\n\n```html\n<div class=\"flex items-center gap-4 rounded-xl bg-white p-6 shadow-lg\n            ring-1 ring-black/5 dark:bg-gray-800\">\n  <img class=\"size-12 rounded-full\" src=\"/avatar.jpg\" alt=\"\" />\n  <div>\n    <p class=\"text-sm font-semibold text-gray-900 dark:text-white\">Sarah Chen</p>\n    <p class=\"text-sm text-gray-500\">Senior Engineer</p>\n  </div>\n</div>\n```\n\nThe result is a design system that lives in your markup, is instantly readable by any team member, and produces tiny CSS bundles in production.",

    "## Astro's Content-First Philosophy\n\nAstro introduced a radical idea: what if your framework shipped **zero JavaScript by default**?\n\n> \"The secret to a fast website isn't a faster framework — it's less JavaScript.\" — Fred K. Schott, Creator of Astro\n\nWith the island architecture, Astro lets you use React, Vue, Svelte, or any other UI framework — but only hydrates the interactive parts of the page. The static content ships as pure HTML.\n\n```astro\n---\nimport PostList from '../components/PostList.tsx';\nimport Newsletter from '../components/Newsletter.tsx';\nconst posts = await fetch('/api/posts').then(r => r.json());\n---\n<html>\n  <body>\n    <h1>Our Blog</h1>\n    <!-- Static: zero JS -->\n    <PostList posts={posts} />\n    <!-- Interactive island: hydrated on visible -->\n    <Newsletter client:visible />\n  </body>\n</html>\n```\n\nFor content-heavy sites like blogs, documentation, and marketing pages, this approach delivers performance numbers that are almost impossible to match with traditional SPAs.",

    "## Hono: Speed Without Compromise\n\nHono emerged as a game-changer in the Node.js ecosystem — a web framework built for the edge that doesn't sacrifice developer experience for performance.\n\n> \"Hono is ultrafast, lightweight, and works on any JavaScript runtime. It's the web framework for the edges of the internet.\" — Yusuke Wada, Creator of Hono\n\nWhat sets Hono apart is its commitment to Web Standards. It uses the Fetch API, Request, and Response objects natively, meaning your code runs unchanged on Cloudflare Workers, Deno, Bun, and Node.js.\n\n```typescript\nimport { Hono } from 'hono';\nimport { cors } from 'hono/cors';\nimport { jwt } from 'hono/jwt';\n\nconst app = new Hono();\n\napp.use('/api/*', cors());\napp.use('/api/*', jwt({ secret: process.env.JWT_SECRET! }));\n\napp.get('/api/posts', async (c) => {\n  const posts = await db.select().from(postsTable).limit(20);\n  return c.json({ data: posts });\n});\n\nexport default app;\n```\n\nThe middleware ecosystem is rich, the TypeScript support is first-class, and the router is one of the fastest in any JavaScript runtime.",

    "## The Node.js Event Loop Explained\n\nEven experienced Node.js developers get tripped up by the event loop. Understanding it deeply is the difference between writing code that works and code that scales.\n\n> \"Node.js is not a silver bullet. It's a tool that solves a specific class of problems extremely well — I/O-bound, event-driven applications.\" — Ryan Dahl, Creator of Node.js\n\nThe event loop processes callbacks in a specific order: timers, pending callbacks, idle, poll, check, and close callbacks. Each phase has a FIFO queue of callbacks to execute.\n\n```typescript\n// This is NOT what you think it is\nsetTimeout(() => console.log('timeout'), 0);\nsetImmediate(() => console.log('immediate'));\nprocess.nextTick(() => console.log('nextTick'));\nPromise.resolve().then(() => console.log('promise'));\n\n// Output: nextTick → promise → timeout → immediate\n// (or timeout → immediate may swap depending on system load)\n```\n\nWhen you understand the event loop, you understand why `await` matters, why CPU-bound work blocks everything, and why worker threads exist. It's foundational knowledge for any serious Node.js developer."
];

const excerpts = [
    "A deep dive into modern development practices that will level up your engineering skills.",
    "Practical tips and patterns you can start using in your projects today.",
    "Everything you need to know to get started, with real-world examples and best practices.",
    "A comprehensive guide for developers looking to build scalable, maintainable applications.",
    "Lessons learned from building and maintaining production systems at scale.",
    "Exploring cutting-edge techniques that are reshaping how we build software.",
    "A hands-on walkthrough with code examples you can copy-paste into your own projects.",
    "The definitive resource for understanding this technology and its ecosystem.",
    "Battle-tested strategies from teams who've been there and done that.",
    "From zero to production: everything you need to build with confidence.",
    "An honest look at the trade-offs, with guidance on when to use this approach.",
    "Key insights and practical advice distilled from years of industry experience."
];

const authorPicFiles = [
    "author_pictures/0phas_Gemini_Generated_Image_.jpeg",
    "author_pictures/5kuxx_chromaflow_landing_page.png",
    "author_pictures/9h9s0_Gemini_Generated_Image_hwxqw4hwxqw4hwxq.jpeg",
    "author_pictures/jbiri_77035b3e-cb2f-42a2-85c9-813d7a9045eb.avif",
    "author_pictures/nxih4_logo_small.png",
    "author_pictures/v166u_xvu6k_Frame 45 (1).png",
    "author_pictures/w48fo_Frame 45.png",
    "author_pictures/w5l1n_xvu6k_Frame 45 (1).png"
];

const firstNames = ["James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda", "William", "Elizabeth", "David", "Barbara", "Richard", "Susan", "Joseph", "Jessica", "Thomas", "Sarah", "Charles", "Karen"];
const lastNames = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin"];
function randomName() {
    return `${pick(firstNames)} ${pick(lastNames)}`;
}

// ── Main ──────────────────────────────────────────────────────────────
export async function runSeed() {
    // Reset the deterministic RNG for reproducible data on every run.
    _seed = 1337;

    console.log("🌱 Connecting to database...");
    // Seeding truncates + rewrites every table, so connect with the owner/admin
    // connection (bypasses RLS) — the same one the backend uses for admin ops.
    // Falls back to DATABASE_URL for local/manual runs where it is the owner.
    const seedConnectionString = env.ADMIN_CONNECTION_STRING || env.DATABASE_URL;
    const { db, pool } = createPostgresDatabaseConnection(seedConnectionString, undefined, { max: 1 });

    const NUM_AUTHORS = 20;
    const NUM_TAGS = 30;
    const POST_COUNT = 1500;

    try {
        // ── Seed images to storage (local or S3/MinIO) ─────────────────
        console.log(`📸 Seeding images to ${isS3 ? "S3/MinIO" : "local"} storage...`);
        const heroImagePaths = await seedAssets("hero", "posts/hero/");
        console.log(`  ✅ ${heroImagePaths.length} hero images`);

        const contentImagePaths = await seedAssets("content", "posts/content/");
        console.log(`  ✅ ${contentImagePaths.length} content images`);

        await seedAssets("author_pictures", "author_pictures/");
        console.log(`  ✅ author pictures`);

        const productImagePaths = await seedAssets("product_images", "product_images/");
        console.log(`  ✅ ${productImagePaths.length} product images`);


        // ── Clear existing data ───────────────────────────────────────

        const require = createRequire(import.meta.url);
        // Absolute path off the app root — `./demo-products.json` fails in the
        // compiled container layout (the JSON is not emitted into dist/).
        const demoProductsRaw = require(path.join(APP_ROOT, "backend/src/demo-products.json"));

        type ProductCategory = (typeof productsCategory.enumValues)[number];
        const validCategories: ProductCategory[] = ["electronics", "clothing", "home_garden", "sports", "books", "toys", "health_beauty"];
        function mapCategory(cat: string | undefined | null): ProductCategory {
            if (!cat) return validCategories[Math.floor(Math.random() * validCategories.length)];
            const c = cat.toLowerCase();
            if (c.includes('clothing') || c.includes('sunglasses')) return 'clothing';
            if (c.includes('home') || c.includes('kitchen') || c.includes('serveware')) return 'home_garden';
            if (c.includes('electronic') || c.includes('watch')) return 'electronics';
            if (c.includes('toy')) return 'toys';
            if (c.includes('health') || c.includes('beauty')) return 'health_beauty';
            return validCategories[Math.floor(Math.random() * validCategories.length)];
        }

        // `available_locales` comes from an external product dump, so it is
        // whatever that file happens to say. The column is an enum precisely so
        // `EN`, `en-US` and `english` cannot all land in it, which means the
        // narrowing has to happen here rather than at the insert — Postgres
        // would otherwise reject the batch at run time, after the seed has
        // already truncated the tables.
        type ProductLocale = (typeof productLocalesLocale.enumValues)[number];
        const validLocales = productLocalesLocale.enumValues as readonly ProductLocale[];
        function mapLocales(raw: string[] | undefined | null): ProductLocale[] {
            const seen = new Set<ProductLocale>();
            for (const value of raw ?? []) {
                // `en-US` and `EN` both mean `en`; anything else is dropped
                // rather than guessed at.
                const base = value.toLowerCase().split(/[-_]/)[0] as ProductLocale;
                if (validLocales.includes(base)) seen.add(base);
            }
            return seen.size ? [...seen] : ["en"];
        }

        interface DemoProductRaw {
            name?: string;
            asin?: string;
            category?: string;
            price?: number;
            description?: string;
            brand?: string;
            available_locales?: string[];
            images?: string[];
            main_image?: string;
        }

        interface DemoProduct {
            name: string;
            sku: string;
            cat: (typeof productsCategory.enumValues)[number];
            price: number;
            cost: number;
            weight: number;
            desc: string;
            brand: string;
            locales: ProductLocale[];
            imageUrls: string[];
            localImages?: string[] | null;
        }

        const demoProducts: DemoProduct[] = (demoProductsRaw as DemoProductRaw[]).map((p, index) => ({
            name: p.name || `Product ${index}`,
            sku: p.asin || `SKU-${Math.floor(Math.random()*100000)}`,
            cat: mapCategory(p.category),
            price: p.price || (10 + Math.random() * 90),
            cost: (p.price || 50) * 0.4,
            weight: 100 + Math.floor(Math.random() * 900),
            desc: p.description || "No description available.",
            brand: p.brand || "Generic",
            locales: mapLocales(p.available_locales),
            imageUrls: p.images || (p.main_image ? [p.main_image] : [])
        }));

        const authorIds = Array.from({ length: NUM_AUTHORS }, (_, i) => generateUUID("author", i));
        const tagIds = Array.from({ length: NUM_TAGS }, (_, i) => generateUUID("tag", i));
        const postIds = Array.from({ length: POST_COUNT }, (_, i) => generateUUID("post", i));
        const customerIds = Array.from({ length: 40 }, (_, i) => generateUUID("customer", i));
        const productIds = Array.from({ length: demoProducts.length }, (_, i) => generateUUID("product", i));
        const orderIds = Array.from({ length: 80 }, (_, i) => generateUUID("order", i));
        const ticketIds = Array.from({ length: 60 }, (_, i) => generateUUID("ticket", i));

        console.log("🧹 Clearing existing data...");
        await db.execute("TRUNCATE TABLE posts, authors, tags, products, orders, order_items, customers, tickets, posts_tags, product_locales, exercises RESTART IDENTITY CASCADE;");

        // ── Authors ───────────────────────────────────────────────────
        console.log(`👤 Generating ${NUM_AUTHORS} authors...`);
        const authorBios = [
            `## About Me\n\nI'm a **full-stack engineer** with 10+ years of experience building web applications at scale.\n\n### Expertise\n- React & TypeScript\n- PostgreSQL & distributed systems\n- Cloud architecture (AWS, GCP)\n\n> "The best code is the code you never have to write."`,
            `## Hello! 👋\n\nPassionate about **developer experience** and building tools that make engineers' lives easier.\n\n### Current Focus\n- Open-source tooling\n- Developer advocacy\n- Technical writing\n\nPreviously at Google, now building the future of developer platforms.`,
            `## Background\n\nDesign engineer bridging the gap between **design and code**. I believe great products emerge when both disciplines work in harmony.\n\n### Skills\n- UI/UX Design\n- Design Systems\n- Frontend Architecture\n- Motion & Interaction Design`,
            `## Who I Am\n\nA **systems thinker** who loves solving hard problems with elegant solutions.\n\n### Journey\n1. Started with C++ game engines\n2. Fell in love with the web\n3. Now building BaaS platforms\n\n*Currently obsessed with Rust and WebAssembly.*`,
            `## My Story\n\nFrom **self-taught developer** to engineering lead in 5 years. I write about the lessons learned along the way.\n\n### Topics I Cover\n- Career growth in tech\n- System design patterns\n- Practical TypeScript\n- Team leadership`,
            `## Hi there!\n\nI'm a **data engineer** turned full-stack developer. I bring a unique perspective combining data pipelines with modern web development.\n\n### Interests\n- Real-time analytics\n- Stream processing\n- Data visualization\n- PostgreSQL internals`,
            `## About\n\nSecurity researcher and **application security** specialist. I help teams build secure-by-default systems.\n\n### Focus Areas\n- Zero-trust architecture\n- OAuth 2.0 / OIDC\n- API security\n- Threat modeling`,
            `## Welcome\n\nI'm a **product-minded engineer** who cares deeply about user experience. Every line of code should serve the user.\n\n### Philosophy\n- Ship fast, iterate faster\n- Measure everything\n- Code is a means, not an end\n- Accessibility is non-negotiable`
        ];
        const twitterHandles = ["@reactdev", "@ts_wizard", "@nodemaster", "@pgexpert", "@rustacean42", "@cloudnative", "@devtools_fan", "@webperf_guru", null, null, null, null];
        const githubUsernames = ["alexcodes", "sarah-dev", "mikebuild", "jenn-ts", "rustyfork", "cloudmaster", "designeng", "fullstackjoe", "pgwizard", "nodehero"];
        const authorValues = [];
        for (let i = 1; i <= NUM_AUTHORS; i++) {
            const name = randomName();
            const email = `${name.toLowerCase().replace(/ /g, ".")}${i}@example.com`;
            const ghUser = pick(githubUsernames) + i;
            authorValues.push({
                id: authorIds[i - 1],
                name,
                email,
                picture: pick(authorPicFiles),
                bio: pick(authorBios),
                twitter: pick(twitterHandles),
                github: ghUser,
                website: `https://${ghUser}.dev`,
                userId: i <= 3 ? `user-${i}` : null
            });
        }
        await db.insert(authors).values(authorValues);

        // ── Tags ──────────────────────────────────────────────────────
        console.log(`🏷️  Generating ${NUM_TAGS} tags...`);
        const tagNames = ["React", "TypeScript", "Node.js", "PostgreSQL", "GraphQL", "Docker", "Kubernetes", "AWS", "Python", "Rust", "Go", "CSS", "HTML", "UI/UX", "Design", "DevOps", "AI", "Machine Learning", "Security", "Testing", "CI/CD", "Serverless", "Microservices", "Frontend", "Backend", "Fullstack", "Mobile", "Next.js", "Performance", "Architecture"];
        const tagValues = tagNames.map((name, i) => ({ id: tagIds[i],
name }));
        await db.insert(tags).values(tagValues);

        // ── Posts ─────────────────────────────────────────────────────
        console.log(`📰 Generating ${POST_COUNT} blog posts...`);
        type PostStatus = (typeof postsStatus.enumValues)[number];
        const statuses: PostStatus[] = ["draft", "needs_review", "published", "published", "published", "archived"];
        const postValues = [];
        const usedSlugs = new Set<string>();

        for (let i = 1; i <= POST_COUNT; i++) {
            const topicIdx = (i - 1) % topics.length;
            const round = Math.floor((i - 1) / topics.length);
            const title = round === 0 ? topics[topicIdx] : `${topics[topicIdx]} — Part ${round + 1}`;

            // Unique slug
            let slug = slugify(title);
            let attempt = 1;
            while (usedSlugs.has(slug)) {
                slug = slugify(title) + `-${attempt++}`;
            }
            usedSlugs.add(slug);

            const status = pick([...statuses]);
            const isPublished = status === "published";

            // Build content blocks — never two text blocks in a row, always interleave with images
            const blocks: { type: string; value: string }[] = [{ type: "text",
value: pick(markdownIntros) }];
            const sections = pickN(markdownSections, 4 + Math.floor(Math.random() * 4));
            for (let s = 0; s < sections.length; s++) {
                // Insert an image between every text block
                if (contentImagePaths.length > 0) {
                    blocks.push({ type: "image",
value: pick(contentImagePaths) });
                }
                blocks.push({ type: "text",
value: sections[s] });
            }

            postValues.push({
                id: postIds[i - 1],
                title,
                slug,
                hero_image: pick(heroImagePaths),
                excerpt: pick(excerpts),
                content: blocks,
                status,
                publish_date: isPublished ? randomDate(180, 0) : null,
                created_at: randomDate(180, 10),
                updated_at: randomDate(30, 0),
                author_id: authorIds[Math.floor(Math.random() * NUM_AUTHORS)]
            });
        }

        const BATCH = 50;
        for (let i = 0; i < postValues.length; i += BATCH) {
            await db.insert(posts).values(postValues.slice(i, i + BATCH));
            console.log(`  ✅ Inserted posts ${i + 1}–${Math.min(i + BATCH, postValues.length)}`);
        }

        // ── Post-tag associations ─────────────────────────────────────
        console.log("🏷️  Assigning tags...");
        const ptValues: { post_id: string; tag_id: string }[] = [];
        for (let i = 1; i <= POST_COUNT; i++) {
            const n = 1 + Math.floor(Math.random() * 4);
            const assigned = new Set<number>();
            for (let j = 0; j < n; j++) assigned.add(Math.floor(Math.random() * NUM_TAGS) + 1);
            for (const t of assigned) ptValues.push({ post_id: postIds[i - 1],
tag_id: tagIds[t - 1] });
        }
        for (let i = 0; i < ptValues.length; i += BATCH) {
            await db.insert(postsTags).values(ptValues.slice(i, i + BATCH));
        }
        console.log(`  ✅ Created ${ptValues.length} post-tag associations`);

        // ── Customers ──────────────────────────────────────────────────
        console.log("👤 Generating 40 customers...");
        const companies = ["Acme Corp", "Globex Inc", "Initech", "Umbrella LLC", "Stark Industries", "Wayne Enterprises", "Oscorp", "Cyberdyne Systems", null, null, null, null];
        const streets = ["123 Main St", "456 Oak Ave", "789 Pine Rd", "321 Elm Blvd", "654 Maple Dr", "987 Cedar Ln", "111 Broadway", "222 Market St", "333 Park Ave", "444 Lake Rd"];
        const cities = ["New York, NY 10001", "San Francisco, CA 94102", "Austin, TX 73301", "Chicago, IL 60601", "Seattle, WA 98101", "Miami, FL 33101", "Denver, CO 80201", "Portland, OR 97201", "Boston, MA 02101", "Nashville, TN 37201"];
        const customerValues = [];
        for (let i = 1; i <= 40; i++) {
            const fn = pick(firstNames);
            const ln = pick(lastNames);
            const addr = `${pick(streets)}\n${pick(cities)}`;
            const isVip = Math.random() > 0.8;
            const ltv = isVip ? Math.floor(2000 + Math.random() * 8000) : Math.floor(50 + Math.random() * 1500);
            const totalOrd = isVip ? Math.floor(5 + Math.random() * 20) : Math.floor(1 + Math.random() * 6);
            customerValues.push({
                id: customerIds[i - 1],
                first_name: fn,
                last_name: ln,
                email: `${fn.toLowerCase()}.${ln.toLowerCase()}${i}@example.com`,
                phone: `+1-${String(Math.floor(Math.random() * 900) + 100)}-${String(Math.floor(Math.random() * 900) + 100)}-${String(Math.floor(Math.random() * 9000) + 1000)}`,
                company: pick(companies),
                is_vip: isVip,
                lifetime_value: String(ltv),
                total_orders: String(totalOrd),
                shipping_address: addr,
                billing_address: Math.random() > 0.3 ? addr : `${pick(streets)}\n${pick(cities)}`,
                notes: isVip ? pick(["VIP customer — priority support", "Wholesale buyer", "Enterprise account"]) : (Math.random() > 0.7 ? pick(["Preferred shipping: FedEx", "Tax exempt", ""]) : null),
                created_at: randomDate(180, 10),
                updated_at: randomDate(30, 0)
            });
        }
        await db.insert(customers).values(customerValues);

        // ── Products ──────────────────────────────────────────────────
        console.log("📦 Generating demo products...");

        // Map product image paths to the static seed-asset files (already copied above).
        // The filenames in seed-assets use an md5(hashSalt + path)[0:5]_filename pattern.
        // NOTE: IMAGE_HASH_SALT is a legacy string kept ONLY so that the md5 hashes
        // continue to match the pre-existing seed-asset filenames on disk. It is NOT
        // a live URL — nothing is ever fetched from this address.
        const IMAGE_HASH_SALT = "https://firebasestorage.googleapis.com/v0/b/firecms-demo-27150.appspot.com/o/";
        for (const p of demoProducts) {
            const localPaths: string[] = [];
            for (const imgUrl of p.imageUrls) {
                const hashInput = `${IMAGE_HASH_SALT}${encodeURIComponent(imgUrl)}?alt=media`;
                const filename = imgUrl.split("/").pop() || "image.jpg";
                const id = createHash("md5").update(hashInput).digest("hex").substring(0, 5);
                const localName = `${id}_${filename}`;
                // Reference the file whether it exists or not — it should be in seed-assets
                localPaths.push(`product_images/${localName}`);
            }
            p.localImages = localPaths.length > 0 ? localPaths : null;
        }

        const allProducts = demoProducts;

        const productValues = allProducts.map((p, i) => ({
            id: productIds[i],
            name: p.name,
            sku: p.sku,
            description: p.desc,
            brand: p.brand,
            available_locales: p.locales,
            category: p.cat,
            price: p.price.toFixed(2),
            compare_at_price: Math.random() > 0.7 ? (p.price * (1.1 + Math.random() * 0.4)).toFixed(2) : null,
            cost: p.cost.toFixed(2),
            stock_quantity: String(Math.floor(Math.random() * 200) + 5),
            low_stock_threshold: String(Math.floor(Math.random() * 15) + 5),
            weight_grams: String(p.weight),
            rating: String((3.5 + Math.random() * 1.5).toFixed(1)),
            review_count: String(Math.floor(Math.random() * 500) + 1),
            status: "active" as (typeof productsStatus.enumValues)[number],
            is_featured: Math.random() > 0.8,
            images: p.localImages,
            created_at: randomDate(180, 10),
            updated_at: randomDate(30, 0)
        }));
        await db.insert(products).values(productValues);

        console.log("📦 Generating product locales subcollections...");
        const productLocalesValues: { id: string; product_id: string; locale: ProductLocale; name: string; description: string }[] = [];
        allProducts.forEach((p, i) => {
            const pid = productIds[i];
            const locales = p.locales || ["en"];
            for (const locale of locales) {
                productLocalesValues.push({
                    id: generateUUID("locale", productLocalesValues.length),
                    product_id: pid,
                    locale: locale,
                    name: p.name + ` (${locale.toUpperCase()})`,
                    description: p.desc
                });
            }
        });
        for (let i = 0; i < productLocalesValues.length; i += 100) {
            await db.insert(productLocales).values(productLocalesValues.slice(i, i + 100));
        }

        // ── Orders + Order Items ──────────────────────────────────────
        const NUM_ORDERS = 80;
        console.log(`🛒 Generating ${NUM_ORDERS} orders with line items...`);
        type OrderStatus = (typeof ordersStatus.enumValues)[number];
        type PaymentStatus = (typeof ordersPayment_status.enumValues)[number];
        type Currency = (typeof ordersCurrency.enumValues)[number];
        const orderStatuses: OrderStatus[] = ["pending", "confirmed", "processing", "shipped", "delivered", "delivered", "delivered", "cancelled", "refunded"];
        const paymentStatuses: PaymentStatus[] = ["unpaid", "paid", "paid", "paid", "paid", "partially_refunded", "refunded"];
        const currencies: Currency[] = ["USD", "USD", "USD", "EUR", "GBP", "CAD"];
        const carriers = ["UPS", "FedEx", "USPS", "DHL"];
        const orderValues = [];
        const allOrderItems: { id: string; order_id: string; product_id: string; product_name: string; sku: string; quantity: string; unit_price: string; line_total: string }[] = [];

        for (let i = 1; i <= NUM_ORDERS; i++) {
            const status = pick([...orderStatuses]);
            const isDelivered = status === "delivered";
            const isShipped = status === "shipped" || isDelivered;
            const isCancelled = status === "cancelled" || status === "refunded";
            const payStatus: PaymentStatus = isCancelled ? (status === "refunded" ? "refunded" : "paid") : pick([...paymentStatuses]);

            // Pick 1-5 products for this order
            const numItems = 1 + Math.floor(Math.random() * 4);
            const orderProductIndices = new Set<number>();
            while (orderProductIndices.size < numItems) {
                orderProductIndices.add(Math.floor(Math.random() * allProducts.length));
            }

            let subtotal = 0;
            for (const pIdx of orderProductIndices) {
                const prod = allProducts[pIdx];
                const qty = 1 + Math.floor(Math.random() * 3);
                const lineTotal = prod.price * qty;
                subtotal += lineTotal;
                allOrderItems.push({
                    id: generateUUID("orderitem", allOrderItems.length),
                    order_id: orderIds[i - 1],
                    product_id: productIds[pIdx],
                    product_name: prod.name,
                    sku: prod.sku,
                    quantity: String(qty),
                    unit_price: prod.price.toFixed(2),
                    line_total: lineTotal.toFixed(2)
                });
            }

            const taxRate = 0.08 + Math.random() * 0.04;
            const taxAmount = subtotal * taxRate;
            const shippingCost = subtotal > 100 ? 0 : 9.99 + Math.random() * 10;
            const discountAmount = Math.random() > 0.7 ? subtotal * (0.05 + Math.random() * 0.15) : 0;
            const total = subtotal + taxAmount + shippingCost - discountAmount;

            const orderDate = randomDate(30, 0);
            const shippedDate = isShipped ? new Date(new Date(orderDate).getTime() + (1 + Math.random() * 3) * 86400000).toISOString() : null;
            const deliveredDate = isDelivered && shippedDate ? new Date(new Date(shippedDate).getTime() + (2 + Math.random() * 5) * 86400000).toISOString() : null;
            const custId = Math.floor(Math.random() * 40) + 1;

            orderValues.push({
                id: orderIds[i - 1],
                order_number: `ORD-${currentYear()}-${String(i).padStart(4, "0")}`,
                customer_id: customerIds[custId - 1],
                status,
                payment_status: payStatus,
                subtotal: subtotal.toFixed(2),
                tax_amount: taxAmount.toFixed(2),
                shipping_cost: shippingCost.toFixed(2),
                discount_amount: discountAmount > 0 ? discountAmount.toFixed(2) : "0",
                total: total.toFixed(2),
                currency: pick([...currencies]),
                shipping_address: customerValues[(custId - 1)].shipping_address,
                tracking_number: isShipped ? `${pick(carriers)}-${String(Math.floor(Math.random() * 9000000000) + 1000000000)}` : null,
                notes: Math.random() > 0.8 ? pick(["Gift wrap requested", "Leave at front door", "Fragile items", "Rush order", ""]) : null,
                order_date: orderDate,
                shipped_date: shippedDate,
                delivered_date: deliveredDate,
                created_at: orderDate,
                updated_at: randomDate(10, 0)
            });
        }

        for (let i = 0; i < orderValues.length; i += BATCH) {
            await db.insert(orders).values(orderValues.slice(i, i + BATCH));
        }
        for (let i = 0; i < allOrderItems.length; i += BATCH) {
            await db.insert(orderItems).values(allOrderItems.slice(i, i + BATCH));
        }
        console.log(`  ✅ ${NUM_ORDERS} orders, ${allOrderItems.length} line items`);

        // ── Tickets ───────────────────────────────────────────────────
        const NUM_TICKETS = 60;
        console.log(`🎫 Generating ${NUM_TICKETS} support tickets...`);

        type TicketStatus = (typeof ticketsStatus.enumValues)[number];
        type TicketPriority = (typeof ticketsPriority.enumValues)[number];
        type TicketCategory = (typeof ticketsCategory.enumValues)[number];
        const ticketSubjects: { subject: string; description: string; category: TicketCategory; priority: TicketPriority }[] = [
            // Bug reports
            { subject: "Checkout page freezes on mobile", description: "When I try to complete my purchase on an iPhone 13, the page freezes after entering my credit card details. I've tried Safari and Chrome with the same result. Please help, I really want to buy the camping tent.", category: "bug", priority: "high" },
            { subject: "Promo code SAVE20 not working", description: "I'm trying to use the SAVE20 promo code from your email newsletter, but it says 'Invalid code' when applied to my cart. I only have the Sony headphones in my cart. Is there a restriction?", category: "bug", priority: "medium" },
            { subject: "Can't add items to wishlist", description: "Clicking the heart icon on any product page does nothing. I am logged into my account but my wishlist remains empty. I'm using Chrome on Windows 11.", category: "bug", priority: "low" },
            { subject: "Wrong product image showing", description: "The product image for the 'Merino V-Neck Sweater' in Navy actually shows the Charcoal color. It's confusing and I want to make sure I'm ordering the right color.", category: "bug", priority: "low" },
            { subject: "Shipping calculator is broken", description: "The estimated shipping calculator in the cart keeps saying 'Unable to calculate' for my zip code (90210). It worked fine last week.", category: "bug", priority: "medium" },
            { subject: "Password reset link is expired instantly", description: "Every time I request a password reset email, the link says it's already expired as soon as I click it. I can't get back into my account.", category: "bug", priority: "high" },
            { subject: "Search returns no results for existing products", description: "When I search for 'headphones' or 'keyboard' the search page says 'No results found' even though I can see those products when browsing categories.", category: "bug", priority: "medium" },
            { subject: "Order confirmation email not received", description: "I placed an order 3 hours ago and still haven't received a confirmation email. I've checked spam. My email is correct in my account settings.", category: "bug", priority: "medium" },
            { subject: "Product reviews not loading", description: "The reviews section on every product page just shows a spinning loader that never finishes. I've tried multiple browsers and cleared cache.", category: "bug", priority: "low" },
            { subject: "Dark mode breaks product gallery", description: "When I switch to dark mode, the product image gallery overlaps with the price section and the zoom feature stops working entirely.", category: "bug", priority: "low" },
            { subject: "Cart quantity won't update", description: "I'm trying to change the quantity of the yoga mat from 1 to 2, but the quantity field resets back to 1 every time I click the + button.", category: "bug", priority: "medium" },
            { subject: "Filtering by price range shows wrong products", description: "I set the price filter to $50-$100 but I'm seeing products that cost $200+. The filter UI shows the correct range but the results are wrong.", category: "bug", priority: "low" },

            // Feature requests
            { subject: "Please add Apple Pay", description: "It would be so much faster to checkout if you supported Apple Pay or Google Pay. Typing in credit card numbers on mobile is a hassle.", category: "feature_request", priority: "medium" },
            { subject: "Option to save multiple addresses", description: "I frequently buy gifts for family members. It would be great if I could save their addresses in an address book rather than typing them out every time.", category: "feature_request", priority: "low" },
            { subject: "Notify when back in stock", description: "I really want the Keychron keyboard but it's sold out. Can you add a feature to email me when it comes back in stock?", category: "feature_request", priority: "medium" },
            { subject: "Detailed sizing charts needed", description: "The clothing items really need detailed measurements instead of just S/M/L. Knowing the chest and length measurements would reduce returns.", category: "feature_request", priority: "low" },
            { subject: "Add a gift wrapping option at checkout", description: "I buy a lot of gifts here and would love the option to add gift wrapping and a personalized note during checkout. I'd happily pay extra for it.", category: "feature_request", priority: "low" },
            { subject: "Subscription / auto-reorder for consumables", description: "I buy the same coffee beans and protein bars every month. A subscribe-and-save option with a small discount would be amazing.", category: "feature_request", priority: "medium" },
            { subject: "Compare products side by side", description: "When choosing between the Sony and Bose headphones, it would be super helpful to compare specs side by side on one page.", category: "feature_request", priority: "low" },
            { subject: "Add order tracking page with map", description: "It would be great to have a visual map showing where my package is in real-time, similar to what Amazon and DoorDash provide.", category: "feature_request", priority: "low" },

            // Questions
            { subject: "When will the Keychron Q1 Pro be back in stock?", description: "I've been checking every day for the Keychron Q1 Pro Keyboard. Do you have an ETA on the next restock?", category: "question", priority: "low" },
            { subject: "Do the leather boots run true to size?", description: "I'm interested in the Leather Chelsea Boots but I'm normally between sizes. Should I size up or down? Do they stretch over time?", category: "question", priority: "medium" },
            { subject: "Can I change the shipping address on my order?", description: "I just placed order ORD-2025-0042 but realized it has my old apartment number. Can this be updated before it ships?", category: "question", priority: "urgent" },
            { subject: "International return policy?", description: "I'm ordering from Canada. If the jacket doesn't fit, do I have to pay for return shipping? How long do I have to return it?", category: "question", priority: "medium" },
            { subject: "Are the ceramic pots frost-proof?", description: "I want to keep the Ceramic Plant Pot Set outside on my patio during winter. Will they crack if the temperature drops below freezing?", category: "question", priority: "low" },
            { subject: "Warranty on the RC Drone?", description: "Does the RC Drone with 4K Camera come with a manufacturer's warranty? What does it cover if I crash it?", category: "question", priority: "medium" },
            { subject: "Is the coffee ethically sourced?", description: "I care about fair trade practices. Can you tell me if the Ethiopian Yirgacheffe beans are certified fair trade or direct trade?", category: "question", priority: "low" },
            { subject: "Do you offer bulk or wholesale pricing?", description: "I run a small office and would like to order 20 stainless steel water bottles for my team. Is there a bulk discount available?", category: "question", priority: "medium" },
            { subject: "How do I care for the cast iron dutch oven?", description: "I just received the enameled cast iron dutch oven. Do I need to season it like regular cast iron? Can it go in the dishwasher?", category: "question", priority: "low" },
            { subject: "Do you ship to PO boxes?", description: "I live in a rural area and only have a PO box. Will you ship larger items like the standing desk mat to a PO box address?", category: "question", priority: "low" },

            // Billing issues
            { subject: "Double charged for my recent order", description: "I placed an order yesterday and got an error on the first attempt, so I tried again. Now I see two pending charges of $149 on my credit card. Please cancel one of them.", category: "billing", priority: "high" },
            { subject: "Haven't received refund for returned item", description: "I returned the standing desk mat two weeks ago. Tracking shows you received it last Tuesday, but I still haven't seen the refund on my credit card. Order #ORD-2025-0015.", category: "billing", priority: "high" },
            { subject: "Invoice request for business purchase", description: "I bought the MacBook Pro and need a formal VAT invoice for my company's accounting department. The standard email receipt doesn't include our company VAT number.", category: "billing", priority: "medium" },
            { subject: "Wrong tax amount charged", description: "I was charged sales tax on my order, but my state has a tax holiday this week for clothing items under $100. The merino sweater should have been tax-free.", category: "billing", priority: "medium" },
            { subject: "Partial refund amount seems incorrect", description: "I returned 2 of the 3 items from my order but the refund amount doesn't match. I was refunded $45 but the two items totaled $78. Can you check?", category: "billing", priority: "high" },
            { subject: "Gift card balance disappeared", description: "I had a $50 gift card balance on my account. I didn't use it on my last order, but now it shows $0. Can you look into what happened?", category: "billing", priority: "medium" },
            { subject: "Currency conversion fee was unexpected", description: "I'm in the UK and paid in GBP, but my bank shows an extra currency conversion fee. Shouldn't the GBP price be final?", category: "billing", priority: "low" },

            // Account issues
            { subject: "Can't log into my account", description: "I'm getting an 'Invalid credentials' error but I'm 100% sure the password is correct. I use a password manager. Could my account have been locked?", category: "account", priority: "high" },
            { subject: "Please delete my account and data", description: "I am requesting that you delete my customer account and all associated personal data from your systems in accordance with data privacy laws.", category: "account", priority: "medium" },
            { subject: "Email address update", description: "I no longer have access to the email address associated with my account. Can I change it to my new email without losing my order history?", category: "account", priority: "low" },
            { subject: "Two-factor authentication not working", description: "The authenticator app codes keep being rejected when I try to log in. I've verified the time is synced on my phone. Am I locked out?", category: "account", priority: "high" },
            { subject: "Merge my duplicate accounts", description: "I accidentally created two accounts with different emails. Can you merge them so all my order history is in one place?", category: "account", priority: "low" },
            { subject: "Someone placed an order on my account", description: "I just got a confirmation email for an order I didn't place. The shipping address isn't mine. I think my account was compromised.", category: "account", priority: "urgent" },

            // Other
            { subject: "Package shows delivered but I didn't receive it", description: "FedEx tracking says my package was delivered to the front porch yesterday at 3 PM, but there is nothing there. I've checked with my neighbors. What should I do?", category: "other", priority: "urgent" },
            { subject: "Wrong item received in my order", description: "I ordered the Single Origin Coffee Beans, but I received the Organic Matcha Powder instead. How can we get this exchanged?", category: "other", priority: "high" },
            { subject: "Arrived damaged", description: "The French Press coffee maker arrived shattered in the box. There wasn't enough bubble wrap. I have photos of the damage.", category: "other", priority: "high" },
            { subject: "Cancel my order", description: "I placed an order an hour ago but changed my mind. Please cancel order ORD-2025-0089 before it ships out.", category: "other", priority: "urgent" },
            { subject: "Package stuck in transit for 10 days", description: "My tracking number hasn't updated since May 1st. It just says 'In Transit' with no estimated delivery. The order was supposed to arrive last week.", category: "other", priority: "high" },
            { subject: "Missing item from my order", description: "My order had 4 items but only 3 were in the box. The packing slip shows all 4 but the resistance band set is missing.", category: "other", priority: "high" },
            { subject: "Received someone else's order", description: "The package had my name and address on it, but inside was a LEGO set and a puzzle I never ordered. My actual items are missing.", category: "other", priority: "medium" },
            { subject: "Request for expedited shipping upgrade", description: "I placed order ORD-2025-0067 with standard shipping but I now need it by Friday for a birthday. Can I upgrade to express and pay the difference?", category: "other", priority: "medium" },
            { subject: "Product arrived with missing accessories", description: "The Keychron Q1 Pro arrived but the keycap puller and extra switches mentioned in the description were not in the box.", category: "other", priority: "medium" },
            { subject: "Complaint about packaging waste", description: "My order of a small bottle of matcha came in an enormous box with excessive plastic filling. Please consider more eco-friendly packaging options.", category: "other", priority: "low" },
            { subject: "How to return without original packaging?", description: "I want to return the overcoat but I already threw away the original shipping box. Can I use my own box? Do I need the tags still attached?", category: "other", priority: "low" },
            { subject: "Delivery left in the rain", description: "The carrier left my package on the doorstep during a rainstorm with no protection. The outer box is soaked and the books inside have water damage.", category: "other", priority: "high" },
        ];

        const agentNames = ["Alex Rivera", "Sam Chen", "Jordan Park", "Morgan Lee", "Casey Brooks", null, null];
        const ticketStatuses: TicketStatus[] = ["open", "open", "in_progress", "in_progress", "waiting", "resolved", "resolved", "closed", "closed"];

        const ticketValues = [];
        for (let i = 0; i < NUM_TICKETS; i++) {
            const template = ticketSubjects[i % ticketSubjects.length];
            const status = pick([...ticketStatuses]);
            const createdAt = randomDate(14, 0);
            const hasCustomer = Math.random() > 0.15; // 85% have a customer linked

            const resolutionNotes = (status === "resolved" || status === "closed")
                ? pick([
                    "## Resolution\n\nIssue was resolved by updating the customer's account settings.\n\n**Root cause:** Stale session token after password change.",
                    "## Fixed\n\nApplied a refund to the customer's payment method.\n\n**Timeline:**\n1. Investigated on day 1\n2. Escalated to billing\n3. Refund processed within 24h",
                    "## Resolved\n\nProvided the customer with detailed instructions and confirmed the issue is no longer reproducible.\n\n> Customer confirmed via email that everything works now.",
                    "## Closed\n\nDuplicate of TK-" + currentYear() + "-0001. Merged and closed.",
                    null
                ])
                : null;
            ticketValues.push({
                id: ticketIds[i],
                ticket_number: `TK-${currentYear()}-${String(i + 1).padStart(4, "0")}`,
                subject: template.subject,
                description: template.description,
                resolution_notes: resolutionNotes,
                status,
                priority: template.priority,
                category: template.category,
                customer_id: hasCustomer ? customerIds[Math.floor(Math.random() * 40)] : null,
                assigned_to: status === "open" && Math.random() > 0.5 ? null : pick(agentNames),
                __order: orderKey(i),
                created_at: createdAt,
                updated_at: status === "open" ? createdAt : randomDate(7, 0)
            });
        }

        for (let i = 0; i < ticketValues.length; i += BATCH) {
            await db.insert(tickets).values(ticketValues.slice(i, i + BATCH));
        }
        console.log(`  ✅ ${NUM_TICKETS} support tickets`);

        // ── 6. Exercises ──────────────────────────────────────────────
        console.log("\n🏋️ Seeding exercises...");
        const exerciseImagePaths = await seedAssets("exercise_images", "exercise_images/");

        type ExerciseDifficulty = (typeof exercisesDifficulty.enumValues)[number];
        type ExerciseCategory = (typeof exercisesCategory.enumValues)[number];
        type ExerciseStatus = (typeof exercisesStatus.enumValues)[number];
        const exerciseData: Array<{
            name: string; description: string; difficulty: ExerciseDifficulty; category: ExerciseCategory;
            equipment: string[]; body_parts: string[]; instructions: string;
            default_reps: number | null; default_sets: number; rest_seconds: number;
            calories_per_minute: number; is_compound: boolean; is_featured: boolean;
            status: ExerciseStatus; image_file?: string; video_url?: string;
        }> = [
            {
                name: "Barbell Bench Press",
                description: "The king of chest exercises. The flat barbell bench press is a compound movement that primarily targets the pectoralis major, with secondary engagement of the anterior deltoids and triceps.",
                difficulty: "intermediate", category: "strength",
                equipment: ["barbell", "bench"],
                body_parts: ["chest", "shoulders", "triceps"],
                instructions: "## Setup\n1. Lie flat on a bench with feet firmly on the floor\n2. Grip the barbell slightly wider than shoulder-width\n3. Unrack the bar and hold it above your chest\n\n## Execution\n1. Lower the bar slowly to your mid-chest\n2. Touch your chest lightly without bouncing\n3. Press the bar back up explosively to the starting position\n4. Keep your shoulder blades retracted throughout\n\n> **Tip:** Maintain a slight arch in your lower back for stability.",
                default_reps: 8, default_sets: 4, rest_seconds: 90, calories_per_minute: 7,
                is_compound: true, is_featured: true, status: "published", image_file: "bench_press.png",
                video_url: "https://www.youtube.com/watch?v=rT7DgCr-3pg"
            },
            {
                name: "Barbell Back Squat",
                description: "The fundamental lower body exercise. Back squats build overall leg strength and size, targeting quads, glutes, and hamstrings while engaging the core for stabilization.",
                difficulty: "intermediate", category: "strength",
                equipment: ["barbell"],
                body_parts: ["quads", "glutes", "hamstrings", "lower_back", "abs"],
                instructions: "## Setup\n1. Position the barbell on your upper traps\n2. Stand with feet shoulder-width apart, toes slightly out\n3. Brace your core and unrack the bar\n\n## Execution\n1. Initiate the movement by pushing your hips back\n2. Descend until your thighs are at least parallel to the floor\n3. Drive through your heels to stand back up\n4. Keep your chest up and knees tracking over your toes\n\n> **Tip:** Aim for depth — hip crease below the knee for full ROM.",
                default_reps: 6, default_sets: 4, rest_seconds: 120, calories_per_minute: 9,
                is_compound: true, is_featured: true, status: "published", image_file: "squat.png",
                video_url: "https://www.youtube.com/watch?v=ultWZbUMPL8"
            },
            {
                name: "Conventional Deadlift",
                description: "The ultimate posterior chain builder. Deadlifts develop raw pulling strength across the back, glutes, and hamstrings, making it one of the most functional lifts.",
                difficulty: "advanced", category: "strength",
                equipment: ["barbell"],
                body_parts: ["lower_back", "upper_back", "glutes", "hamstrings", "forearms"],
                instructions: "## Setup\n1. Stand with feet hip-width apart, bar over mid-foot\n2. Hinge at the hips and grip the bar just outside your knees\n3. Drop your hips, lift your chest, and pull the slack out of the bar\n\n## Execution\n1. Drive through your feet and extend your hips and knees simultaneously\n2. Keep the bar close to your body throughout\n3. Lock out at the top with hips fully extended\n4. Lower the bar under control back to the floor\n\n> **Tip:** Never round your lower back. Think \"push the floor away\" rather than \"pull the bar up.\"",
                default_reps: 5, default_sets: 3, rest_seconds: 180, calories_per_minute: 10,
                is_compound: true, is_featured: true, status: "published", image_file: "deadlift.png"
            },
            {
                name: "Pull-Up",
                description: "A bodyweight staple for building a wide, V-shaped back. Pull-ups target the latissimus dorsi, biceps, and forearms with unmatched efficiency.",
                difficulty: "intermediate", category: "calisthenics",
                equipment: ["pull_up_bar"],
                body_parts: ["upper_back", "biceps", "forearms", "shoulders"],
                instructions: "## Setup\n1. Hang from a pull-up bar with an overhand grip, slightly wider than shoulder-width\n2. Engage your lats and retract your shoulder blades\n\n## Execution\n1. Pull yourself up until your chin clears the bar\n2. Squeeze your back muscles at the top\n3. Lower yourself under control to a full dead hang\n4. Avoid swinging or kipping\n\n> **Tip:** If you can't do full pull-ups, start with negatives (slow lowering phase).",
                default_reps: 8, default_sets: 3, rest_seconds: 90, calories_per_minute: 8,
                is_compound: true, is_featured: true, status: "published", image_file: "pullup.png"
            },
            {
                name: "Forearm Plank",
                description: "The gold standard of core stability. Planks build isometric endurance in the entire anterior chain — abs, obliques, and hip flexors — while also engaging the shoulders and lower back.",
                difficulty: "beginner", category: "calisthenics",
                equipment: ["none"],
                body_parts: ["abs", "obliques", "lower_back", "shoulders"],
                instructions: "## Setup\n1. Place your forearms on the floor, elbows directly below shoulders\n2. Extend your legs back, toes on the ground\n\n## Execution\n1. Lift your body into a straight line from head to heels\n2. Brace your core as if bracing for a punch\n3. Hold for the prescribed time\n4. Don't let your hips sag or pike up\n\n> **Tip:** Squeeze your glutes and quads for extra stability.",
                default_reps: null, default_sets: 3, rest_seconds: 60, calories_per_minute: 4,
                is_compound: false, is_featured: false, status: "published", image_file: "plank.png"
            },
            {
                name: "Dumbbell Bicep Curl",
                description: "A classic isolation exercise for building bicep size and peak. The dumbbell variation allows for natural wrist rotation (supination) through the movement.",
                difficulty: "beginner", category: "strength",
                equipment: ["dumbbell"],
                body_parts: ["biceps", "forearms"],
                instructions: "## Setup\n1. Stand with a dumbbell in each hand, arms at your sides\n2. Palms facing forward, feet shoulder-width apart\n\n## Execution\n1. Curl the weights up by bending at the elbow\n2. Keep your upper arms stationary — no swinging\n3. Squeeze your biceps at the top\n4. Lower under control to full extension\n\n> **Tip:** Alternate arms or curl both simultaneously — both are effective.",
                default_reps: 12, default_sets: 3, rest_seconds: 60, calories_per_minute: 5,
                is_compound: false, is_featured: false, status: "published", image_file: "bicep_curl.png"
            },
            {
                name: "Walking Lunges",
                description: "A unilateral leg exercise that builds single-leg strength, balance, and coordination. Targets quads, glutes, and hip flexors while challenging stability.",
                difficulty: "beginner", category: "strength",
                equipment: ["dumbbell"],
                body_parts: ["quads", "glutes", "hamstrings", "hip_flexors", "calves"],
                instructions: "## Setup\n1. Stand tall holding dumbbells at your sides\n2. Feet hip-width apart\n\n## Execution\n1. Step forward with one leg into a deep lunge\n2. Lower your back knee toward the floor\n3. Push through the front heel and step the back leg forward into the next lunge\n4. Continue alternating legs\n\n> **Tip:** Keep your torso upright and core braced throughout.",
                default_reps: 12, default_sets: 3, rest_seconds: 60, calories_per_minute: 6,
                is_compound: true, is_featured: false, status: "published", image_file: "lunges.png"
            },
            {
                name: "Overhead Shoulder Press",
                description: "A foundational pressing movement for building strong, capped deltoids. The standing variation also requires significant core stabilization.",
                difficulty: "intermediate", category: "strength",
                equipment: ["barbell"],
                body_parts: ["shoulders", "triceps", "upper_back", "abs"],
                instructions: "## Setup\n1. Grip the barbell at shoulder width, resting it on your front deltoids\n2. Stand with feet shoulder-width apart, core braced\n\n## Execution\n1. Press the bar overhead in a straight line\n2. Push your head through once the bar passes your forehead\n3. Lock out at the top with arms fully extended\n4. Lower the bar under control back to your shoulders\n\n> **Tip:** Avoid excessive back lean — if you need to lean, the weight is too heavy.",
                default_reps: 8, default_sets: 4, rest_seconds: 90, calories_per_minute: 6,
                is_compound: true, is_featured: true, status: "published", image_file: "shoulder_press.png"
            },
            {
                name: "Romanian Deadlift",
                description: "A hip-hinge variation that isolates the hamstrings and glutes through an eccentric-focused stretch under load.",
                difficulty: "intermediate", category: "strength",
                equipment: ["barbell"],
                body_parts: ["hamstrings", "glutes", "lower_back"],
                instructions: "## Setup\n1. Hold a barbell at hip height with an overhand grip\n2. Feet hip-width apart, slight bend in the knees\n\n## Execution\n1. Push your hips back while lowering the bar along your legs\n2. Keep the bar close to your shins\n3. Lower until you feel a deep stretch in your hamstrings\n4. Drive your hips forward to return to standing\n\n> **Tip:** This is NOT a squat — minimal knee bend, maximal hip hinge.",
                default_reps: 10, default_sets: 3, rest_seconds: 90, calories_per_minute: 7,
                is_compound: true, is_featured: false, status: "published", image_file: "romanian_deadlift.png"
            },
            {
                name: "Dumbbell Lateral Raise",
                description: "An isolation exercise targeting the medial deltoid, essential for building shoulder width and the \"capped\" shoulder look.",
                difficulty: "beginner", category: "strength",
                equipment: ["dumbbell"],
                body_parts: ["shoulders"],
                instructions: "## Setup\n1. Stand with a light dumbbell in each hand at your sides\n\n## Execution\n1. Raise both arms out to the sides until parallel with the floor\n2. Lead with your elbows, slight bend in the arms\n3. Pause at the top for a one-second squeeze\n4. Lower slowly — don't just drop them\n\n> **Tip:** Use lighter weight with strict form. Momentum defeats the purpose.",
                default_reps: 15, default_sets: 3, rest_seconds: 45, calories_per_minute: 4,
                is_compound: false, is_featured: false, status: "published", image_file: "lateral_raise.png"
            },
            {
                name: "Barbell Row",
                description: "A horizontal pulling movement that builds thickness in the mid-back, lats, and rear deltoids.",
                difficulty: "intermediate", category: "strength",
                equipment: ["barbell"],
                body_parts: ["upper_back", "biceps", "forearms", "lower_back"],
                instructions: "## Setup\n1. Hinge forward at the hips, holding a barbell with an overhand grip\n2. Back flat, chest up, knees slightly bent\n\n## Execution\n1. Pull the bar toward your lower chest / upper abdomen\n2. Squeeze your shoulder blades together at the top\n3. Lower the bar under control\n\n> **Tip:** Aim for a 45-degree torso angle for best lat activation.",
                default_reps: 8, default_sets: 4, rest_seconds: 90, calories_per_minute: 7,
                is_compound: true, is_featured: false, status: "published", image_file: "barbell_row.png"
            },
            {
                name: "Tricep Dips",
                description: "A bodyweight pressing exercise emphasizing the triceps. Can be performed on parallel bars or a bench.",
                difficulty: "intermediate", category: "calisthenics",
                equipment: ["none"],
                body_parts: ["triceps", "chest", "shoulders"],
                instructions: "## Setup\n1. Grip parallel dip bars and support yourself with straight arms\n\n## Execution\n1. Lower your body by bending your elbows until upper arms are parallel to the floor\n2. Keep elbows close to your body for tricep focus\n3. Press back up to full lockout\n\n> **Tip:** Lean slightly forward for more chest engagement, stay upright for tricep focus.",
                default_reps: 10, default_sets: 3, rest_seconds: 90, calories_per_minute: 7,
                is_compound: true, is_featured: false, status: "published", image_file: "tricep_dips.png"
            },
            {
                name: "Kettlebell Swing",
                description: "An explosive hip-hinge movement that builds power, cardiovascular endurance, and posterior chain strength.",
                difficulty: "intermediate", category: "cardio",
                equipment: ["kettlebell"],
                body_parts: ["glutes", "hamstrings", "lower_back", "shoulders", "abs"],
                instructions: "## Setup\n1. Stand with feet slightly wider than shoulder-width\n2. Hold a kettlebell with both hands in front of you\n\n## Execution\n1. Hinge at the hips and swing the kettlebell between your legs\n2. Explosively drive your hips forward to swing the bell to chest height\n3. Let the bell swing back down and repeat\n4. Power comes from the HIPS, not the arms\n\n> **Tip:** At the top, your body should form a straight line — glutes squeezed, core tight.",
                default_reps: 15, default_sets: 4, rest_seconds: 60, calories_per_minute: 12,
                is_compound: true, is_featured: true, status: "published", image_file: "kettlebell_swing.png"
            },
            {
                name: "Cable Face Pull",
                description: "A corrective and hypertrophy exercise for the rear deltoids and rotator cuff. Essential for shoulder health and posture.",
                difficulty: "beginner", category: "strength",
                equipment: ["cable_machine"],
                body_parts: ["shoulders", "upper_back"],
                instructions: "## Setup\n1. Set a cable pulley to upper chest height with a rope attachment\n\n## Execution\n1. Pull the rope toward your face, splitting the ends past your ears\n2. Externally rotate your shoulders at the end position\n3. Squeeze your rear delts and hold for one second\n4. Return under control\n\n> **Tip:** This is a prehab exercise — prioritize form over weight.",
                default_reps: 15, default_sets: 3, rest_seconds: 45, calories_per_minute: 3,
                is_compound: false, is_featured: false, status: "published", image_file: "face_pull.png"
            },
            {
                name: "Box Jump",
                description: "An explosive plyometric exercise for developing lower body power, fast-twitch muscle fibers, and athletic performance.",
                difficulty: "intermediate", category: "plyometrics",
                equipment: ["box"],
                body_parts: ["quads", "glutes", "calves", "hip_flexors"],
                instructions: "## Setup\n1. Stand facing a sturdy box, feet shoulder-width apart\n\n## Execution\n1. Swing your arms back and dip into a quarter squat\n2. Explode upward, jumping onto the box\n3. Land softly with both feet fully on the box\n4. Stand up tall, then step down (don't jump down)\n\n> **Tip:** Start with a lower box and progress gradually. Land quietly!",
                default_reps: 8, default_sets: 4, rest_seconds: 90, calories_per_minute: 10,
                is_compound: true, is_featured: false, status: "published", image_file: "box_jump.png"
            },
            {
                name: "Resistance Band Pull-Apart",
                description: "A simple but effective exercise for rear deltoid and scapular health. Great as a warm-up or high-rep finisher.",
                difficulty: "beginner", category: "strength",
                equipment: ["resistance_band"],
                body_parts: ["shoulders", "upper_back"],
                instructions: "## Setup\n1. Hold a resistance band at shoulder height with arms extended\n\n## Execution\n1. Pull the band apart by squeezing your shoulder blades together\n2. Keep arms straight throughout\n3. Return to the starting position slowly\n\n> **Tip:** Use a lighter band and do high reps (20+) for best results.",
                default_reps: 20, default_sets: 3, rest_seconds: 30, calories_per_minute: 3,
                is_compound: false, is_featured: false, status: "published", image_file: "band_pull_apart.png"
            },
            {
                name: "TRX Row",
                description: "A bodyweight rowing movement using suspension straps. Adjustable difficulty by changing your body angle.",
                difficulty: "beginner", category: "calisthenics",
                equipment: ["trx"],
                body_parts: ["upper_back", "biceps", "forearms", "abs"],
                instructions: "## Setup\n1. Hold TRX handles with arms extended, lean back\n2. Walk your feet forward to increase difficulty\n\n## Execution\n1. Pull your chest toward the handles\n2. Keep your body in a straight line\n3. Squeeze your shoulder blades at the top\n4. Lower yourself slowly to full arm extension\n\n> **Tip:** The more horizontal your body, the harder it gets.",
                default_reps: 12, default_sets: 3, rest_seconds: 60, calories_per_minute: 5,
                is_compound: true, is_featured: false, status: "published", image_file: "trx_row.png"
            },
            {
                name: "Standing Calf Raise",
                description: "An isolation exercise targeting the gastrocnemius and soleus muscles of the calves. Important for balanced leg development.",
                difficulty: "beginner", category: "strength",
                equipment: ["dumbbell"],
                body_parts: ["calves"],
                instructions: "## Setup\n1. Stand on the edge of a step or platform with heels hanging off\n2. Hold dumbbells at your sides for added resistance\n\n## Execution\n1. Rise up onto your toes as high as possible\n2. Hold the top position for 2 seconds\n3. Lower your heels below the platform for a full stretch\n\n> **Tip:** Slow eccentrics (3-second lowering) dramatically improve results.",
                default_reps: 15, default_sets: 4, rest_seconds: 45, calories_per_minute: 3,
                is_compound: false, is_featured: false, status: "published", image_file: "calf_raise.png"
            },
            {
                name: "Medicine Ball Slam",
                description: "A full-body explosive exercise that builds power and serves as high-intensity cardio. Great for stress relief too.",
                difficulty: "beginner", category: "plyometrics",
                equipment: ["medicine_ball"],
                body_parts: ["abs", "shoulders", "upper_back", "quads"],
                instructions: "## Setup\n1. Stand with feet shoulder-width apart holding a medicine ball overhead\n\n## Execution\n1. Brace your core and slam the ball into the ground as hard as possible\n2. Hinge at the hips and follow through\n3. Catch the ball on the bounce (or pick it up)\n4. Repeat with maximum intensity\n\n> **Tip:** Use a slam ball (dead bounce), not a standard medicine ball.",
                default_reps: 12, default_sets: 3, rest_seconds: 60, calories_per_minute: 11,
                is_compound: true, is_featured: false, status: "published", image_file: "med_ball_slam.png"
            },
            {
                name: "Pigeon Pose Stretch",
                description: "A deep hip opener that stretches the glutes, hip flexors, and piriformis. Essential for mobility and injury prevention.",
                difficulty: "beginner", category: "flexibility",
                equipment: ["none"],
                body_parts: ["glutes", "hip_flexors"],
                instructions: "## Setup\n1. Start in a high plank or all-fours position\n\n## Execution\n1. Bring your right knee forward and place it behind your right wrist\n2. Extend your left leg straight back\n3. Lower your hips toward the floor\n4. Hold for 30-60 seconds per side\n5. Keep your hips square to the floor\n\n> **Tip:** Place a yoga block under your hip if you can't reach the floor comfortably.",
                default_reps: null, default_sets: 2, rest_seconds: 0, calories_per_minute: 2,
                is_compound: false, is_featured: false, status: "draft", image_file: "pigeon_pose.png"
            },
            {
                name: "Burpee",
                description: "The ultimate full-body conditioning exercise. Burpees combine a squat, push-up, and explosive jump into one brutally effective movement.",
                difficulty: "intermediate", category: "cardio",
                equipment: ["none"],
                body_parts: ["quads", "chest", "shoulders", "abs", "glutes"],
                instructions: "## Setup\n1. Stand with feet shoulder-width apart\n\n## Execution\n1. Drop into a squat and place your hands on the floor\n2. Kick your feet back into a push-up position\n3. Perform a push-up\n4. Jump your feet back toward your hands\n5. Explode upward into a jump with arms overhead\n\n> **Tip:** For a scaled version, skip the push-up or step back instead of jumping.",
                default_reps: 10, default_sets: 3, rest_seconds: 60, calories_per_minute: 14,
                is_compound: true, is_featured: true, status: "published", image_file: "burpee.png"
            },
            {
                name: "Mountain Climbers",
                description: "A dynamic bodyweight exercise that elevates heart rate while strengthening the core, shoulders, and hip flexors.",
                difficulty: "beginner", category: "cardio",
                equipment: ["none"],
                body_parts: ["abs", "hip_flexors", "shoulders", "quads"],
                instructions: "## Setup\n1. Start in a high plank position with hands under shoulders\n\n## Execution\n1. Drive one knee toward your chest\n2. Quickly switch legs, extending the bent leg back\n3. Alternate rapidly in a running motion\n4. Keep your hips level — no bouncing\n\n> **Tip:** The faster you go, the more cardio benefit. Slow down for core focus.",
                default_reps: 20, default_sets: 3, rest_seconds: 45, calories_per_minute: 11,
                is_compound: true, is_featured: false, status: "published", image_file: "mountain_climber.png"
            },
            {
                name: "Russian Twist",
                description: "A rotational core exercise that targets the obliques and transverse abdominis. Excellent for building rotational power.",
                difficulty: "beginner", category: "strength",
                equipment: ["dumbbell"],
                body_parts: ["obliques", "abs", "hip_flexors"],
                instructions: "## Setup\n1. Sit on the floor with knees bent, feet elevated slightly\n2. Lean back to about 45 degrees, holding a weight at chest height\n\n## Execution\n1. Rotate your torso to touch the weight to the floor on one side\n2. Rotate through center to the other side\n3. Keep your core braced and back straight throughout\n\n> **Tip:** Don't rush — control the rotation for maximum oblique engagement.",
                default_reps: 20, default_sets: 3, rest_seconds: 45, calories_per_minute: 5,
                is_compound: false, is_featured: false, status: "published", image_file: "russian_twist.png"
            },
            {
                name: "Push-Up",
                description: "The foundational bodyweight upper-body exercise. Push-ups build chest, shoulder, and tricep strength with zero equipment needed.",
                difficulty: "beginner", category: "calisthenics",
                equipment: ["none"],
                body_parts: ["chest", "triceps", "shoulders", "abs"],
                instructions: "## Setup\n1. Place hands slightly wider than shoulder-width on the floor\n2. Extend legs back, body in a straight line\n\n## Execution\n1. Lower your chest toward the floor by bending your elbows\n2. Go until your chest is just above the ground\n3. Push back up to full arm extension\n4. Keep your core tight — no sagging hips\n\n> **Tip:** Elevate your hands on a bench to make it easier, or elevate your feet to make it harder.",
                default_reps: 15, default_sets: 3, rest_seconds: 60, calories_per_minute: 7,
                is_compound: true, is_featured: true, status: "published", image_file: "push_up.png"
            },
            {
                name: "Barbell Hip Thrust",
                description: "The most effective exercise for glute hypertrophy and strength. Hip thrusts produce peak glute activation unmatched by squats or deadlifts.",
                difficulty: "intermediate", category: "strength",
                equipment: ["barbell", "bench"],
                body_parts: ["glutes", "hamstrings", "quads"],
                instructions: "## Setup\n1. Sit on the floor with your upper back against a bench\n2. Roll a loaded barbell over your legs to your hip crease\n3. Plant feet flat, shoulder-width apart\n\n## Execution\n1. Drive through your heels to lift your hips\n2. Squeeze your glutes hard at the top\n3. Your shins should be vertical at full extension\n4. Lower under control and repeat\n\n> **Tip:** Use a barbell pad for comfort. Full hip extension at the top is critical.",
                default_reps: 10, default_sets: 4, rest_seconds: 90, calories_per_minute: 6,
                is_compound: true, is_featured: false, status: "published", image_file: "hip_thrust.png"
            },
            {
                name: "Farmer's Walk",
                description: "A loaded carry exercise that builds grip strength, core stability, and total-body conditioning. Simple but devastatingly effective.",
                difficulty: "beginner", category: "strength",
                equipment: ["dumbbell"],
                body_parts: ["forearms", "abs", "shoulders", "upper_back", "calves"],
                instructions: "## Setup\n1. Stand between two heavy dumbbells or kettlebells\n2. Deadlift them to your sides\n\n## Execution\n1. Stand tall with shoulders pulled back\n2. Walk in a straight line with controlled, even steps\n3. Keep your core braced and don't lean to either side\n4. Walk for distance (20-40m) or time (30-60s)\n\n> **Tip:** Go heavier than you think. Your grip will be the limiting factor.",
                default_reps: null, default_sets: 3, rest_seconds: 90, calories_per_minute: 8,
                is_compound: true, is_featured: false, status: "published", image_file: "farmers_walk.png"
            },
            {
                name: "Cable Woodchop",
                description: "A rotational movement that trains the obliques and core through a diagonal pulling pattern. Great for athletic performance.",
                difficulty: "intermediate", category: "strength",
                equipment: ["cable_machine"],
                body_parts: ["obliques", "abs", "shoulders"],
                instructions: "## Setup\n1. Set a cable pulley to the highest position\n2. Stand sideways to the machine, feet shoulder-width apart\n\n## Execution\n1. Grab the handle with both hands\n2. Pull diagonally across your body from high to low\n3. Rotate through your core — arms stay mostly straight\n4. Control the return to the starting position\n\n> **Tip:** The power comes from your core rotation, not your arms. Pivot on your back foot.",
                default_reps: 12, default_sets: 3, rest_seconds: 60, calories_per_minute: 5,
                is_compound: true, is_featured: false, status: "published", image_file: "cable_woodchop.png"
            },
            {
                name: "Goblet Squat",
                description: "A beginner-friendly squat variation that teaches perfect squat mechanics. The front-loaded weight naturally promotes an upright torso.",
                difficulty: "beginner", category: "strength",
                equipment: ["kettlebell"],
                body_parts: ["quads", "glutes", "abs"],
                instructions: "## Setup\n1. Hold a kettlebell or dumbbell at chest height with both hands\n2. Feet slightly wider than shoulder-width, toes slightly out\n\n## Execution\n1. Push your hips back and squat down\n2. Keep the weight close to your chest\n3. Go as deep as your mobility allows\n4. Drive through your heels to stand back up\n\n> **Tip:** Use your elbows to push your knees out at the bottom for better depth.",
                default_reps: 12, default_sets: 3, rest_seconds: 60, calories_per_minute: 7,
                is_compound: true, is_featured: false, status: "published", image_file: "goblet_squat.png"
            },
            {
                name: "Bulgarian Split Squat",
                description: "A single-leg squat variation with the rear foot elevated. Builds unilateral leg strength, balance, and addresses muscular imbalances.",
                difficulty: "intermediate", category: "strength",
                equipment: ["dumbbell", "bench"],
                body_parts: ["quads", "glutes", "hamstrings", "hip_flexors"],
                instructions: "## Setup\n1. Stand 2-3 feet in front of a bench\n2. Place one foot behind you on the bench, laces down\n3. Hold dumbbells at your sides\n\n## Execution\n1. Lower your back knee toward the floor\n2. Keep your front knee tracking over your toes\n3. Descend until your front thigh is parallel to the floor\n4. Push through your front heel to stand back up\n\n> **Tip:** The closer you stand to the bench, the more quad-dominant. Farther = more glute.",
                default_reps: 10, default_sets: 3, rest_seconds: 60, calories_per_minute: 7,
                is_compound: true, is_featured: false, status: "published"
            },
            {
                name: "Hanging Leg Raise",
                description: "An advanced core exercise performed hanging from a bar. Targets the lower abs and hip flexors with intense tension.",
                difficulty: "advanced", category: "calisthenics",
                equipment: ["pull_up_bar"],
                body_parts: ["abs", "obliques", "hip_flexors"],
                instructions: "## Setup\n1. Hang from a pull-up bar with an overhand grip\n2. Arms fully extended, shoulders engaged\n\n## Execution\n1. Keeping legs straight, raise them until they're parallel to the floor (or higher)\n2. Pause at the top and squeeze your abs\n3. Lower your legs slowly — don't swing\n4. Maintain a slight posterior pelvic tilt throughout\n\n> **Tip:** Bend your knees to make it easier. For a challenge, raise your toes to the bar.",
                default_reps: 10, default_sets: 3, rest_seconds: 60, calories_per_minute: 5,
                is_compound: false, is_featured: false, status: "published"
            }
        ];

        // Build a map from filename to storage path
        const exerciseImageMap: Record<string, string> = {};
        for (const p of exerciseImagePaths) {
            const filename = p.split("/").pop() || "";
            exerciseImageMap[filename] = p;
        }

        const exerciseValues = exerciseData.map((ex, i) => {
            const images = ex.image_file && exerciseImageMap[ex.image_file]
                ? [exerciseImageMap[ex.image_file]]
                : [];
            return {
                id: generateUUID("exercise", i),
                name: ex.name,
                description: ex.description,
                images: images.length > 0 ? images : null,
                video_url: ex.video_url || null,
                difficulty: ex.difficulty,
                category: ex.category,
                equipment: ex.equipment,
                body_parts: ex.body_parts,
                instructions: ex.instructions,
                default_reps: ex.default_reps != null ? String(ex.default_reps) : null,
                default_sets: String(ex.default_sets),
                rest_seconds: String(ex.rest_seconds),
                calories_per_minute: String(ex.calories_per_minute),
                is_compound: ex.is_compound,
                is_featured: ex.is_featured,
                status: ex.status,
                created_at: randomDate(90, 0),
                updated_at: randomDate(14, 0)
            };
        });

        await db.insert(exercises).values(exerciseValues);
        console.log(`  ✅ ${exerciseValues.length} exercises`);

        // ── Summary ───────────────────────────────────────────────────
        const statusCounts: Record<string, number> = {};
        postValues.forEach(p => { statusCounts[p.status] = (statusCounts[p.status] || 0) + 1; });

        const ticketStatusCounts: Record<string, number> = {};
        ticketValues.forEach(t => { ticketStatusCounts[t.status] = (ticketStatusCounts[t.status] || 0) + 1; });

        console.log("\n🎉 Database seeded successfully!");
        console.log(`   ${NUM_AUTHORS} authors, ${NUM_TAGS} tags, ${POST_COUNT} posts`);
        console.log(`   40 customers, ${allProducts.length} products, ${NUM_ORDERS} orders`);
        console.log(`   ${NUM_TICKETS} tickets, ${exerciseValues.length} exercises`);
        console.log(`   Post statuses: ${Object.entries(statusCounts).map(([k, v]) => `${k}=${v}`).join(", ")}`);
        console.log(`   Ticket statuses: ${Object.entries(ticketStatusCounts).map(([k, v]) => `${k}=${v}`).join(", ")}`);

    } catch (e) {
        console.error("❌ Error seeding database:", e);
    } finally {
        await pool.end();
    }
}

// Only self-invoke when executed directly as a CLI (`npx tsx src/seed.ts`),
// NOT when imported — the reset-demo cron imports runSeed and calls it itself.
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
    runSeed();
}
