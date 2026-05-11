/**
 * Single consolidated seed script for the Rebase demo.
 * Downloads images to local storage and seeds all collections.
 * Run with: npx tsx src/seed.ts
 */
import { createPostgresDatabaseConnection } from "@rebasepro/server-postgresql";
import { env } from "./env.js";
import {
    authors, posts, tags, products, orders,
    postsTags, customers, orderItems, tickets, productLocales
} from "./schema.generated.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";
import http from "http";
import { createHash } from "crypto";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.resolve(__dirname, "../../uploads/default");

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

// ── Image download helpers ────────────────────────────────────────────
function randomId(len = 5): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < len; i++) result += chars[Math.floor(Math.random() * chars.length)];
    return result;
}

function downloadFile(url: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const client = url.startsWith("https") ? https : http;
        client.get(url, { headers: { "User-Agent": "RebaseSeed/1.0" } }, (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return downloadFile(res.headers.location).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            const chunks: Buffer[] = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => resolve(Buffer.concat(chunks)));
            res.on("error", reject);
        }).on("error", reject);
    });
}

async function downloadAndStore(url: string, storagePath: string, filename: string): Promise<string> {
    const dir = path.join(UPLOADS_DIR, storagePath);
    fs.mkdirSync(dir, { recursive: true });
    const id = randomId();
    const localName = `${id}_${filename}`;
    const filePath = path.join(dir, localName);
    const metaPath = filePath + ".metadata.json";
    const relativePath = `${storagePath}${localName}`;

    if (fs.existsSync(filePath)) return relativePath;

    try {
        const data = await downloadFile(url);
        fs.writeFileSync(filePath, data);
        const ext = filename.split(".").pop()?.toLowerCase() ?? "jpg";
        const contentType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
        fs.writeFileSync(metaPath, JSON.stringify({
            contentType,
            size: data.length,
            uploadedAt: new Date().toISOString()
        }, null, 2));
        return relativePath;
    } catch (e) {
        console.warn(`  ⚠️ Failed to download ${url}: ${(e as Error).message}`);
        return relativePath;
    }
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

// ── Unsplash image URLs ───────────────────────────────────────────────
const heroImageUrls = [
    "https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=1200&q=80",
    "https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=1200&q=80",
    "https://images.unsplash.com/photo-1504639725590-34d0984388bd?w=1200&q=80",
    "https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&q=80",
    "https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&q=80",
    "https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=1200&q=80",
    "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=1200&q=80",
    "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=1200&q=80",
    "https://images.unsplash.com/photo-1487058792275-0ad4aaf24ca7?w=1200&q=80",
    "https://images.unsplash.com/photo-1550439062-609e1531270e?w=1200&q=80",
    "https://images.unsplash.com/photo-1605379399642-870262d3d051?w=1200&q=80",
    "https://images.unsplash.com/photo-1531297484001-80022131f5a1?w=1200&q=80",
    "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1200&q=80",
    "https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=1200&q=80",
    "https://images.unsplash.com/photo-1488590528505-98d2b5aba04b?w=1200&q=80",
    "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200&q=80",
    "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=1200&q=80",
    "https://images.unsplash.com/photo-1518770660439-4636190af475?w=1200&q=80",
    "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200&q=80",
    "https://images.unsplash.com/photo-1542831371-29b0f74f9713?w=1200&q=80"
];

const contentImageUrls = [
    "https://images.unsplash.com/photo-1587620962725-abab7fe55159?w=800&q=80",
    "https://images.unsplash.com/photo-1536104968055-4d61aa56f46a?w=800&q=80",
    "https://images.unsplash.com/photo-1516116216624-53e697fedbea?w=800&q=80",
    "https://images.unsplash.com/photo-1580894894513-541e068a3e2b?w=800&q=80",
    "https://images.unsplash.com/photo-1484417894907-623942c8ee29?w=800&q=80",
    "https://images.unsplash.com/photo-1534972195531-d756b9bfa9f2?w=800&q=80",
    "https://images.unsplash.com/photo-1629654297299-c8506221ca97?w=800&q=80",
    "https://images.unsplash.com/photo-1555949963-aa79dcee981c?w=800&q=80"
];

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
    console.log("🌱 Connecting to database...");
    const { db, pool } = createPostgresDatabaseConnection(env.DATABASE_URL, undefined, { max: 1 });

    const NUM_AUTHORS = 20;
    const NUM_TAGS = 30;
    const POST_COUNT = 150;

    try {
        // ── Download images to local storage ──────────────────────────
        console.log("📸 Downloading hero images to local storage...");
        const heroImagePaths: string[] = [];
        for (let i = 0; i < heroImageUrls.length; i++) {
            const p = await downloadAndStore(heroImageUrls[i], "posts/hero/", `hero_${i + 1}.jpg`);
            heroImagePaths.push(p);
            process.stdout.write(`  ✅ ${i + 1}/${heroImageUrls.length}\r`);
        }
        console.log(`  ✅ Downloaded ${heroImagePaths.length} hero images`);

        console.log("📸 Downloading content images to local storage...");
        const contentImagePaths: string[] = [];
        for (let i = 0; i < contentImageUrls.length; i++) {
            const p = await downloadAndStore(contentImageUrls[i], "posts/content/", `content_${i + 1}.jpg`);
            contentImagePaths.push(p);
        }
        console.log(`  ✅ Downloaded ${contentImagePaths.length} content images`);

        // ── Clear existing data ───────────────────────────────────────

        const require = createRequire(import.meta.url);
        const demoProductsRaw = require("./demo-products.json");

        const validCategories = ["electronics", "clothing", "home_garden", "sports", "books", "toys", "health_beauty"];
        function mapCategory(cat: string | undefined | null) {
            if (!cat) return validCategories[Math.floor(Math.random() * validCategories.length)];
            const c = cat.toLowerCase();
            if (c.includes('clothing') || c.includes('sunglasses')) return 'clothing';
            if (c.includes('home') || c.includes('kitchen') || c.includes('serveware')) return 'home_garden';
            if (c.includes('electronic') || c.includes('watch')) return 'electronics';
            if (c.includes('toy')) return 'toys';
            if (c.includes('health') || c.includes('beauty')) return 'health_beauty';
            return validCategories[Math.floor(Math.random() * validCategories.length)];
        }

        const firecmsDemoProducts = demoProductsRaw.map((p: any, index: number) => ({
            name: p.name || `Product ${index}`,
            sku: p.asin || `SKU-${Math.floor(Math.random()*100000)}`,
            cat: mapCategory(p.category),
            price: p.price || (10 + Math.random() * 90),
            cost: (p.price || 50) * 0.4,
            weight: 100 + Math.floor(Math.random() * 900),
            desc: p.description || "No description available.",
            brand: p.brand || "Generic",
            locales: p.available_locales || ["en"],
            imageUrls: p.images || (p.main_image ? [p.main_image] : [])
        }));

        const authorIds = Array.from({ length: NUM_AUTHORS }, (_, i) => generateUUID("author", i));
        const tagIds = Array.from({ length: NUM_TAGS }, (_, i) => generateUUID("tag", i));
        const postIds = Array.from({ length: POST_COUNT }, (_, i) => generateUUID("post", i));
        const customerIds = Array.from({ length: 40 }, (_, i) => generateUUID("customer", i));
        const productIds = Array.from({ length: firecmsDemoProducts.length }, (_, i) => generateUUID("product", i));
        const orderIds = Array.from({ length: 80 }, (_, i) => generateUUID("order", i));
        const ticketIds = Array.from({ length: 60 }, (_, i) => generateUUID("ticket", i));

        console.log("🧹 Clearing existing data...");
        await db.execute("TRUNCATE TABLE posts, authors, tags, products, orders, order_items, customers, tickets, posts_tags, product_locales RESTART IDENTITY CASCADE;");

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
        const statuses = ["draft", "needs_review", "published", "published", "published", "archived"] as const;
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
                content: blocks as any,
                status: status as any,
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
        console.log("📦 Generating FireCMS Demo products...");
console.log("📸 Downloading product images...");
        const firebaseStorageBase = "https://firebasestorage.googleapis.com/v0/b/firecms-demo-27150.appspot.com/o/";
        
        for (const p of firecmsDemoProducts) {
            const localPaths: string[] = [];
            for (const imgUrl of p.imageUrls) {
                const fullUrl = `${firebaseStorageBase}${encodeURIComponent(imgUrl)}?alt=media`;
                const filename = imgUrl.split("/").pop() || "image.jpg";
                const downloadedPath = await downloadAndStore(fullUrl, "product_images/", filename);
                localPaths.push(downloadedPath);
            }
            (p as any).localImages = localPaths.length > 0 ? localPaths : null;
        }

        const allProducts = firecmsDemoProducts;

        const productValues = allProducts.map((p: any, i: number) => ({
            id: productIds[i],
            name: p.name,
            sku: p.sku,
            description: p.desc,
            brand: p.brand,
            available_locales: p.locales,
            category: p.cat as any,
            price: p.price.toFixed(2),
            compare_at_price: Math.random() > 0.7 ? (p.price * (1.1 + Math.random() * 0.4)).toFixed(2) : null,
            cost: p.cost.toFixed(2),
            stock_quantity: String(Math.floor(Math.random() * 200) + 5),
            low_stock_threshold: String(Math.floor(Math.random() * 15) + 5),
            weight_grams: String(p.weight),
            rating: String((3.5 + Math.random() * 1.5).toFixed(1)),
            review_count: String(Math.floor(Math.random() * 500) + 1),
            status: "active" as any,
            is_featured: Math.random() > 0.8,
            images: (p as any).localImages,
            created_at: randomDate(180, 10),
            updated_at: randomDate(30, 0)
        }));
        await db.insert(products).values(productValues);

        console.log("📦 Generating product locales subcollections...");
        const productLocalesValues: any[] = [];
        allProducts.forEach((p: any, i: number) => {
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
        const orderStatuses = ["pending", "confirmed", "processing", "shipped", "delivered", "delivered", "delivered", "cancelled", "refunded"] as const;
        const paymentStatuses = ["unpaid", "paid", "paid", "paid", "paid", "partially_refunded", "refunded"] as const;
        const currencies = ["USD", "USD", "USD", "EUR", "GBP", "CAD"] as const;
        const carriers = ["UPS", "FedEx", "USPS", "DHL"];
        const orderValues = [];
        const allOrderItems: { id: string; order_id: string; product_id: string; product_name: string; sku: string; quantity: string; unit_price: string; line_total: string }[] = [];

        for (let i = 1; i <= NUM_ORDERS; i++) {
            const status = pick([...orderStatuses]);
            const isDelivered = status === "delivered";
            const isShipped = status === "shipped" || isDelivered;
            const isCancelled = status === "cancelled" || status === "refunded";
            const payStatus = isCancelled ? (status === "refunded" ? "refunded" : "paid") : pick([...paymentStatuses]) as string;

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
                status: status as any,
                payment_status: payStatus as any,
                subtotal: subtotal.toFixed(2),
                tax_amount: taxAmount.toFixed(2),
                shipping_cost: shippingCost.toFixed(2),
                discount_amount: discountAmount > 0 ? discountAmount.toFixed(2) : "0",
                total: total.toFixed(2),
                currency: pick([...currencies]) as any,
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

        const ticketSubjects: { subject: string; description: string; category: string; priority: string }[] = [
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
        const ticketStatuses = ["open", "open", "in_progress", "in_progress", "waiting", "resolved", "resolved", "closed", "closed"] as const;

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
                status: status as any,
                priority: template.priority as any,
                category: template.category as any,
                customer_id: hasCustomer ? customerIds[Math.floor(Math.random() * 40)] : null,
                assigned_to: status === "open" && Math.random() > 0.5 ? null : pick(agentNames),
                __order: String(i),
                created_at: createdAt,
                updated_at: status === "open" ? createdAt : randomDate(7, 0)
            });
        }

        for (let i = 0; i < ticketValues.length; i += BATCH) {
            await db.insert(tickets).values(ticketValues.slice(i, i + BATCH));
        }
        console.log(`  ✅ ${NUM_TICKETS} support tickets`);

        // ── Summary ───────────────────────────────────────────────────
        const statusCounts: Record<string, number> = {};
        postValues.forEach(p => { statusCounts[p.status] = (statusCounts[p.status] || 0) + 1; });

        const ticketStatusCounts: Record<string, number> = {};
        ticketValues.forEach(t => { ticketStatusCounts[t.status] = (ticketStatusCounts[t.status] || 0) + 1; });

        console.log("\n🎉 Database seeded successfully!");
        console.log(`   ${NUM_AUTHORS} authors, ${NUM_TAGS} tags, ${POST_COUNT} posts`);
        console.log(`   40 customers, ${allProducts.length} products, ${NUM_ORDERS} orders`);
        console.log(`   ${NUM_TICKETS} tickets`);
        console.log(`   Post statuses: ${Object.entries(statusCounts).map(([k, v]) => `${k}=${v}`).join(", ")}`);
        console.log(`   Ticket statuses: ${Object.entries(ticketStatusCounts).map(([k, v]) => `${k}=${v}`).join(", ")}`);

    } catch (e) {
        console.error("❌ Error seeding database:", e);
    } finally {
        await pool.end();
    }
}

runSeed();
