/**
 * Seed Script — Edith CRM Demo Data
 *
 * Deletes ALL existing data from every collection and re-populates
 * with realistic, high-quality fake data.
 *
 * Usage:
 *   cd app
 *   pnpm exec tsx scripts/seed.ts
 *
 * Requires the dev server running (`pnpm dev`) or REBASE_URL set.
 * Uses raw fetch — zero external dependencies.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// ─── Manual .env loader ──────────────────────────────────────────────
function loadEnv(envPath: string) {
    try {
        const content = fs.readFileSync(envPath, "utf-8");
        for (const line of content.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const eqIdx = trimmed.indexOf("=");
            if (eqIdx === -1) continue;
            const key = trimmed.slice(0, eqIdx).trim();
            let value = trimmed.slice(eqIdx + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            if (!process.env[key]) {
                process.env[key] = value;
            }
        }
    } catch { /* ignore */ }
}
loadEnv(path.resolve(process.cwd(), ".env"));

// ─── Resolve Backend URL ─────────────────────────────────────────────
let BASE_URL = process.env.REBASE_URL;
if (!BASE_URL) {
    try {
        const urlFile = path.join(process.cwd(), ".rebase-dev-url");
        if (fs.existsSync(urlFile)) {
            BASE_URL = fs.readFileSync(urlFile, "utf-8").trim();
        }
    } catch { /* ignore */ }
}
if (!BASE_URL) {
    console.error("❌ No backend URL. Start the dev server or set REBASE_URL.");
    process.exit(1);
}
console.log(`🔗 Using backend at: ${BASE_URL}`);

const SERVICE_KEY = process.env.REBASE_SERVICE_KEY ?? "";
if (!SERVICE_KEY) {
    console.warn("⚠️  No REBASE_SERVICE_KEY — requests will be unauthenticated.");
}

// ─── HTTP helpers ────────────────────────────────────────────────────
const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(SERVICE_KEY ? { Authorization: `Bearer ${SERVICE_KEY}` } : {})
};

async function apiGet<T>(path: string): Promise<T> {
    const res = await fetch(`${BASE_URL}/api${path}`, { method: "GET", headers });
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
}

async function apiPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${BASE_URL}/api${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
}

async function apiDelete(path: string): Promise<void> {
    const res = await fetch(`${BASE_URL}/api${path}`, { method: "DELETE", headers });
    if (!res.ok && res.status !== 404) throw new Error(`DELETE ${path} → ${res.status}: ${await res.text()}`);
}

// ─── Utility Helpers ─────────────────────────────────────────────────
function uuid(): string { return crypto.randomUUID(); }
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function pickN<T>(arr: T[], min: number, max: number): T[] {
    const n = min + Math.floor(Math.random() * (max - min + 1));
    return [...arr].sort(() => Math.random() - 0.5).slice(0, Math.min(n, arr.length));
}
function randomInt(min: number, max: number): number { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randomFloat(min: number, max: number, dec = 2): number { return parseFloat((Math.random() * (max - min) + min).toFixed(dec)); }
function pastDate(daysBack: number): string {
    const d = new Date();
    d.setDate(d.getDate() - randomInt(0, daysBack));
    d.setHours(randomInt(6, 22), randomInt(0, 59), randomInt(0, 59));
    return d.toISOString();
}

// ─── Data Banks ──────────────────────────────────────────────────────
const FIRST_NAMES = ["James","Emma","Liam","Olivia","Noah","Ava","Ethan","Sophia","Mason","Isabella","Lucas","Mia","Logan","Charlotte","Aiden","Amelia","Elijah","Harper","Sebastian","Evelyn","Mateo","Luna","Daniel","Camila","Henry","Gianna","Alexander","Aria","Owen","Ella","Ben","Chloe","Jack","Penelope","Ryan","Layla","Leo","Riley","Nathan","Zoey","Marcus","Nora","Caleb","Lily","Adrian","Eleanor","Miles","Hannah","Kai","Stella"];

const LAST_NAMES = ["Anderson","Martinez","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Rodriguez","Wilson","Chen","Thomas","Taylor","Moore","Jackson","White","Harris","Clark","Lewis","Robinson","Walker","Perez","Hall","Young","Allen","King","Wright","Lopez","Hill","Scott","Green","Adams","Baker","Nelson","Carter","Mitchell","Roberts","Turner","Phillips","Campbell","Parker","Evans","Edwards","Collins","Stewart","Morales","Reed"];

const COMPANIES = ["Acme Corp","TechFlow Inc","Meridian Labs","Vertex Solutions","NovaStar Digital","Atlas Commerce","Quantum Dynamics","Skyline Partners","Ember Technologies","Pulse Media","Vanguard Systems","Apex Industries","ClearView Analytics","Ironclad Security","Horizon Ventures","Summit Creative","Nexgen Robotics","BluePeak Software","Catalyst Innovations","Forge Digital","Radiant Health","Pinnacle Design","TrueNorth Consulting","Evergreen Solutions","Sterling & Co"];

const STREET_NAMES = ["Main St","Oak Ave","Elm St","Park Blvd","Cedar Ln","Maple Dr","Pine St","Washington Ave","Lake Rd","Highland Ave","River Rd","Spring St","Market St","Broadway","Sunset Blvd"];
const CITIES = ["New York, NY 10001","Los Angeles, CA 90001","Chicago, IL 60601","Houston, TX 77001","Phoenix, AZ 85001","Philadelphia, PA 19101","San Antonio, TX 78201","San Diego, CA 92101","Dallas, TX 75201","Austin, TX 78701","Seattle, WA 98101","Denver, CO 80201","Portland, OR 97201","Nashville, TN 37201","Miami, FL 33101","Atlanta, GA 30301","Boston, MA 02101","San Francisco, CA 94101"];

function address(): string { return `${randomInt(100, 9999)} ${pick(STREET_NAMES)}\n${pick(CITIES)}`; }

const PRODUCT_DATA = [
    { name: "Ultra Wireless Headphones Pro", brand: "SoundWave", category: "electronics", price: 249.99, weight: 340, desc: "Premium noise-cancelling wireless headphones with 40-hour battery life, Hi-Res audio support, and adaptive EQ." },
    { name: "Ergonomic Standing Desk", brand: "FlexiWork", category: "home_garden", price: 599.00, weight: 28000, desc: "Electric sit-stand desk with memory presets, cable management, and bamboo top." },
    { name: "Smart Fitness Watch X5", brand: "FitPulse", category: "electronics", price: 329.99, weight: 52, desc: "Advanced fitness tracker with GPS, heart rate monitor, SpO2 sensor, and 7-day battery life." },
    { name: "Organic Green Tea Collection", brand: "TeaHaven", category: "food_beverage", price: 34.99, weight: 450, desc: "Curated set of 6 premium organic green teas from Japan." },
    { name: "Professional Chef Knife Set", brand: "EdgeMaster", category: "home_garden", price: 189.00, weight: 2200, desc: "8-piece German steel knife set with ergonomic handles." },
    { name: "Yoga Mat Premium Plus", brand: "ZenFlow", category: "sports", price: 79.99, weight: 1800, desc: "Extra-thick 6mm eco-friendly yoga mat with alignment lines." },
    { name: "4K Webcam Studio Edition", brand: "ClearLens", category: "electronics", price: 149.99, weight: 185, desc: "Ultra HD 4K webcam with auto-framing, background blur, and studio-grade mic." },
    { name: "Leather Weekender Bag", brand: "Voyager", category: "clothing", price: 259.00, weight: 1450, desc: "Full-grain leather travel bag with laptop compartment." },
    { name: "Smart Home Hub Pro", brand: "ConnectAll", category: "electronics", price: 179.99, weight: 380, desc: "Central hub supporting Zigbee, Z-Wave, Wi-Fi, and Thread." },
    { name: "Plant-Based Protein Powder", brand: "GreenFuel", category: "health_beauty", price: 44.99, weight: 900, desc: "Organic pea and brown rice protein blend. 25g per serving." },
    { name: "Bamboo Desk Organizer", brand: "NeatSpace", category: "home_garden", price: 39.99, weight: 650, desc: "Multi-compartment bamboo organizer with phone stand." },
    { name: "Running Shoes UltraBoost", brand: "StrideTech", category: "sports", price: 169.99, weight: 280, desc: "Lightweight running shoes with responsive foam cushioning." },
    { name: "Mechanical Keyboard RGB", brand: "TypeForce", category: "electronics", price: 139.99, weight: 850, desc: "Hot-swappable mechanical keyboard with per-key RGB." },
    { name: "Scented Candle Gift Set", brand: "Lumière", category: "home_garden", price: 54.99, weight: 1200, desc: "Set of 4 hand-poured soy candles in seasonal scents." },
    { name: "Wireless Charging Pad Trio", brand: "ChargeUp", category: "electronics", price: 69.99, weight: 290, desc: "3-in-1 wireless charging station for phone, earbuds, and watch." },
    { name: "Vintage Denim Jacket", brand: "Heritage", category: "clothing", price: 129.00, weight: 780, desc: "Classic trucker-style denim jacket in medium wash." },
    { name: "Cold Brew Coffee Maker", brand: "BrewCraft", category: "home_garden", price: 49.99, weight: 680, desc: "1.5L glass cold brew maker with stainless steel mesh filter." },
    { name: "Adventure Board Game Collection", brand: "GameNight", category: "toys", price: 89.99, weight: 2800, desc: "Bundle of 3 award-winning strategy board games." },
    { name: "Bestselling Fiction Box Set", brand: "PageTurner", category: "books", price: 59.99, weight: 1900, desc: "Collection of 5 critically acclaimed novels." },
    { name: "Resistance Band Set Pro", brand: "FlexFit", category: "sports", price: 34.99, weight: 420, desc: "Set of 5 latex resistance bands (10-50 lbs) with accessories." },
    { name: "Portable Bluetooth Speaker", brand: "BoomBox", category: "electronics", price: 89.99, weight: 540, desc: "Waterproof IPX7 Bluetooth speaker with 360° sound." },
    { name: "Stainless Steel Water Bottle", brand: "HydroFlow", category: "sports", price: 29.99, weight: 350, desc: "Double-wall vacuum insulated 32oz bottle." },
    { name: "Face Serum Vitamin C", brand: "GlowSkin", category: "health_beauty", price: 38.99, weight: 60, desc: "20% Vitamin C serum with hyaluronic acid and vitamin E." },
    { name: "Minimalist Leather Wallet", brand: "SlimCarry", category: "clothing", price: 49.99, weight: 65, desc: "Ultra-thin RFID-blocking wallet in genuine leather." },
    { name: "Smart Indoor Garden Kit", brand: "GrowPod", category: "home_garden", price: 119.99, weight: 2100, desc: "Hydroponic indoor garden with LED grow lights and auto-watering." },
];

const POST_TITLES = [
    { title: "10 Design Principles Every Developer Should Know", slug: "design-principles-developers", status: "published" },
    { title: "Building Scalable APIs with Modern Backend Frameworks", slug: "scalable-apis-backend", status: "published" },
    { title: "The Future of AI in Content Management", slug: "ai-content-management-future", status: "published" },
    { title: "How We Reduced Our Database Costs by 70%", slug: "reduce-database-costs", status: "published" },
    { title: "A Complete Guide to TypeScript Best Practices", slug: "typescript-best-practices-guide", status: "published" },
    { title: "Remote Work: Building Culture in Distributed Teams", slug: "remote-work-distributed-culture", status: "published" },
    { title: "Performance Optimization Techniques for React Apps", slug: "react-performance-optimization", status: "published" },
    { title: "Understanding WebSocket Architecture Patterns", slug: "websocket-architecture-patterns", status: "needs_review" },
    { title: "The Rise of Edge Computing: What It Means for Developers", slug: "edge-computing-developers", status: "needs_review" },
    { title: "Security Best Practices for SaaS Applications", slug: "saas-security-best-practices", status: "published" },
    { title: "Why We Switched from MongoDB to PostgreSQL", slug: "mongodb-to-postgresql-migration", status: "published" },
    { title: "Designing Intuitive Admin Panels", slug: "designing-admin-panels", status: "draft" },
    { title: "GraphQL vs REST: A Practical Comparison", slug: "graphql-vs-rest-comparison", status: "published" },
    { title: "Automating Deployments with CI/CD Pipelines", slug: "cicd-pipeline-automation", status: "draft" },
    { title: "The Art of Writing Clean Code", slug: "writing-clean-code", status: "published" },
];

const TAG_NAMES = ["Engineering","Design","Product","DevOps","TypeScript","React","PostgreSQL","Performance","Security","AI","Remote Work","Best Practices","Tutorial","Case Study","Open Source"];

const TICKET_SUBJECTS = [
    "Unable to export data to CSV","Dashboard loading slowly after update",
    "SSO login failing for Google workspace users","Webhook notifications not being sent",
    "API rate limiting too aggressive for batch imports","Mobile app crashes on image upload",
    "Custom field validation not working for dates","Report generation times out for large datasets",
    "Permission denied when accessing shared workspace","Email notifications arriving with delay",
    "Calendar integration sync issues with Outlook","Search results not updating after document edit",
    "Two-factor authentication setup wizard broken","Bulk delete operation hangs indefinitely",
    "Dark mode rendering issues on settings page","File upload fails for files over 25MB",
    "Internationalization missing for new dashboard widgets","Auto-save conflicts with manual save",
    "Role-based access not properly cascading to sub-resources","PDF export cutting off table columns",
    "Real-time collaboration cursor jumps erratically","Integration with Slack not posting to correct channel",
    "Filter presets not saved between sessions","Chart colors not accessible for colorblind users",
    "Audit log missing entries for bulk operations",
];

const TICKET_DESCRIPTIONS = [
    "When attempting to export the customer list to CSV, the download starts but the file is empty. This happens consistently across Chrome and Firefox.\n\n**Steps to reproduce:**\n1. Navigate to Customers → All Customers\n2. Select 'Export to CSV' from the actions menu\n3. File downloads but contains only headers",
    "After the latest deployment, the main dashboard takes 15-20 seconds to load. Previously it loaded in under 2 seconds. The network tab shows multiple API calls taking 5+ seconds each.\n\nThis is affecting all users in our organization.",
    "Users authenticating via Google Workspace SSO are getting a 403 error after successful OAuth redirect. The error message says 'Invalid session token'. This started happening after we updated our OAuth consent screen.",
    "Webhooks configured for the `order.created` event are not firing. We've verified the endpoint is accessible and responding with 200. The webhook delivery log shows no attempts.",
    "We're running batch imports of ~50,000 records and hitting rate limits after ~200 requests. The current 60 req/min limit makes our nightly sync take over 4 hours.",
    "On iOS 17, attempting to upload a profile picture causes the app to crash immediately. Android works fine. The crash log points to a memory issue with image processing.",
];

const EXERCISE_DATA = [
    { name: "Barbell Back Squat", category: "strength", difficulty: "intermediate", equipment: ["barbell"], bodyParts: ["quads","glutes","hamstrings","lower_back"], compound: true, reps: 8, sets: 4, rest: 120, cal: 8 },
    { name: "Bench Press", category: "strength", difficulty: "intermediate", equipment: ["barbell","bench"], bodyParts: ["chest","triceps","shoulders"], compound: true, reps: 10, sets: 4, rest: 90, cal: 7 },
    { name: "Deadlift", category: "strength", difficulty: "advanced", equipment: ["barbell"], bodyParts: ["hamstrings","glutes","lower_back","forearms"], compound: true, reps: 5, sets: 5, rest: 180, cal: 10 },
    { name: "Pull-Up", category: "calisthenics", difficulty: "intermediate", equipment: ["pull_up_bar"], bodyParts: ["upper_back","biceps","forearms"], compound: true, reps: 8, sets: 4, rest: 90, cal: 6 },
    { name: "Plank", category: "calisthenics", difficulty: "beginner", equipment: ["none"], bodyParts: ["abs","obliques","shoulders"], compound: false, reps: 60, sets: 3, rest: 60, cal: 3 },
    { name: "Dumbbell Lunges", category: "strength", difficulty: "beginner", equipment: ["dumbbell"], bodyParts: ["quads","glutes","hamstrings"], compound: true, reps: 12, sets: 3, rest: 60, cal: 6 },
    { name: "Kettlebell Swing", category: "strength", difficulty: "intermediate", equipment: ["kettlebell"], bodyParts: ["glutes","hamstrings","lower_back","shoulders"], compound: true, reps: 15, sets: 4, rest: 60, cal: 9 },
    { name: "Mountain Climbers", category: "cardio", difficulty: "beginner", equipment: ["none"], bodyParts: ["abs","quads","shoulders"], compound: true, reps: 30, sets: 3, rest: 45, cal: 11 },
    { name: "Resistance Band Pull-Apart", category: "strength", difficulty: "beginner", equipment: ["resistance_band"], bodyParts: ["upper_back","shoulders"], compound: false, reps: 15, sets: 3, rest: 45, cal: 3 },
    { name: "Box Jumps", category: "plyometrics", difficulty: "intermediate", equipment: ["box"], bodyParts: ["quads","glutes","calves"], compound: true, reps: 10, sets: 4, rest: 90, cal: 8 },
    { name: "TRX Row", category: "strength", difficulty: "beginner", equipment: ["trx"], bodyParts: ["upper_back","biceps","abs"], compound: true, reps: 12, sets: 3, rest: 60, cal: 5 },
    { name: "Burpees", category: "cardio", difficulty: "intermediate", equipment: ["none"], bodyParts: ["chest","quads","abs","shoulders"], compound: true, reps: 12, sets: 4, rest: 60, cal: 12 },
    { name: "Cable Face Pull", category: "strength", difficulty: "beginner", equipment: ["cable_machine"], bodyParts: ["shoulders","upper_back"], compound: false, reps: 15, sets: 3, rest: 45, cal: 3 },
    { name: "Overhead Press", category: "strength", difficulty: "intermediate", equipment: ["barbell"], bodyParts: ["shoulders","triceps"], compound: true, reps: 8, sets: 4, rest: 90, cal: 6 },
    { name: "Hip Flexor Stretch", category: "flexibility", difficulty: "beginner", equipment: ["none"], bodyParts: ["hip_flexors","quads"], compound: false, reps: 30, sets: 2, rest: 30, cal: 2 },
    { name: "Medicine Ball Slam", category: "plyometrics", difficulty: "intermediate", equipment: ["medicine_ball"], bodyParts: ["abs","shoulders","upper_back"], compound: true, reps: 12, sets: 3, rest: 60, cal: 9 },
    { name: "Foam Roller Thoracic Extension", category: "flexibility", difficulty: "beginner", equipment: ["foam_roller"], bodyParts: ["upper_back"], compound: false, reps: 10, sets: 2, rest: 30, cal: 1 },
    { name: "Dumbbell Romanian Deadlift", category: "strength", difficulty: "intermediate", equipment: ["dumbbell"], bodyParts: ["hamstrings","glutes","lower_back"], compound: true, reps: 10, sets: 3, rest: 90, cal: 7 },
    { name: "Battle Ropes", category: "cardio", difficulty: "intermediate", equipment: ["none"], bodyParts: ["shoulders","abs","forearms"], compound: true, reps: 30, sets: 4, rest: 60, cal: 13 },
    { name: "Pistol Squat", category: "calisthenics", difficulty: "advanced", equipment: ["none"], bodyParts: ["quads","glutes","calves","hip_flexors"], compound: true, reps: 5, sets: 3, rest: 120, cal: 7 },
];

// ─── Delete All ──────────────────────────────────────────────────────
async function deleteAll(slug: string): Promise<void> {
    console.log(`  🗑️  Deleting all ${slug}...`);
    let deleted = 0;
    while (true) {
        const res = await apiGet<{ data: Array<{ id: string }>, meta: { total: number } }>(`/data/${slug}?limit=50`);
        if (!res.data || res.data.length === 0) break;
        for (const entity of res.data) {
            await apiDelete(`/data/${slug}/${entity.id}`);
            deleted++;
        }
    }
    console.log(`     ✓ Deleted ${deleted} ${slug}`);
}

// ─── Seed Functions ──────────────────────────────────────────────────
async function seedTags(): Promise<string[]> {
    console.log("  🏷️  Seeding tags...");
    const ids: string[] = [];
    for (const name of TAG_NAMES) {
        const id = uuid();
        await apiPost(`/data/tags`, { id, name });
        ids.push(id);
    }
    console.log(`     ✓ Created ${ids.length} tags`);
    return ids;
}

async function seedAuthors(): Promise<string[]> {
    console.log("  ✍️  Seeding authors...");
    const data = [
        { name: "Sarah Chen", email: "sarah.chen@example.com", bio: "Senior engineer and technical writer with 12 years of experience in distributed systems.", twitter: "@sarahcodes", github: "sarahchen" },
        { name: "Marcus Rodriguez", email: "marcus.r@example.com", bio: "Full-stack developer and open-source advocate. Contributor to React, Next.js, and various developer tools.", twitter: "@marcusdev", github: "marcusrodriguez" },
        { name: "Priya Patel", email: "priya.patel@example.com", bio: "Product designer turned developer. Passionate about bridging design and engineering.", twitter: "@priyabuilds", github: "priyapatel" },
        { name: "Alex Thompson", email: "alex.t@example.com", bio: "DevOps specialist and cloud architect. AWS certified. Writes about infrastructure and automation.", twitter: "@alexops", github: "alexthompson" },
        { name: "Elena Vasquez", email: "elena.v@example.com", bio: "Data engineer and ML enthusiast. Building the future of intelligent content management.", twitter: "@elenaml", github: "elenavasquez" },
    ];
    const ids: string[] = [];
    for (const a of data) {
        const id = uuid();
        await apiPost(`/data/authors`, { id, ...a });
        ids.push(id);
    }
    console.log(`     ✓ Created ${ids.length} authors`);
    return ids;
}

async function seedPosts(authorIds: string[], tagIds: string[]): Promise<void> {
    console.log("  📝 Seeding blog posts...");
    for (const post of POST_TITLES) {
        const id = uuid();
        const publishDate = post.status === "published" ? pastDate(180) : (post.status === "needs_review" ? pastDate(7) : null);
        await apiPost(`/data/posts`, {
            id,
            title: post.title,
            slug: post.slug,
            excerpt: `A deep dive into ${post.title.toLowerCase()}. Learn the key concepts, practical tips, and real-world examples to level up your skills.`,
            status: post.status,
            publish_date: publishDate,
            author_id: pick(authorIds),
            tags_ids: pickN(tagIds, 2, 5),
        });
    }
    console.log(`     ✓ Created ${POST_TITLES.length} posts`);
}

async function seedCustomers(): Promise<string[]> {
    console.log("  👥 Seeding customers...");
    const ids: string[] = [];
    const usedEmails = new Set<string>();

    for (let i = 0; i < 40; i++) {
        const id = uuid();
        const firstName = pick(FIRST_NAMES);
        const lastName = pick(LAST_NAMES);
        let email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${pick(["gmail.com","outlook.com","company.com","protonmail.com","yahoo.com"])}`;
        while (usedEmails.has(email)) {
            email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${randomInt(1, 999)}@${pick(["gmail.com","outlook.com","company.com"])}`;
        }
        usedEmails.add(email);

        const isVip = Math.random() < 0.15;
        const totalOrders = isVip ? randomInt(10, 50) : randomInt(0, 12);
        const lifetimeValue = parseFloat((totalOrders * randomFloat(40, 300)).toFixed(2));

        await apiPost(`/data/customers`, {
            id,
            first_name: firstName,
            last_name: lastName,
            email,
            phone: `+1 (${randomInt(200, 999)}) ${randomInt(200, 999)}-${randomInt(1000, 9999)}`,
            company: Math.random() < 0.6 ? pick(COMPANIES) : null,
            is_vip: isVip,
            lifetime_value: lifetimeValue,
            total_orders: totalOrders,
            shipping_address: address(),
            billing_address: Math.random() < 0.7 ? address() : null,
            notes: Math.random() < 0.3 ? pick([
                "Prefers express shipping",
                "Key account — handle with care",
                "Referred by partner program",
                "Seasonal buyer — active Q4",
                "Requested custom invoicing",
                "Has pending support ticket",
                "Wholesale pricing agreement in place",
            ]) : null,
        });
        ids.push(id);
    }
    console.log(`     ✓ Created ${ids.length} customers`);
    return ids;
}

async function seedProducts(): Promise<string[]> {
    console.log("  📦 Seeding products...");
    const ids: string[] = [];
    const usedSkus = new Set<string>();

    for (let i = 0; i < PRODUCT_DATA.length; i++) {
        const p = PRODUCT_DATA[i];
        const id = uuid();
        let sku = `SKU-${p.category.substring(0, 3).toUpperCase()}-${String(i + 1).padStart(4, "0")}`;
        while (usedSkus.has(sku)) sku = `SKU-${p.category.substring(0, 3).toUpperCase()}-${String(randomInt(1000, 9999))}`;
        usedSkus.add(sku);

        const status = Math.random() < 0.75 ? "active" : (Math.random() < 0.5 ? "draft" : "archived");
        const compareAt = Math.random() < 0.3 ? parseFloat((p.price * randomFloat(1.15, 1.5)).toFixed(2)) : null;
        const cost = parseFloat((p.price * randomFloat(0.3, 0.6)).toFixed(2));

        await apiPost(`/data/products`, {
            id,
            name: p.name,
            sku,
            description: p.desc,
            brand: p.brand,
            category: p.category,
            price: p.price,
            compare_at_price: compareAt,
            cost,
            stock_quantity: status === "active" ? randomInt(0, 500) : randomInt(0, 50),
            low_stock_threshold: 10,
            weight_grams: p.weight,
            rating: randomFloat(3.2, 5.0, 1),
            review_count: randomInt(0, 850),
            status,
            is_featured: Math.random() < 0.2,
        });
        ids.push(id);
    }
    console.log(`     ✓ Created ${ids.length} products`);
    return ids;
}

async function seedOrders(customerIds: string[], productIds: string[]): Promise<void> {
    console.log("  🛒 Seeding orders...");
    const usedNums = new Set<string>();
    const statuses = ["pending","confirmed","processing","shipped","delivered","cancelled","refunded"];
    const weights = [0.08, 0.12, 0.10, 0.15, 0.40, 0.08, 0.07];

    function weightedStatus(): string {
        const r = Math.random();
        let c = 0;
        for (let i = 0; i < statuses.length; i++) { c += weights[i]; if (r <= c) return statuses[i]; }
        return "delivered";
    }

    let orderItemCount = 0;
    for (let i = 0; i < 60; i++) {
        const id = uuid();
        const year = pick(["2025","2026"]);
        let num = `ORD-${year}-${String(randomInt(1, 9999)).padStart(4, "0")}`;
        while (usedNums.has(num)) num = `ORD-${year}-${String(randomInt(1, 9999)).padStart(4, "0")}`;
        usedNums.add(num);

        const status = weightedStatus();
        const orderDate = pastDate(365);
        const orderProducts = pickN(productIds, 1, 5);
        let subtotal = 0;
        const items: Array<{ pId: string; name: string; sku: string; qty: number; price: number }> = [];

        for (const pid of orderProducts) {
            const idx = productIds.indexOf(pid);
            const pd = PRODUCT_DATA[idx];
            if (!pd) continue;
            const qty = randomInt(1, 3);
            items.push({ pId: pid, name: pd.name, sku: `SKU-${pd.category.substring(0, 3).toUpperCase()}-${String(idx + 1).padStart(4, "0")}`, qty, price: pd.price });
            subtotal += pd.price * qty;
        }

        const tax = parseFloat((subtotal * randomFloat(0.05, 0.10)).toFixed(2));
        const shipping = subtotal > 100 ? 0 : randomFloat(5.99, 14.99);
        const discount = Math.random() < 0.25 ? parseFloat((subtotal * randomFloat(0.05, 0.20)).toFixed(2)) : 0;
        const total = parseFloat((subtotal + tax + shipping - discount).toFixed(2));
        const paymentStatus = ["cancelled","refunded"].includes(status) ? "refunded" : status === "pending" ? (Math.random() < 0.5 ? "unpaid" : "paid") : "paid";
        const shippedDate = ["shipped","delivered"].includes(status) ? pastDate(60) : null;
        const deliveredDate = status === "delivered" ? pastDate(30) : null;
        const tracking = ["shipped","delivered"].includes(status) ? `${pick(["1Z","94","92","FX"])}${randomInt(100000000, 999999999)}` : null;

        await apiPost(`/data/orders`, {
            id, order_number: num, customer_id: pick(customerIds), status, payment_status: paymentStatus,
            subtotal: parseFloat(subtotal.toFixed(2)), tax_amount: tax, shipping_cost: shipping,
            discount_amount: discount, total, currency: pick(["USD","USD","USD","EUR","GBP"]),
            shipping_address: address(), tracking_number: tracking, order_date: orderDate,
            shipped_date: shippedDate, delivered_date: deliveredDate,
            notes: Math.random() < 0.2 ? pick(["Customer requested gift wrapping","Express shipping — priority fulfillment","Hold until customer confirms address change","Replacement order — original damaged in transit","Wholesale pricing applied per agreement"]) : null,
        });

        for (const item of items) {
            const itemId = uuid();
            await apiPost(`/data/order_items`, {
                id: itemId, order_id: id, product_id: item.pId, product_name: item.name,
                sku: item.sku, quantity: item.qty, unit_price: item.price,
                line_total: parseFloat((item.price * item.qty).toFixed(2)),
            });
            orderItemCount++;
        }
    }
    console.log(`     ✓ Created 60 orders with ${orderItemCount} line items`);
}

async function seedTickets(customerIds: string[]): Promise<void> {
    console.log("  🎫 Seeding tickets...");
    const usedNums = new Set<string>();

    for (let i = 0; i < TICKET_SUBJECTS.length; i++) {
        const id = uuid();
        let num = `TK-2026-${String(randomInt(1, 9999)).padStart(4, "0")}`;
        while (usedNums.has(num)) num = `TK-2026-${String(randomInt(1, 9999)).padStart(4, "0")}`;
        usedNums.add(num);

        const status = pick(["open","in_progress","waiting","resolved","closed"]);
        const desc = i < TICKET_DESCRIPTIONS.length ? TICKET_DESCRIPTIONS[i] : `Detailed description of the issue: "${TICKET_SUBJECTS[i]}".\n\nThis has been reported by multiple users and needs investigation.`;
        const resolution = ["resolved","closed"].includes(status) ? pick([
            "Fixed in v2.4.1. Root cause was a missing index on the `events` table.",
            "Resolved by updating the OAuth scope configuration. Deployed to production.",
            "This was a known issue with the third-party integration. Updated the SDK version.",
            "User error — provided documentation link and walkthrough.",
            "Implemented the requested feature. Available in next release.",
        ]) : null;

        await apiPost(`/data/tickets`, {
            id, ticket_number: num, subject: TICKET_SUBJECTS[i], description: desc,
            resolution_notes: resolution, status, priority: pick(["low","medium","high","urgent"]),
            category: pick(["bug","feature_request","question","billing","account","other"]),
            customer_id: pick(customerIds), assigned_to: pick(["user_sarah","user_marcus","user_priya","user_alex", null, null]),
        });
    }
    console.log(`     ✓ Created ${TICKET_SUBJECTS.length} tickets`);
}

async function seedExercises(): Promise<void> {
    console.log("  💪 Seeding exercises...");
    for (const ex of EXERCISE_DATA) {
        const id = uuid();
        // Note: equipment and body_parts are jsonb array columns.
        // The Rebase API has a bug with array-typed jsonb fields in POST,
        // so we skip them here and populate via direct SQL after seeding.
        await apiPost(`/data/exercises`, {
            id, name: ex.name,
            description: `${ex.name} is a ${ex.difficulty} ${ex.category} exercise that targets ${ex.bodyParts.join(", ")}. ${ex.compound ? "This is a compound movement engaging multiple muscle groups." : "This is an isolation exercise for targeted muscle work."}`,
            difficulty: ex.difficulty, category: ex.category,
            instructions: `## How to perform ${ex.name}\n\n1. Set up in the starting position\n2. Maintain proper form throughout the movement\n3. Control the eccentric (lowering) phase\n4. Complete the concentric (lifting) phase\n5. Return to starting position\n\n**Tip:** Focus on mind-muscle connection for maximum benefit.`,
            default_reps: ex.reps, default_sets: ex.sets, rest_seconds: ex.rest,
            calories_per_minute: ex.cal, is_compound: ex.compound,
            is_featured: Math.random() < 0.25, status: Math.random() < 0.85 ? "published" : "draft",
        });
    }
    console.log(`     ✓ Created ${EXERCISE_DATA.length} exercises`);
}

// ─── Main ────────────────────────────────────────────────────────────
async function main() {
    console.log("🚀 Starting Edith CRM seed...\n");

    // Phase 1: Delete everything (children first for FK constraints)
    console.log("Phase 1: Clearing existing data\n");
    await deleteAll("order_items");
    await deleteAll("orders");
    await deleteAll("tickets");
    await deleteAll("posts");
    await deleteAll("product_locales");
    await deleteAll("products");
    await deleteAll("customers");
    await deleteAll("tags");
    await deleteAll("authors");
    await deleteAll("exercises");
    console.log("\n✅ All existing data deleted.\n");

    // Phase 2: Seed fresh data
    console.log("Phase 2: Seeding fresh data\n");
    const tagIds = await seedTags();
    const authorIds = await seedAuthors();
    await seedPosts(authorIds, tagIds);
    const customerIds = await seedCustomers();
    const productIds = await seedProducts();
    await seedOrders(customerIds, productIds);
    await seedTickets(customerIds);
    await seedExercises();

    console.log("\n✨ Seed complete! Summary:");
    console.log(`   • ${TAG_NAMES.length} tags`);
    console.log(`   • 5 authors`);
    console.log(`   • ${POST_TITLES.length} blog posts`);
    console.log(`   • 40 customers`);
    console.log(`   • ${PRODUCT_DATA.length} products`);
    console.log(`   • 60 orders (with order items)`);
    console.log(`   • ${TICKET_SUBJECTS.length} tickets`);
    console.log(`   • ${EXERCISE_DATA.length} exercises`);
    console.log("\n🎉 Edith CRM is ready to showcase!");
}

main().catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
});
