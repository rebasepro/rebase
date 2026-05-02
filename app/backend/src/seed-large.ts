import { createPostgresDatabaseConnection } from "@rebasepro/server-postgresql";
import { env } from "./env.js";
import { 
    authors, posts, tags, profiles, products, orders, 
    postsTags, ordersProducts, privateNotes 
} from "./schema.generated.js";

const pictureFiles = [
    "author_pictures/0phas_Gemini_Generated_Image_.jpeg",
    "author_pictures/5kuxx_chromaflow_landing_page.png",
    "author_pictures/9h9s0_Gemini_Generated_Image_hwxqw4hwxqw4hwxq.jpeg",
    "author_pictures/jbiri_77035b3e-cb2f-42a2-85c9-813d7a9045eb.avif",
    "author_pictures/nxih4_logo_small.png",
    "author_pictures/v166u_xvu6k_Frame 45 (1).png",
    "author_pictures/w48fo_Frame 45.png",
    "author_pictures/w5l1n_xvu6k_Frame 45 (1).png"
];

function getRandomPic() {
    return pictureFiles[Math.floor(Math.random() * pictureFiles.length)];
}

const firstNames = ["James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda", "William", "Elizabeth", "David", "Barbara", "Richard", "Susan", "Joseph", "Jessica", "Thomas", "Sarah", "Charles", "Karen"];
const lastNames = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin"];

function randomName() {
    return `${firstNames[Math.floor(Math.random() * firstNames.length)]} ${lastNames[Math.floor(Math.random() * lastNames.length)]}`;
}

async function runSeed() {
    console.log("Connecting to database...");
    const { db, pool } = createPostgresDatabaseConnection(env.DATABASE_URL, undefined, {
        max: 1
    });

    try {
        console.log("Clearing existing data...");
        await db.execute("TRUNCATE TABLE posts, authors, profiles, tags, private_notes, products, orders CASCADE;");

        console.log("Generating 50 authors & profiles...");
        const authorValues = [];
        const profileValues = [];
        for (let i = 1; i <= 50; i++) {
            const name = randomName();
            const email = `${name.toLowerCase().replace(" ", ".")}@example.com`;
            authorValues.push({
                id: i,
                name,
                email,
                picture: getRandomPic(),
                userId: i % 5 === 0 ? `user-${i}` : null
            });
            profileValues.push({
                id: i,
                bio: `Bio for ${name}, passionate about technology and writing.`,
                website: `https://${name.toLowerCase().replace(" ", "")}.com`,
                author_id: i
            });
        }
        await db.insert(authors).values(authorValues);
        await db.insert(profiles).values(profileValues);

        console.log("Generating 50 tags...");
        const tagNames = ["React", "TypeScript", "Node.js", "PostgreSQL", "GraphQL", "Docker", "Kubernetes", "AWS", "Python", "Rust", "Go", "CSS", "HTML", "UI/UX", "Design", "DevOps", "AI", "Machine Learning", "Data Science", "Security", "Web3", "Blockchain", "Open Source", "Testing", "CI/CD", "Serverless", "Microservices", "Frontend", "Backend", "Fullstack", "Mobile", "iOS", "Android", "React Native", "Flutter", "Swift", "Kotlin", "Java", "C++", "C#", ".NET", "Ruby", "Rails", "PHP", "Laravel", "Vue", "Angular", "Svelte", "Next.js", "Nuxt.js"];
        const tagValues = tagNames.map((name, i) => ({ id: i + 1, name }));
        await db.insert(tags).values(tagValues);

        console.log("Generating 200 posts...");
        const postStatuses = ["draft", "review", "published", "archived"];
        const postValues = [];
        for (let i = 1; i <= 200; i++) {
            postValues.push({
                id: i,
                title: `Awesome Post Title ${i}`,
                content: `This is the content for awesome post ${i}. It covers many interesting topics and ideas.`,
                status: postStatuses[Math.floor(Math.random() * postStatuses.length)] as any,
                author_id: Math.floor(Math.random() * 50) + 1
            });
        }
        await db.insert(posts).values(postValues);

        console.log("Generating posts_tags relations...");
        const postsTagsValues = [];
        for (let i = 1; i <= 200; i++) {
            // Give each post 1 to 4 tags
            const numTags = Math.floor(Math.random() * 4) + 1;
            const assignedTags = new Set<number>();
            for (let j = 0; j < numTags; j++) {
                assignedTags.add(Math.floor(Math.random() * 50) + 1);
            }
            for (const tagId of assignedTags) {
                postsTagsValues.push({ post_id: i, tag_id: tagId });
            }
        }
        await db.insert(postsTags).values(postsTagsValues);

        console.log("Generating 100 products...");
        const categories = ["electronics", "clothing", "home"];
        const productValues = [];
        for (let i = 1; i <= 100; i++) {
            const cat = categories[Math.floor(Math.random() * categories.length)];
            productValues.push({
                id: i,
                name: `${cat === "clothing" ? "Cotton " : "Premium "}${cat} Item ${i}`,
                description: `Description for product ${i} in ${cat}. High quality and durable.`,
                price: (Math.random() * 200 + 10).toFixed(2),
                stock: Math.floor(Math.random() * 500).toString(),
                category: cat as any
            });
        }
        await db.insert(products).values(productValues);

        console.log("Generating 200 orders...");
        const orderStatuses = ["pending", "shipped", "delivered", "cancelled"];
        const orderValues = [];
        for (let i = 1; i <= 200; i++) {
            orderValues.push({
                id: i,
                customer_name: randomName(),
                status: orderStatuses[Math.floor(Math.random() * orderStatuses.length)] as any
            });
        }
        await db.insert(orders).values(orderValues);

        console.log("Generating orders_products relations...");
        const ordersProductsValues = [];
        for (let i = 1; i <= 200; i++) {
            // Give each order 1 to 5 products
            const numProducts = Math.floor(Math.random() * 5) + 1;
            const assignedProducts = new Set<number>();
            for (let j = 0; j < numProducts; j++) {
                assignedProducts.add(Math.floor(Math.random() * 100) + 1);
            }
            for (const productId of assignedProducts) {
                ordersProductsValues.push({ order_id: i, product_id: productId });
            }
        }
        await db.insert(ordersProducts).values(ordersProductsValues);

        console.log("Generating 50 private notes...");
        const noteValues = [];
        for (let i = 1; i <= 50; i++) {
            noteValues.push({
                title: `Private Note ${i}`,
                content: `This is a highly confidential note ${i}...`,
                user_id: `user-${Math.floor(Math.random() * 10) + 1}`,
                is_locked: Math.random() > 0.8
            });
        }
        await db.insert(privateNotes).values(noteValues);

        console.log("Database seeded successfully with large dataset!");
    } catch (e) {
        console.error("Error seeding database:", e);
    } finally {
        await pool.end();
    }
}

runSeed();
