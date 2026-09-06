import { defineCollection } from "@rebasepro/cms-types";

const exercisesCollection = defineCollection({
    name: "Exercises",
    singularName: "Exercise",
    slug: "exercises",
    table: "exercises",
    history: true,
    properties: {
        id: {
            name: "ID",
            type: "string",
            isId: "uuid"
        },
        name: {
            name: "Exercise Name",
            type: "string",
            validation: {
                required: true
            },
            description: "Name of the exercise (e.g. Bench Press, Squat)"
        },
        description: {
            name: "Description",
            type: "string",
            admin: { markdown: true },
            description: "Detailed description and tips for performing the exercise"
        },
        images: {
            name: "Images",
            type: "array",
            of: {
                name: "Image",
                type: "string",
                storage: {
                    storagePath: "exercise_images/"
                }
            }
        },
        video_url: {
            name: "Video URL",
            type: "string",
            description: "Link to a demonstration video",
            url: true
        },
        difficulty: {
            name: "Difficulty",
            type: "string",
            validation: {
                required: true
            },
            defaultValue: "intermediate",
            enum: [
                {
                    id: "beginner",
                    label: "Beginner",
                    color: "green"
                },
                {
                    id: "intermediate",
                    label: "Intermediate",
                    color: "orange"
                },
                {
                    id: "advanced",
                    label: "Advanced",
                    color: "red"
                }
            ]
        },
        category: {
            name: "Category",
            type: "string",
            validation: {
                required: true
            },
            enum: [
                {
                    id: "strength",
                    label: "Strength",
                    color: "red"
                },
                {
                    id: "cardio",
                    label: "Cardio",
                    color: "blue"
                },
                {
                    id: "flexibility",
                    label: "Flexibility",
                    color: "green"
                },
                {
                    id: "balance",
                    label: "Balance",
                    color: "purple"
                },
                {
                    id: "plyometrics",
                    label: "Plyometrics",
                    color: "orange"
                },
                {
                    id: "calisthenics",
                    label: "Calisthenics",
                    color: "cyan"
                }
            ]
        },
        equipment: {
            name: "Equipment",
            type: "array",
            of: {
                name: "Equipment Item",
                type: "string",
                enum: [
                    {
                        id: "none",
                        label: "None (Bodyweight)"
                    },
                    {
                        id: "barbell",
                        label: "Barbell"
                    },
                    {
                        id: "dumbbell",
                        label: "Dumbbell"
                    },
                    {
                        id: "kettlebell",
                        label: "Kettlebell"
                    },
                    {
                        id: "resistance_band",
                        label: "Resistance Band"
                    },
                    {
                        id: "cable_machine",
                        label: "Cable Machine"
                    },
                    {
                        id: "pull_up_bar",
                        label: "Pull-Up Bar"
                    },
                    {
                        id: "bench",
                        label: "Bench"
                    },
                    {
                        id: "medicine_ball",
                        label: "Medicine Ball"
                    },
                    {
                        id: "foam_roller",
                        label: "Foam Roller"
                    },
                    {
                        id: "trx",
                        label: "TRX / Suspension Trainer"
                    },
                    {
                        id: "box",
                        label: "Plyo Box"
                    }
                ]
            },
            description: "Equipment needed for this exercise"
        },
        body_parts: {
            name: "Affected Body Parts",
            type: "array",
            of: {
                name: "Body Part",
                type: "string",
                enum: [
                    {
                        id: "head_neck",
                        label: "Head & Neck"
                    },
                    {
                        id: "shoulders",
                        label: "Shoulders"
                    },
                    {
                        id: "chest",
                        label: "Chest"
                    },
                    {
                        id: "upper_back",
                        label: "Upper Back"
                    },
                    {
                        id: "lower_back",
                        label: "Lower Back"
                    },
                    {
                        id: "biceps",
                        label: "Biceps"
                    },
                    {
                        id: "triceps",
                        label: "Triceps"
                    },
                    {
                        id: "forearms",
                        label: "Forearms"
                    },
                    {
                        id: "abs",
                        label: "Abs"
                    },
                    {
                        id: "obliques",
                        label: "Obliques"
                    },
                    {
                        id: "glutes",
                        label: "Glutes"
                    },
                    {
                        id: "quads",
                        label: "Quads"
                    },
                    {
                        id: "hamstrings",
                        label: "Hamstrings"
                    },
                    {
                        id: "calves",
                        label: "Calves"
                    },
                    {
                        id: "hip_flexors",
                        label: "Hip Flexors"
                    }
                ]
            },
            admin: {
                Field: () => import("../../frontend/src/BodyPartsField"),
                Preview: () => import("../../frontend/src/BodyPartsPreview")
            },
            description: "Muscle groups targeted by this exercise"
        },
        instructions: {
            name: "Instructions",
            type: "string",
            admin: { markdown: true },
            description: "Step-by-step instructions on how to perform the exercise"
        },
        default_reps: {
            name: "Default Reps",
            type: "number",
            description: "Recommended number of repetitions per set"
        },
        default_sets: {
            name: "Default Sets",
            type: "number",
            description: "Recommended number of sets"
        },
        rest_seconds: {
            name: "Rest (seconds)",
            type: "number",
            description: "Recommended rest time between sets in seconds"
        },
        calories_per_minute: {
            name: "Calories / min",
            type: "number",
            description: "Estimated calories burned per minute"
        },
        is_compound: {
            name: "Compound Exercise",
            type: "boolean",
            description: "Whether this exercise targets multiple muscle groups simultaneously"
        },
        is_featured: {
            name: "Featured",
            type: "boolean",
            description: "Show this exercise in featured / recommended sections"
        },
        status: {
            name: "Status",
            type: "string",
            validation: {
                required: true
            },
            defaultValue: "draft",
            enum: [
                {
                    id: "draft",
                    label: "Draft",
                    color: "gray"
                },
                {
                    id: "published",
                    label: "Published",
                    color: "green"
                },
                {
                    id: "archived",
                    label: "Archived",
                    color: "red"
                }
            ]
        },
        created_at: {
            name: "Created at",
            type: "date",
            autoValue: "on_create",
            admin: {
                readOnly: true,
                hideFromCollection: true
            }
        },
        updated_at: {
            name: "Updated at",
            type: "date",
            autoValue: "on_update",
            admin: {
                readOnly: true,
                hideFromCollection: true
            }
        }
    },
    admin: {
        icon: "Dumbbell",
        group: "Fitness",
        defaultViewMode: "table",
        enabledViews: ["table", "cards"],
        // `body_parts` is an array of enum values, so naming it as the tags path
        // (rather than computing the labels) is what keeps each chip its own
        // colour — the stated advantage of the path arm over a resolver.
        display: {
            title: "name",
            subtitle: ({ entity }) => {
                const equipment = Array.isArray(entity.values.equipment) ? entity.values.equipment : [];
                const reps = entity.values.default_sets && entity.values.default_reps
                    ? `${entity.values.default_sets}×${entity.values.default_reps}`
                    : undefined;
                return [equipment.length ? equipment.join(", ") : "Bodyweight", reps]
                    .filter(Boolean).join(" · ");
            },
            image: "images",
            status: "difficulty",
            tags: "body_parts"
        },
        // The widest collection in the demo, and the one that most needed this:
        // nineteen properties in one run is a list, not a form.
        form: {
            sidebar: ["status", "difficulty", "category", "is_featured"],
            sections: [
                { key: "exercise", properties: ["name", "images", "video_url", "description"] },
                {
                    key: "classification",
                    title: "Classification",
                    properties: ["equipment", "body_parts", "is_compound"]
                },
                {
                    key: "prescription",
                    title: "Defaults",
                    properties: ["default_reps", "default_sets", "rest_seconds", "calories_per_minute"]
                },
                {
                    key: "howto",
                    title: "Instructions",
                    properties: ["instructions"]
                }
            ]
        },
        propertiesOrder: [
            "name",
            "body_parts",
            "images",
            "status",
            "difficulty",
            "category",
            "equipment",
            "is_compound",
            "default_reps",
            "default_sets",
            "rest_seconds",
            "calories_per_minute",
            "video_url",
            "description",
            "instructions",
            "is_featured",
            "created_at",
            "updated_at"
        ],
        filterPresets: [
            {
                label: "Beginner bodyweight",
                filterValues: {
                    difficulty: ["==", "beginner"],
                    category: ["==", "calisthenics"]
                }
            },
            {
                label: "Published strength",
                filterValues: {
                    category: ["==", "strength"],
                    status: ["==", "published"]
                }
            },
            {
                label: "Cardio exercises",
                filterValues: {
                    category: ["==", "cardio"]
                }
            }
        ]
    }
});

export default exercisesCollection;
