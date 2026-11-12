import { defineTable, col } from "@rebasepro/server/schema";

export const exercises = defineTable("exercises", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        name: col.text().notNull().describe("Name of the exercise (e.g. Bench Press, Squat)"),
        description: col.text().describe("Detailed description and tips for performing the exercise"),
        images: col.storage({ path: "exercise_images/" }).multiple(),
        video_url: col.text().validate({ url: true }).describe("Link to a demonstration video"),
        difficulty: col.enum(["beginner", "intermediate", "advanced"]).notNull().default("intermediate"),
        category: col.enum(["strength", "cardio", "flexibility", "balance", "plyometrics", "calisthenics"]).notNull(),
        equipment: col.text({ enum: ["none", "barbell", "dumbbell", "kettlebell", "resistance_band", "cable_machine", "pull_up_bar", "bench", "medicine_ball", "foam_roller", "trx", "box"] }).array().describe("Equipment needed for this exercise"),
        body_parts: col.text({ enum: ["head_neck", "shoulders", "chest", "upper_back", "lower_back", "biceps", "triceps", "forearms", "abs", "obliques", "glutes", "quads", "hamstrings", "calves", "hip_flexors"] }).array().describe("Muscle groups targeted by this exercise"),
        instructions: col.text().describe("Step-by-step instructions on how to perform the exercise"),
        default_reps: col.numeric().describe("Recommended number of repetitions per set"),
        default_sets: col.numeric().describe("Recommended number of sets"),
        rest_seconds: col.numeric().describe("Recommended rest time between sets in seconds"),
        calories_per_minute: col.numeric().describe("Estimated calories burned per minute"),
        is_compound: col.boolean().describe("Whether this exercise targets multiple muscle groups simultaneously"),
        is_featured: col.boolean().describe("Show this exercise in featured / recommended sections"),
        status: col.enum(["draft", "published", "archived"]).notNull().default("draft"),
        created_at: col.timestamp({ withTimezone: true }).onCreateNow(),
        updated_at: col.timestamp({ withTimezone: true }).onUpdateNow(),
        __order: col.text().describe("Fractional index maintained by the Kanban board")
    },
    rls: "inherit",
    history: true
});
