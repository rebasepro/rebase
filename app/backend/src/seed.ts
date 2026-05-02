import { createPostgresDatabaseConnection } from "@rebasepro/server-postgresql";
import { env } from "./env.js";
import { 
    authors, posts, tags, profiles, products, orders, 
    postsTags, ordersProducts, privateNotes 
} from "./schema.generated.js";

async function runSeed() {
    console.log("Connecting to database...");
    const { db, pool } = createPostgresDatabaseConnection(env.DATABASE_URL, undefined, {
        max: 1
    });

    try {
        console.log("Inserting data into authors...");
        const insertedAuthors = await db.insert(authors).values([
            { id: 1, name: "Alice Johnson", email: "alice@example.com", picture: "https://i.pravatar.cc/150?u=alice", userId: "user-1" },
            { id: 2, name: "Bob Smith", email: "bob@example.com", picture: "https://i.pravatar.cc/150?u=bob", userId: "user-2" },
            { id: 3, name: "Charlie Davis", email: "charlie@example.com", picture: "https://i.pravatar.cc/150?u=charlie", userId: "user-3" }
        ]).returning();

        console.log("Inserting data into profiles...");
        await db.insert(profiles).values([
            { id: 1, bio: "Tech enthusiast and writer.", website: "https://alice.dev", author_id: 1 },
            { id: 2, bio: "Software engineer focusing on open source.", website: "https://bob.codes", author_id: 2 }
        ]);

        console.log("Inserting data into tags...");
        const insertedTags = await db.insert(tags).values([
            { id: 1, name: "React" },
            { id: 2, name: "PostgreSQL" },
            { id: 3, name: "Typescript" },
            { id: 4, name: "Node.js" }
        ]).returning();

        console.log("Inserting data into posts...");
        const insertedPosts = await db.insert(posts).values([
            { id: 1, title: "Getting started with React", content: "React is a great UI library...", status: "published", author_id: 1 },
            { id: 2, title: "Advanced PostgreSQL patterns", content: "Postgres can do so much more than basic CRUD...", status: "published", author_id: 2 },
            { id: 3, title: "Why Typescript is essential", content: "Typescript adds safety...", status: "draft", author_id: 1 }
        ]).returning();

        console.log("Inserting data into postsTags...");
        await db.insert(postsTags).values([
            { post_id: 1, tag_id: 1 },
            { post_id: 2, tag_id: 2 },
            { post_id: 3, tag_id: 3 },
            { post_id: 1, tag_id: 3 }
        ]);

        console.log("Inserting data into products...");
        const insertedProducts = await db.insert(products).values([
            { id: 1, name: "Wireless Keyboard", description: "Mechanical wireless keyboard", price: "99.99", stock: "100", category: "electronics" },
            { id: 2, name: "Ergonomic Mouse", description: "Vertical ergonomic mouse", price: "49.99", stock: "50", category: "electronics" },
            { id: 3, name: "Cotton T-Shirt", description: "Comfortable cotton t-shirt", price: "19.99", stock: "200", category: "clothing" }
        ]).returning();

        console.log("Inserting data into orders...");
        const insertedOrders = await db.insert(orders).values([
            { id: 1, customer_name: "John Doe", status: "delivered" },
            { id: 2, customer_name: "Jane Roe", status: "pending" }
        ]).returning();

        console.log("Inserting data into ordersProducts...");
        await db.insert(ordersProducts).values([
            { order_id: 1, product_id: 1 },
            { order_id: 1, product_id: 2 },
            { order_id: 2, product_id: 3 }
        ]);

        console.log("Inserting data into privateNotes...");
        await db.insert(privateNotes).values([
            { title: "Meeting Notes", content: "Discussed project timelines...", user_id: "user-1", is_locked: false },
            { title: "Secret Idea", content: "Build a new app for...", user_id: "user-2", is_locked: true }
        ]);

        console.log("Database seeded successfully!");
    } catch (e) {
        console.error("Error seeding database:", e);
    } finally {
        await pool.end();
    }
}

runSeed();
