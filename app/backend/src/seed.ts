/**
 * Single consolidated seed script for the Rebase demo.
 * Downloads images to local storage and seeds all collections.
 * Run with: npx tsx src/seed.ts
 */
import { createPostgresDatabaseConnection } from "@rebasepro/server-postgresql";
import { env } from "./env.js";
import {
    authors, posts, tags, profiles, products, orders,
    postsTags, ordersProducts, privateNotes
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
    "https://images.unsplash.com/photo-1542831371-29b0f74f9713?w=1200&q=80",
];

const contentImageUrls = [
    "https://images.unsplash.com/photo-1587620962725-abab7fe55159?w=800&q=80",
    "https://images.unsplash.com/photo-1607799279861-4dd421887fc8?w=800&q=80",
    "https://images.unsplash.com/photo-1516116216624-53e697fedbea?w=800&q=80",
    "https://images.unsplash.com/photo-1580894894513-541e068a3e2b?w=800&q=80",
    "https://images.unsplash.com/photo-1484417894907-623942c8ee29?w=800&q=80",
    "https://images.unsplash.com/photo-1534972195531-d756b9bfa9f2?w=800&q=80",
    "https://images.unsplash.com/photo-1629654297299-c8506221ca97?w=800&q=80",
    "https://images.unsplash.com/photo-1555949963-aa79dcee981c?w=800&q=80",
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
    "Go for Backend Services: Concurrency Made Simple",
    "Building a Design System from Scratch",
    "Edge Computing and the Future of Web Architecture",
    "Svelte vs React: A Developer Experience Comparison",
    "Data Modeling Best Practices for Relational Databases",
    "Accessibility First: Building Inclusive Web Experiences",
    "Observability in Production: Logs, Metrics, and Traces",
    "Vue 3 Composition API: Patterns and Anti-Patterns",
    "Building CLI Tools with Node.js and Commander",
    "The Art of Code Review: Beyond Bug Finding",
    "Angular Signals: A New Approach to Reactivity",
    "Practical Event-Driven Architecture",
    "TypeScript Generics: From Basics to Advanced",
    "Kotlin Multiplatform: One Language, Every Platform",
    "Zero-Trust Security Architecture for Modern Apps",
    "Effective Debugging Strategies for Complex Systems",
    "Horizontal Scaling Strategies for PostgreSQL",
    "State Management in 2025: What Actually Works",
    "Building Progressive Web Apps That Feel Native",
    "Terraform for Infrastructure as Code",
    "Open Source Sustainability: Business Models That Work",
    "TypeScript Monorepos with Turborepo and pnpm",
    "Intro to Computer Vision with TensorFlow",
    "The Developer's Guide to Technical Writing",
    "TypeScript Decorators and Metadata Reflection",
    "Next.js App Router: Server Actions Deep Dive",
    "Bun vs Node.js: Runtime Performance Compared",
];

const markdownIntros = [
    `In this comprehensive guide, we'll explore the key concepts and practical techniques that every developer should know. Whether you're just starting out or looking to deepen your expertise, this article has something for you.`,
    `The landscape of software development is constantly evolving. What worked a year ago might not be the best approach today. Let's dive into the current state of the art and discover what's changed.`,
    `As applications grow in complexity, choosing the right tools and patterns becomes critical. In this post, we'll walk through real-world examples and battle-tested approaches that scale.`,
    `Have you ever wondered why some teams ship faster with fewer bugs? The answer often lies in the fundamentals. Let's revisit the basics with a modern perspective.`,
    `Performance isn't just a nice-to-have — it's a competitive advantage. In this article, we'll look at concrete techniques to make your applications faster and more efficient.`,
];

const markdownSections = [
    `## Getting Started\n\nBefore diving in, let's set up our development environment:\n\n- **Node.js 20+** installed\n- A modern code editor (VS Code recommended)\n- Basic familiarity with the command line\n\n\`\`\`bash\nnpm create my-project@latest\ncd my-project\nnpm install\n\`\`\`\n\nOnce set up, you're ready to start building.`,

    `## Core Concepts\n\nThe architecture follows a simple principle: **separation of concerns**.\n\n1. **Presentation Layer** — handles UI rendering\n2. **Business Logic Layer** — domain-specific rules\n3. **Data Access Layer** — manages persistence\n\nThis separation makes code easier to test and maintain.`,

    `## Best Practices\n\n- **Write tests first** — TDD catches bugs early\n- **Keep functions small** — each function does one thing\n- **Use meaningful names** — code is read more than written\n- **Prefer composition over inheritance**\n\n> "Any fool can write code that a computer can understand. Good programmers write code that humans can understand." — Martin Fowler`,

    `## Performance Optimization\n\n\`\`\`typescript\n// Before: O(n²)\nconst result = items.filter(item =>\n  otherItems.some(other => other.id === item.id)\n);\n\n// After: O(n) with a Set\nconst idSet = new Set(otherItems.map(o => o.id));\nconst result = items.filter(item => idSet.has(item.id));\n\`\`\`\n\nSmall changes like this have dramatic impact on large datasets.`,

    `## Error Handling\n\nRobust error handling separates production code from prototypes:\n\n\`\`\`typescript\nasync function fetchData(url: string) {\n  const response = await fetch(url);\n  if (!response.ok) {\n    throw new HttpError(response.status);\n  }\n  return response.json();\n}\n\`\`\``,

    `## Architecture Patterns\n\n| Pattern | Pros | Cons |\n|---------|------|------|\n| Monolith | Simple deployment | Harder to scale |\n| Microservices | Independent scaling | Operational complexity |\n| Modular Monolith | Best of both | Requires discipline |\n\n**There's no one-size-fits-all solution.** Choose what matches your team.`,

    `## Security Considerations\n\n- Validate and sanitize all user input\n- Use parameterized queries to prevent SQL injection\n- Implement rate limiting on public endpoints\n- Store secrets in environment variables\n\n\`\`\`typescript\n// Never do this\nconst query = \`SELECT * FROM users WHERE id = '\${userId}'\`;\n\n// Do this instead\nconst query = db.select().from(users).where(eq(users.id, userId));\n\`\`\``,

    `## Deployment Strategies\n\n- **Blue-Green Deployments** — two identical production environments\n- **Canary Releases** — gradually route traffic to new version\n- **Feature Flags** — decouple deployment from feature release\n\nThe goal is to make deployments boring.`,

    `## Monitoring and Observability\n\n1. **Structured Logging** — JSON logs with trace IDs\n2. **Metrics** — request latency, error rates\n3. **Distributed Tracing** — follow requests across services\n4. **Alerting** — actionable alerts, not noise\n\nInvest in observability early.`,

    `## Conclusion\n\nThe technologies we've discussed represent the current state of the art, but they'll continue to evolve. The most important skill isn't mastering any particular tool — it's the ability to learn, adapt, and make pragmatic decisions.\n\nStay curious, keep building.`,
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
    "Key insights and practical advice distilled from years of industry experience.",
];

const authorPicFiles = [
    "author_pictures/0phas_Gemini_Generated_Image_.jpeg",
    "author_pictures/5kuxx_chromaflow_landing_page.png",
    "author_pictures/9h9s0_Gemini_Generated_Image_hwxqw4hwxqw4hwxq.jpeg",
    "author_pictures/jbiri_77035b3e-cb2f-42a2-85c9-813d7a9045eb.avif",
    "author_pictures/nxih4_logo_small.png",
    "author_pictures/v166u_xvu6k_Frame 45 (1).png",
    "author_pictures/w48fo_Frame 45.png",
    "author_pictures/w5l1n_xvu6k_Frame 45 (1).png",
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
        await db.execute("TRUNCATE TABLE posts, authors, profiles, tags, private_notes, products, orders CASCADE;");

        // ── Authors ───────────────────────────────────────────────────
        console.log(`👤 Generating ${NUM_AUTHORS} authors & profiles...`);
        const authorValues = [];
        const profileValues = [];
        for (let i = 1; i <= NUM_AUTHORS; i++) {
            const name = randomName();
            const email = `${name.toLowerCase().replace(/ /g, ".")}${i}@example.com`;
            authorValues.push({ id: i, name, email, picture: pick(authorPicFiles), userId: i <= 3 ? `user-${i}` : null });
            profileValues.push({ id: i, bio: `${name} is a passionate writer and technologist.`, website: `https://${name.toLowerCase().replace(/ /g, "")}.dev`, author_id: i });
        }
        await db.insert(authors).values(authorValues);
        await db.insert(profiles).values(profileValues);

        // ── Tags ──────────────────────────────────────────────────────
        console.log(`🏷️  Generating ${NUM_TAGS} tags...`);
        const tagNames = ["React", "TypeScript", "Node.js", "PostgreSQL", "GraphQL", "Docker", "Kubernetes", "AWS", "Python", "Rust", "Go", "CSS", "HTML", "UI/UX", "Design", "DevOps", "AI", "Machine Learning", "Security", "Testing", "CI/CD", "Serverless", "Microservices", "Frontend", "Backend", "Fullstack", "Mobile", "Next.js", "Performance", "Architecture"];
        const tagValues = tagNames.map((name, i) => ({ id: i + 1, name }));
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

            // Build content blocks
            const blocks: { type: string; value: string }[] = [{ type: "text", value: pick(markdownIntros) }];
            const sections = pickN(markdownSections, 2 + Math.floor(Math.random() * 3));
            for (let s = 0; s < sections.length; s++) {
                blocks.push({ type: "text", value: sections[s] });
                if (Math.random() < 0.4 && s < sections.length - 1 && contentImagePaths.length > 0) {
                    blocks.push({ type: "image", value: pick(contentImagePaths) });
                }
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
                author_id: Math.floor(Math.random() * NUM_AUTHORS) + 1,
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
            for (const t of assigned) ptValues.push({ post_id: i, tag_id: t });
        }
        for (let i = 0; i < ptValues.length; i += BATCH) {
            await db.insert(postsTags).values(ptValues.slice(i, i + BATCH));
        }
        console.log(`  ✅ Created ${ptValues.length} post-tag associations`);

        // ── Products ──────────────────────────────────────────────────
        console.log("📦 Generating 30 products...");
        const categories = ["electronics", "clothing", "home"] as const;
        const productValues = [];
        for (let i = 1; i <= 30; i++) {
            const cat = pick([...categories]);
            productValues.push({ id: i, name: `Premium ${cat} Item ${i}`, description: `High quality ${cat} product.`, price: (Math.random() * 200 + 10).toFixed(2), stock: Math.floor(Math.random() * 500).toString(), category: cat as any });
        }
        await db.insert(products).values(productValues);

        // ── Orders ────────────────────────────────────────────────────
        console.log("🛒 Generating 50 orders...");
        const orderStatuses = ["pending", "shipped", "delivered", "cancelled"] as const;
        const orderValues = [];
        for (let i = 1; i <= 50; i++) {
            orderValues.push({ id: i, customer_name: randomName(), status: pick([...orderStatuses]) as any });
        }
        await db.insert(orders).values(orderValues);

        // ── Order-product associations ────────────────────────────────
        const opValues: { order_id: number; product_id: number }[] = [];
        for (let i = 1; i <= 50; i++) {
            const n = 1 + Math.floor(Math.random() * 4);
            const assigned = new Set<number>();
            for (let j = 0; j < n; j++) assigned.add(Math.floor(Math.random() * 30) + 1);
            for (const p of assigned) opValues.push({ order_id: i, product_id: p });
        }
        await db.insert(ordersProducts).values(opValues);

        // ── Private notes ─────────────────────────────────────────────
        console.log("🔒 Generating 10 private notes...");
        const noteValues = [];
        for (let i = 1; i <= 10; i++) {
            noteValues.push({ title: `Private Note ${i}`, content: `Confidential note ${i} content...`, user_id: `user-${(i % 3) + 1}`, is_locked: Math.random() > 0.7 });
        }
        await db.insert(privateNotes).values(noteValues);

        // ── Summary ───────────────────────────────────────────────────
        const statusCounts: Record<string, number> = {};
        postValues.forEach(p => { statusCounts[p.status] = (statusCounts[p.status] || 0) + 1; });

        console.log(`\n🎉 Database seeded successfully!`);
        console.log(`   ${NUM_AUTHORS} authors, ${NUM_TAGS} tags, ${POST_COUNT} posts`);
        console.log(`   30 products, 50 orders, 10 private notes`);
        console.log(`   Post statuses: ${Object.entries(statusCounts).map(([k, v]) => `${k}=${v}`).join(", ")}`);

    } catch (e) {
        console.error("❌ Error seeding database:", e);
    } finally {
        await pool.end();
    }
}

runSeed();
