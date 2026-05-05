/**
 * Single consolidated seed script for the Rebase demo.
 * Downloads images to local storage and seeds all collections.
 * Run with: npx tsx src/seed.ts
 */
import { createPostgresDatabaseConnection } from "@rebasepro/server-postgresql";
import { env } from "./env.js";
import {
    authors, posts, tags, profiles, products, orders,
    postsTags, customers, orderItems
} from "./schema.generated.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";
import http from "http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.resolve(__dirname, "../../uploads/default");

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
async function runSeed() {
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
            const p = await downloadAndStore(heroImageUrls[i], "blog_images/", `hero_${i + 1}.jpg`);
            heroImagePaths.push(p);
            process.stdout.write(`  ✅ ${i + 1}/${heroImageUrls.length}\r`);
        }
        console.log(`  ✅ Downloaded ${heroImagePaths.length} hero images`);

        console.log("📸 Downloading content images to local storage...");
        const contentImagePaths: string[] = [];
        for (let i = 0; i < contentImageUrls.length; i++) {
            const p = await downloadAndStore(contentImageUrls[i], "blog_content/", `content_${i + 1}.jpg`);
            contentImagePaths.push(p);
        }
        console.log(`  ✅ Downloaded ${contentImagePaths.length} content images`);

        // ── Clear existing data ───────────────────────────────────────
        console.log("🧹 Clearing existing data...");
        await db.execute("TRUNCATE TABLE posts, authors, profiles, tags, products, orders CASCADE;");

        // ── Authors ───────────────────────────────────────────────────
        console.log(`👤 Generating ${NUM_AUTHORS} authors & profiles...`);
        const authorValues = [];
        const profileValues = [];
        for (let i = 1; i <= NUM_AUTHORS; i++) {
            const name = randomName();
            const email = `${name.toLowerCase().replace(/ /g, ".")}${i}@example.com`;
            authorValues.push({ id: i,
name,
email,
picture: pick(authorPicFiles),
userId: i <= 3 ? `user-${i}` : null });
            profileValues.push({ id: i,
bio: `${name} is a passionate writer and technologist.`,
website: `https://${name.toLowerCase().replace(/ /g, "")}.dev`,
author_id: i });
        }
        await db.insert(authors).values(authorValues);
        await db.insert(profiles).values(profileValues);

        // ── Tags ──────────────────────────────────────────────────────
        console.log(`🏷️  Generating ${NUM_TAGS} tags...`);
        const tagNames = ["React", "TypeScript", "Node.js", "PostgreSQL", "GraphQL", "Docker", "Kubernetes", "AWS", "Python", "Rust", "Go", "CSS", "HTML", "UI/UX", "Design", "DevOps", "AI", "Machine Learning", "Security", "Testing", "CI/CD", "Serverless", "Microservices", "Frontend", "Backend", "Fullstack", "Mobile", "Next.js", "Performance", "Architecture"];
        const tagValues = tagNames.map((name, i) => ({ id: i + 1,
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
                id: i,
                title,
                slug,
                hero_image: pick(heroImagePaths),
                excerpt: pick(excerpts),
                content: blocks as any,
                status: status as any,
                publish_date: isPublished ? randomDate(365, 0) : null,
                created_at: randomDate(400, 30),
                updated_at: randomDate(30, 0),
                author_id: Math.floor(Math.random() * NUM_AUTHORS) + 1
            });
        }

        const BATCH = 50;
        for (let i = 0; i < postValues.length; i += BATCH) {
            await db.insert(posts).values(postValues.slice(i, i + BATCH));
            console.log(`  ✅ Inserted posts ${i + 1}–${Math.min(i + BATCH, postValues.length)}`);
        }

        // ── Post-tag associations ─────────────────────────────────────
        console.log("🏷️  Assigning tags...");
        const ptValues: { post_id: number; tag_id: number }[] = [];
        for (let i = 1; i <= POST_COUNT; i++) {
            const n = 1 + Math.floor(Math.random() * 4);
            const assigned = new Set<number>();
            for (let j = 0; j < n; j++) assigned.add(Math.floor(Math.random() * NUM_TAGS) + 1);
            for (const t of assigned) ptValues.push({ post_id: i,
tag_id: t });
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
            customerValues.push({
                first_name: fn,
                last_name: ln,
                email: `${fn.toLowerCase()}.${ln.toLowerCase()}${i}@example.com`,
                phone: `+1-${String(Math.floor(Math.random() * 900) + 100)}-${String(Math.floor(Math.random() * 900) + 100)}-${String(Math.floor(Math.random() * 9000) + 1000)}`,
                company: pick(companies),
                shipping_address: addr,
                billing_address: Math.random() > 0.3 ? addr : `${pick(streets)}\n${pick(cities)}`,
                notes: Math.random() > 0.7 ? pick(["VIP customer", "Wholesale buyer", "Preferred shipping: FedEx", "Tax exempt", ""]) : null,
                created_at: randomDate(365, 30),
                updated_at: randomDate(30, 0)
            });
        }
        await db.insert(customers).values(customerValues);

        // ── Products ──────────────────────────────────────────────────
        console.log("📦 Generating 50 products...");
        const productCatalog: { name: string; sku: string; cat: string; price: number; cost: number; weight: number; desc: string }[] = [
            { name: "MacBook Pro 16\" M4",
sku: "ELEC-MBP16-M4",
cat: "electronics",
price: 2499,
cost: 1800,
weight: 2100,
desc: "Apple MacBook Pro 16-inch with M4 Pro chip, 18GB RAM, 512GB SSD" },
            { name: "Sony WH-1000XM5 Headphones",
sku: "ELEC-SONY-XM5",
cat: "electronics",
price: 349.99,
cost: 210,
weight: 250,
desc: "Industry-leading noise cancellation with exceptional sound quality" },
            { name: "Samsung 4K OLED Monitor 32\"",
sku: "ELEC-SAM-32OLED",
cat: "electronics",
price: 1299,
cost: 850,
weight: 8500,
desc: "32-inch 4K OLED monitor with 120Hz refresh rate, perfect for creative professionals" },
            { name: "Logitech MX Master 3S",
sku: "ELEC-LOG-MX3S",
cat: "electronics",
price: 99.99,
cost: 45,
weight: 141,
desc: "Advanced wireless mouse with ultra-fast scrolling" },
            { name: "Keychron Q1 Pro Keyboard",
sku: "ELEC-KEY-Q1PRO",
cat: "electronics",
price: 199,
cost: 95,
weight: 1700,
desc: "75% wireless mechanical keyboard with hot-swappable switches" },
            { name: "iPad Air M2",
sku: "ELEC-IPAD-AIRM2",
cat: "electronics",
price: 599,
cost: 420,
weight: 462,
desc: "10.9-inch Liquid Retina display, M2 chip, 128GB" },
            { name: "Anker 737 Power Bank",
sku: "ELEC-ANK-737",
cat: "electronics",
price: 109.99,
cost: 55,
weight: 640,
desc: "24,000mAh portable charger with 140W output" },
            { name: "Premium Wool Overcoat",
sku: "CLO-WOOL-OC001",
cat: "clothing",
price: 289,
cost: 120,
weight: 1800,
desc: "Italian wool blend overcoat, tailored fit, charcoal grey" },
            { name: "Merino V-Neck Sweater",
sku: "CLO-MER-VN001",
cat: "clothing",
price: 89,
cost: 32,
weight: 350,
desc: "100% Australian merino wool, available in 6 colors" },
            { name: "Selvedge Denim Jeans",
sku: "CLO-DEN-SEL001",
cat: "clothing",
price: 168,
cost: 55,
weight: 900,
desc: "Japanese selvedge denim, slim fit, raw indigo" },
            { name: "Organic Cotton T-Shirt Pack (3)",
sku: "CLO-COT-TS003",
cat: "clothing",
price: 49.99,
cost: 15,
weight: 450,
desc: "Pack of 3 organic cotton crew neck tees, classic fit" },
            { name: "Leather Chelsea Boots",
sku: "CLO-LTR-CB001",
cat: "clothing",
price: 245,
cost: 98,
weight: 1400,
desc: "Full-grain leather Chelsea boots with Goodyear welt construction" },
            { name: "Performance Running Jacket",
sku: "CLO-RUN-JK001",
cat: "clothing",
price: 135,
cost: 48,
weight: 280,
desc: "Lightweight, water-resistant running jacket with reflective details" },
            { name: "Ceramic Plant Pot Set",
sku: "HG-CER-PS003",
cat: "home_garden",
price: 59.99,
cost: 22,
weight: 3200,
desc: "Set of 3 handcrafted ceramic pots with drainage holes, matte finish" },
            { name: "Smart LED Grow Light",
sku: "HG-LED-GL001",
cat: "home_garden",
price: 79.99,
cost: 35,
weight: 1200,
desc: "Full-spectrum grow light with app control and timer" },
            { name: "Bamboo Cutting Board Set",
sku: "HG-BAM-CB003",
cat: "home_garden",
price: 44.99,
cost: 16,
weight: 2800,
desc: "Set of 3 organic bamboo cutting boards, antimicrobial" },
            { name: "Cast Iron Dutch Oven 6qt",
sku: "HG-CI-DO006",
cat: "home_garden",
price: 149,
cost: 65,
weight: 5400,
desc: "Enameled cast iron dutch oven, perfect for soups and stews" },
            { name: "Linen Duvet Cover Set",
sku: "HG-LIN-DC001",
cat: "home_garden",
price: 199,
cost: 72,
weight: 2100,
desc: "100% French linen duvet cover and 2 pillowcases, stone-washed" },
            { name: "Carbon Steel Road Bike",
sku: "SPT-BIK-RD001",
cat: "sports",
price: 899,
cost: 450,
weight: 9500,
desc: "Shimano 105 groupset, carbon fork, 700c wheels" },
            { name: "Yoga Mat Premium 6mm",
sku: "SPT-YOG-MT001",
cat: "sports",
price: 68,
cost: 18,
weight: 1800,
desc: "Non-slip natural rubber yoga mat with alignment markings" },
            { name: "Adjustable Dumbbell Set",
sku: "SPT-DUM-AD001",
cat: "sports",
price: 349,
cost: 165,
weight: 24000,
desc: "5-52.5 lb adjustable dumbbells, pair" },
            { name: "Trail Running Shoes",
sku: "SPT-TRL-RS001",
cat: "sports",
price: 159,
cost: 62,
weight: 620,
desc: "Vibram outsole, waterproof Gore-Tex membrane, supportive midsole" },
            { name: "Camping Tent 4-Person",
sku: "SPT-TEN-4P001",
cat: "sports",
price: 279,
cost: 120,
weight: 4200,
desc: "3-season dome tent with full rainfly and vestibule" },
            { name: "TypeScript Design Patterns",
sku: "BOK-TS-DP001",
cat: "books",
price: 49.99,
cost: 12,
weight: 650,
desc: "Comprehensive guide to design patterns in TypeScript, 2025 edition" },
            { name: "System Design Interview Vol. 2",
sku: "BOK-SDI-V2001",
cat: "books",
price: 39.99,
cost: 10,
weight: 580,
desc: "Step-by-step framework for system design interviews" },
            { name: "The Art of PostgreSQL",
sku: "BOK-PG-ART001",
cat: "books",
price: 59,
cost: 15,
weight: 720,
desc: "Advanced PostgreSQL techniques for application developers" },
            { name: "Organic Matcha Powder 100g",
sku: "FB-MAT-100G",
cat: "food_beverage",
price: 34.99,
cost: 14,
weight: 120,
desc: "Ceremonial grade organic matcha from Uji, Kyoto" },
            { name: "Single Origin Coffee Beans 1kg",
sku: "FB-COF-1KG",
cat: "food_beverage",
price: 28,
cost: 11,
weight: 1050,
desc: "Ethiopian Yirgacheffe, light roast, specialty grade" },
            { name: "Artisan Chocolate Box",
sku: "FB-CHO-BOX12",
cat: "food_beverage",
price: 42,
cost: 18,
weight: 400,
desc: "12-piece assorted single-origin chocolate truffles" },
            { name: "Vitamin D3+K2 Supplement",
sku: "HB-VIT-D3K2",
cat: "health_beauty",
price: 24.99,
cost: 6,
weight: 80,
desc: "120 capsules, 5000 IU D3 + 200mcg K2-MK7" },
            { name: "Organic Face Moisturizer",
sku: "HB-FCE-MO001",
cat: "health_beauty",
price: 38,
cost: 12,
weight: 120,
desc: "Lightweight daily moisturizer with hyaluronic acid and vitamin E" },
            { name: "Electric Toothbrush Pro",
sku: "HB-ETB-PRO01",
cat: "health_beauty",
price: 89.99,
cost: 35,
weight: 320,
desc: "Sonic toothbrush with 5 modes, pressure sensor, and travel case" },
            { name: "LEGO Architecture Set",
sku: "TOY-LEG-ARC01",
cat: "toys",
price: 119.99,
cost: 55,
weight: 1200,
desc: "Skyline Collection: New York City, 598 pieces" },
            { name: "Strategy Board Game Deluxe",
sku: "TOY-BGM-STR01",
cat: "toys",
price: 64.99,
cost: 25,
weight: 1800,
desc: "Euro-style strategy game, 2-5 players, 60-120 min playtime" },
            { name: "RC Drone with 4K Camera",
sku: "TOY-DRN-4K01",
cat: "toys",
price: 299,
cost: 130,
weight: 950,
desc: "Foldable drone with 4K gimbal camera, 30 min flight time" }
        ];
        // Add some duplicates with variations to get to 50
        const extraProducts = [
            { name: "USB-C Hub 7-in-1",
sku: "ELEC-USB-HUB7",
cat: "electronics",
price: 49.99,
cost: 18,
weight: 120,
desc: "HDMI, USB-A x3, SD, microSD, USB-C PD passthrough" },
            { name: "Wireless Earbuds Pro",
sku: "ELEC-WEB-PRO1",
cat: "electronics",
price: 179,
cost: 65,
weight: 58,
desc: "Active noise cancellation, 30hr battery with case" },
            { name: "Standing Desk Mat",
sku: "HG-DSK-MAT01",
cat: "home_garden",
price: 79,
cost: 28,
weight: 2800,
desc: "Anti-fatigue standing desk mat with massage points" },
            { name: "Stainless Steel Water Bottle",
sku: "SPT-WTR-SS001",
cat: "sports",
price: 34.99,
cost: 9,
weight: 350,
desc: "32oz insulated, keeps cold 24hrs / hot 12hrs" },
            { name: "Resistance Band Set",
sku: "SPT-RBS-SET01",
cat: "sports",
price: 29.99,
cost: 8,
weight: 450,
desc: "5 bands with handles, door anchor, and carry bag" },
            { name: "Essential Oil Diffuser",
sku: "HB-EOD-001",
cat: "health_beauty",
price: 45,
cost: 15,
weight: 380,
desc: "Ultrasonic aromatherapy diffuser with color-changing LED" },
            { name: "French Press Coffee Maker",
sku: "FB-FP-34OZ",
cat: "food_beverage",
price: 36,
cost: 12,
weight: 850,
desc: "Double-wall borosilicate glass, 34oz capacity" },
            { name: "Wireless Charging Pad",
sku: "ELEC-WCP-15W",
cat: "electronics",
price: 29.99,
cost: 10,
weight: 100,
desc: "15W Qi wireless charger, compatible with all Qi devices" },
            { name: "Hiking Backpack 40L",
sku: "SPT-HBP-40L",
cat: "sports",
price: 129,
cost: 48,
weight: 1200,
desc: "Waterproof 40L pack with rain cover, hip belt, hydration-ready" },
            { name: "Puzzle 1000 Pieces - World Map",
sku: "TOY-PUZ-WM01",
cat: "toys",
price: 24.99,
cost: 7,
weight: 650,
desc: "Premium quality 1000-piece jigsaw puzzle, vintage world map" },
            { name: "Mechanical Pencil Set",
sku: "BOK-MPC-SET1",
cat: "books",
price: 18.99,
cost: 5,
weight: 120,
desc: "0.5mm and 0.7mm mechanical pencils with lead refills and erasers" },
            { name: "Smart Home Hub",
sku: "ELEC-SHH-001",
cat: "electronics",
price: 129,
cost: 55,
weight: 340,
desc: "Matter-compatible smart home hub with Thread and Zigbee" },
            { name: "Cashmere Scarf",
sku: "CLO-CSH-SC001",
cat: "clothing",
price: 145,
cost: 52,
weight: 180,
desc: "100% Mongolian cashmere, oversized wrap scarf" },
            { name: "Garden Tool Set",
sku: "HG-GTL-SET5",
cat: "home_garden",
price: 54.99,
cost: 20,
weight: 2400,
desc: "5-piece stainless steel garden tools with ergonomic handles" },
            { name: "Protein Bar Box (12)",
sku: "FB-PRB-BOX12",
cat: "food_beverage",
price: 32,
cost: 14,
weight: 720,
desc: "12 high-protein bars, mixed flavors, 20g protein each" }
        ];
        const allProducts = [...productCatalog, ...extraProducts];
        const productValues = allProducts.map((p, i) => ({
            name: p.name,
            sku: p.sku,
            description: p.desc,
            category: p.cat as any,
            price: p.price.toFixed(2),
            compare_at_price: Math.random() > 0.7 ? (p.price * (1.1 + Math.random() * 0.4)).toFixed(2) : null,
            cost: p.cost.toFixed(2),
            stock_quantity: String(Math.floor(Math.random() * 200) + 5),
            low_stock_threshold: String(Math.floor(Math.random() * 15) + 5),
            weight_grams: String(p.weight),
            status: (pick(["active", "active", "active", "active", "draft", "archived"])) as any,
            is_featured: Math.random() > 0.8,
            created_at: randomDate(300, 30),
            updated_at: randomDate(30, 0)
        }));
        await db.insert(products).values(productValues);

        // ── Orders + Order Items ──────────────────────────────────────
        const NUM_ORDERS = 80;
        console.log(`🛒 Generating ${NUM_ORDERS} orders with line items...`);
        const orderStatuses = ["pending", "confirmed", "processing", "shipped", "delivered", "delivered", "delivered", "cancelled", "refunded"] as const;
        const paymentStatuses = ["unpaid", "paid", "paid", "paid", "paid", "partially_refunded", "refunded"] as const;
        const currencies = ["USD", "USD", "USD", "EUR", "GBP", "CAD"] as const;
        const carriers = ["UPS", "FedEx", "USPS", "DHL"];
        const orderValues = [];
        const allOrderItems: { order_id: number; product_id: number; product_name: string; sku: string; quantity: string; unit_price: string; line_total: string }[] = [];

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
                    order_id: i,
                    product_id: pIdx + 1,
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

            const orderDate = randomDate(180, 1);
            const shippedDate = isShipped ? new Date(new Date(orderDate).getTime() + (1 + Math.random() * 3) * 86400000).toISOString() : null;
            const deliveredDate = isDelivered && shippedDate ? new Date(new Date(shippedDate).getTime() + (2 + Math.random() * 5) * 86400000).toISOString() : null;
            const custId = Math.floor(Math.random() * 40) + 1;

            orderValues.push({
                order_number: `ORD-${String(2025)}-${String(i).padStart(4, "0")}`,
                customer_id: custId,
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

        // ── Summary ───────────────────────────────────────────────────
        const statusCounts: Record<string, number> = {};
        postValues.forEach(p => { statusCounts[p.status] = (statusCounts[p.status] || 0) + 1; });

        console.log("\n🎉 Database seeded successfully!");
        console.log(`   ${NUM_AUTHORS} authors, ${NUM_TAGS} tags, ${POST_COUNT} posts`);
        console.log(`   40 customers, ${allProducts.length} products, ${NUM_ORDERS} orders`);
        console.log(`   Post statuses: ${Object.entries(statusCounts).map(([k, v]) => `${k}=${v}`).join(", ")}`);

    } catch (e) {
        console.error("❌ Error seeding database:", e);
    } finally {
        await pool.end();
    }
}

runSeed();
