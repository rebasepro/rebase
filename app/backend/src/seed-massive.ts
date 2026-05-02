import { createPostgresDatabaseConnection } from "@rebasepro/server-postgresql";
import { env } from "./env.js";
import { 
    authors, posts, tags, profiles, products, orders, 
    postsTags, ordersProducts, privateNotes 
} from "./schema.generated.js";
import fs from "fs";
import path from "path";
import { faker } from "@faker-js/faker";

// Read files from local storage (uploads directory)
const uploadsDir = path.join(process.cwd(), "..", "uploads", "default");
function getLocalFiles(dir: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;
    const list = fs.readdirSync(dir);
    for (const file of list) {
        if (file.endsWith(".json")) continue; // Skip metadata
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            results.push(...getLocalFiles(fullPath));
        } else {
            // Keep the relative path starting after 'default/'
            const relative = fullPath.replace(uploadsDir + "/", "");
            results.push(relative);
        }
    }
    return results;
}

const pictureFiles = getLocalFiles(uploadsDir);
if (pictureFiles.length === 0) {
    pictureFiles.push("author_pictures/default.png");
}

function getRandomPic() {
    return pictureFiles[Math.floor(Math.random() * pictureFiles.length)];
}

async function runSeed() {
    console.log("Connecting to database...");
    const { db, pool } = createPostgresDatabaseConnection(env.DATABASE_URL, undefined, {
        max: 1
    });

    try {
        console.log("Clearing existing data...");
        await db.execute("TRUNCATE TABLE posts, authors, profiles, tags, private_notes, products, orders CASCADE;");

        console.log(`Found ${pictureFiles.length} files in local storage.`);

        const BATCH_SIZE = 1000;
        
        // Define exact limits
        const NUM_AUTHORS = 5000;
        const NUM_TAGS = 1000;
        const NUM_POSTS = 50000;
        const NUM_PRODUCTS = 10000;
        const NUM_ORDERS = 50000;
        const NUM_NOTES = 5000;

        faker.seed(123); // For reproducible realistic data

        console.log(`Generating ${NUM_AUTHORS} authors & profiles...`);
        for (let i = 0; i < NUM_AUTHORS; i += BATCH_SIZE) {
            const authorValues = [];
            const profileValues = [];
            for (let j = 1; j <= BATCH_SIZE; j++) {
                const id = i + j;
                const name = faker.person.fullName();
                const email = faker.internet.email({ firstName: name });
                authorValues.push({
                    id,
                    name,
                    email,
                    picture: getRandomPic(),
                    userId: id % 5 === 0 ? `user-${id}` : null
                });
                profileValues.push({
                    id,
                    bio: faker.person.bio(),
                    website: faker.internet.url(),
                    author_id: id
                });
            }
            await db.insert(authors).values(authorValues);
            await db.insert(profiles).values(profileValues);
        }

        console.log(`Generating ${NUM_TAGS} tags...`);
        const tagValues = [];
        const generatedTags = new Set<string>();
        for (let i = 1; i <= NUM_TAGS; i++) {
            let tagName = faker.word.noun();
            // Ensure unique names
            while (generatedTags.has(tagName)) {
                tagName = `${faker.word.adjective()} ${faker.word.noun()}`;
            }
            generatedTags.add(tagName);
            tagValues.push({ id: i, name: tagName });
        }
        for (let i = 0; i < NUM_TAGS; i += BATCH_SIZE) {
            await db.insert(tags).values(tagValues.slice(i, i + BATCH_SIZE));
        }

        console.log(`Generating ${NUM_POSTS} posts...`);
        const postStatuses = ["draft", "review", "published", "archived"];
        for (let i = 0; i < NUM_POSTS; i += BATCH_SIZE) {
            const postValues = [];
            for (let j = 1; j <= BATCH_SIZE; j++) {
                const id = i + j;
                postValues.push({
                    id,
                    title: faker.lorem.sentence({ min: 4, max: 10 }),
                    content: faker.lorem.paragraphs({ min: 3, max: 7 }, '\n\n'),
                    status: faker.helpers.arrayElement(postStatuses) as any,
                    author_id: faker.number.int({ min: 1, max: NUM_AUTHORS })
                });
            }
            await db.insert(posts).values(postValues);
        }

        console.log("Generating posts_tags relations...");
        for (let i = 0; i < NUM_POSTS; i += BATCH_SIZE) {
            const postsTagsValues = [];
            for (let j = 1; j <= BATCH_SIZE; j++) {
                const postId = i + j;
                const numTags = faker.number.int({ min: 1, max: 4 });
                const assignedTags = new Set<number>();
                for (let k = 0; k < numTags; k++) {
                    assignedTags.add(faker.number.int({ min: 1, max: NUM_TAGS }));
                }
                for (const tagId of assignedTags) {
                    postsTagsValues.push({ post_id: postId, tag_id: tagId });
                }
            }
            await db.insert(postsTags).values(postsTagsValues);
        }

        console.log(`Generating ${NUM_PRODUCTS} products...`);
        const categories = ["electronics", "clothing", "home"];
        for (let i = 0; i < NUM_PRODUCTS; i += BATCH_SIZE) {
            const productValues = [];
            for (let j = 1; j <= BATCH_SIZE; j++) {
                const id = i + j;
                productValues.push({
                    id,
                    name: faker.commerce.productName(),
                    description: faker.commerce.productDescription(),
                    price: faker.commerce.price({ min: 10, max: 2000 }),
                    stock: faker.number.int({ min: 0, max: 1000 }).toString(),
                    category: faker.helpers.arrayElement(categories) as any
                });
            }
            await db.insert(products).values(productValues);
        }

        console.log(`Generating ${NUM_ORDERS} orders...`);
        const orderStatuses = ["pending", "shipped", "delivered", "cancelled"];
        for (let i = 0; i < NUM_ORDERS; i += BATCH_SIZE) {
            const orderValues = [];
            for (let j = 1; j <= BATCH_SIZE; j++) {
                const id = i + j;
                orderValues.push({
                    id,
                    customer_name: faker.person.fullName(),
                    status: faker.helpers.arrayElement(orderStatuses) as any
                });
            }
            await db.insert(orders).values(orderValues);
        }

        console.log("Generating orders_products relations...");
        for (let i = 0; i < NUM_ORDERS; i += BATCH_SIZE) {
            const ordersProductsValues = [];
            for (let j = 1; j <= BATCH_SIZE; j++) {
                const orderId = i + j;
                const numProducts = faker.number.int({ min: 1, max: 5 });
                const assignedProducts = new Set<number>();
                for (let k = 0; k < numProducts; k++) {
                    assignedProducts.add(faker.number.int({ min: 1, max: NUM_PRODUCTS }));
                }
                for (const productId of assignedProducts) {
                    ordersProductsValues.push({ order_id: orderId, product_id: productId });
                }
            }
            await db.insert(ordersProducts).values(ordersProductsValues);
        }

        console.log(`Generating ${NUM_NOTES} private notes...`);
        for (let i = 0; i < NUM_NOTES; i += BATCH_SIZE) {
            const noteValues = [];
            for (let j = 1; j <= BATCH_SIZE; j++) {
                const id = i + j;
                noteValues.push({
                    title: faker.lorem.words({ min: 2, max: 6 }),
                    content: faker.lorem.paragraph({ min: 2, max: 5 }),
                    user_id: `user-${faker.number.int({ min: 1, max: 100 })}`,
                    is_locked: faker.datatype.boolean({ probability: 0.2 })
                });
            }
            await db.insert(privateNotes).values(noteValues);
        }

        console.log("Database seeded successfully with massive realistic dataset!");
    } catch (e) {
        console.error("Error seeding database:", e);
    } finally {
        await pool.end();
    }
}

runSeed();
