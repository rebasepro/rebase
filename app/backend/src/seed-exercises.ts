import { createPostgresDatabaseConnection } from "@rebasepro/server-postgresql";
import { env } from "./env.js";
import { exercises } from "./schema.generated.js";
import { eq } from "drizzle-orm";

const postgresResources = createPostgresDatabaseConnection(env.DATABASE_URL, undefined, {
    max: 1
});
const db = postgresResources.db;

const EXERCISE_BODY_PARTS: Record<string, string[]> = {
    "Barbell Back Squat": ["quads", "glutes", "hamstrings", "calves"],
    "Barbell Bench Press": ["chest", "triceps", "shoulders"],
    "Barbell Hip Thrust": ["glutes", "hamstrings"],
    "Barbell Row": ["upper_back", "biceps", "forearms"],
    "Box Jump": ["quads", "calves", "glutes"],
    "Bulgarian Split Squat": ["quads", "glutes", "hamstrings"],
    "Burpee": ["chest", "shoulders", "triceps", "abs", "quads", "calves"],
    "Cable Face Pull": ["shoulders", "upper_back"],
    "Cable Woodchop": ["obliques", "abs"],
    "Conventional Deadlift": ["lower_back", "upper_back", "hamstrings", "glutes", "forearms"],
    "Dumbbell Bicep Curl": ["biceps", "forearms"],
    "Dumbbell Lateral Raise": ["shoulders"],
    "Farmer's Walk": ["forearms", "shoulders", "upper_back", "abs"],
    "Forearm Plank": ["abs", "obliques", "shoulders"],
    "Goblet Squat": ["quads", "glutes"],
    "Hanging Leg Raise": ["abs"],
    "Kettlebell Swing": ["glutes", "hamstrings", "lower_back", "shoulders"],
    "Medicine Ball Slam": ["abs", "shoulders", "chest"],
    "Mountain Climbers": ["abs", "chest", "shoulders"],
    "Overhead Press": ["shoulders", "triceps"],
    "Overhead Shoulder Press": ["shoulders", "triceps"],
    "Pigeon Pose Stretch": ["glutes", "hip_flexors"],
    "Pull-Up": ["upper_back", "biceps", "forearms"],
    "Push-Up": ["chest", "triceps", "shoulders", "abs"],
    "Resistance Band Pull-Apart": ["shoulders", "upper_back"],
    "Romanian Deadlift": ["hamstrings", "glutes", "lower_back"],
    "Russian Twist": ["obliques", "abs"],
    "Standing Calf Raise": ["calves"],
    "Tricep Dips": ["triceps", "chest", "shoulders"],
    "TRX Row": ["upper_back", "biceps"],
    "Walking Lunges": ["quads", "hamstrings", "glutes"]
};

const EXERCISE_EQUIPMENT: Record<string, string[]> = {
    "Barbell Back Squat": ["barbell"],
    "Barbell Bench Press": ["barbell", "bench"],
    "Barbell Hip Thrust": ["barbell", "bench"],
    "Barbell Row": ["barbell"],
    "Box Jump": ["box"],
    "Bulgarian Split Squat": ["dumbbell", "bench"],
    "Burpee": ["none"],
    "Cable Face Pull": ["cable_machine"],
    "Cable Woodchop": ["cable_machine"],
    "Conventional Deadlift": ["barbell"],
    "Dumbbell Bicep Curl": ["dumbbell"],
    "Dumbbell Lateral Raise": ["dumbbell"],
    "Farmer's Walk": ["dumbbell"],
    "Forearm Plank": ["none"],
    "Goblet Squat": ["dumbbell"],
    "Hanging Leg Raise": ["pull_up_bar"],
    "Kettlebell Swing": ["kettlebell"],
    "Medicine Ball Slam": ["medicine_ball"],
    "Mountain Climbers": ["none"],
    "Overhead Press": ["barbell"],
    "Overhead Shoulder Press": ["dumbbell"],
    "Pigeon Pose Stretch": ["none"],
    "Pull-Up": ["pull_up_bar"],
    "Push-Up": ["none"],
    "Resistance Band Pull-Apart": ["resistance_band"],
    "Romanian Deadlift": ["barbell"],
    "Russian Twist": ["none"],
    "Standing Calf Raise": ["none"],
    "Tricep Dips": ["none"],
    "TRX Row": ["trx"],
    "Walking Lunges": ["none"]
};

const EXERCISE_IMAGES: Record<string, string[]> = {
    "Barbell Back Squat": ["exercise_images/squat.png"],
    "Barbell Bench Press": ["exercise_images/bench_press.png"],
    "Barbell Hip Thrust": ["exercise_images/hip_thrust.png"],
    "Barbell Row": ["exercise_images/barbell_row.png"],
    "Box Jump": ["exercise_images/box_jump.png"],
    "Bulgarian Split Squat": ["exercise_images/squat.png"],
    "Burpee": ["exercise_images/burpee.png"],
    "Cable Face Pull": ["exercise_images/face_pull.png"],
    "Cable Woodchop": ["exercise_images/cable_woodchop.png"],
    "Conventional Deadlift": ["exercise_images/deadlift.png"],
    "Dumbbell Bicep Curl": ["exercise_images/bicep_curl.png"],
    "Dumbbell Lateral Raise": ["exercise_images/lateral_raise.png"],
    "Farmer's Walk": ["exercise_images/farmers_walk.png"],
    "Forearm Plank": ["exercise_images/plank.png"],
    "Goblet Squat": ["exercise_images/goblet_squat.png"],
    "Hanging Leg Raise": ["exercise_images/pullup.png"],
    "Kettlebell Swing": ["exercise_images/kettlebell_swing.png"],
    "Medicine Ball Slam": ["exercise_images/med_ball_slam.png"],
    "Mountain Climbers": ["exercise_images/mountain_climber.png"],
    "Overhead Press": ["exercise_images/shoulder_press.png"],
    "Overhead Shoulder Press": ["exercise_images/shoulder_press.png"],
    "Pigeon Pose Stretch": ["exercise_images/pigeon_pose.png"],
    "Pull-Up": ["exercise_images/pullup.png"],
    "Push-Up": ["exercise_images/push_up.png"],
    "Resistance Band Pull-Apart": ["exercise_images/band_pull_apart.png"],
    "Romanian Deadlift": ["exercise_images/romanian_deadlift.png"],
    "Russian Twist": ["exercise_images/russian_twist.png"],
    "Standing Calf Raise": ["exercise_images/calf_raise.png"],
    "Tricep Dips": ["exercise_images/tricep_dips.png"],
    "TRX Row": ["exercise_images/trx_row.png"],
    "Walking Lunges": ["exercise_images/lunges.png"]
};

async function seed() {
    try {
        console.log("Checking exercises in database...");
        const existing = await db.select().from(exercises);
        console.log(`Found ${existing.length} exercises.`);

        console.log("Updating body parts, equipment, and images for matching exercises...");
        let updatedCount = 0;
        for (const item of existing) {
            const bodyParts = EXERCISE_BODY_PARTS[item.name];
            const equipment = EXERCISE_EQUIPMENT[item.name];
            const images = EXERCISE_IMAGES[item.name];

            if (bodyParts || equipment || images) {
                const updateData: any = {};
                if (bodyParts) updateData.body_parts = bodyParts;
                if (equipment) updateData.equipment = equipment;
                if (images) updateData.images = images;

                await db.update(exercises)
                    .set(updateData)
                    .where(eq(exercises.id, item.id));
                console.log(`✓ Mapped exercise: "${item.name}" -> body_parts: ${JSON.stringify(bodyParts)}, equipment: ${JSON.stringify(equipment)}, images: ${JSON.stringify(images)}`);
                updatedCount++;
            } else {
                console.log(`⚠ No mapping found for exercise: "${item.name}"`);
            }
        }
        console.log(`Seeding complete. Mapped ${updatedCount} exercises.`);
    } catch (error) {
        console.error("Seeding failed:", error);
    } finally {
        await postgresResources.pool.end();
    }
}

seed();
