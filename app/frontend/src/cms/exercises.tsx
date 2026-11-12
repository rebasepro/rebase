import { customizeTable } from "@rebasepro/cms";
import type { exercises } from "../../../backend/schema/exercises";
import BodyPartsField from "../BodyPartsField";
import BodyPartsPreview from "../BodyPartsPreview";
import { updateRecord } from "./lib/actions";

export const exercisesCms = customizeTable<typeof exercises>("exercises", {
    icon: "Dumbbell",
    group: "Fitness",
    entityActions: [
        {
            key: "publish",
            name: "Publish",
            icon: "Send",
            collapsed: false,
            isEnabled: ({ row }) => row?.status !== "published",
            disabledReason: () => "Already published",
            onClick: ({ row, id, path, context, collection }) => row &&
                updateRecord(context, collection?.slug ?? path, id, { status: "published" }, "Exercise published")
        },
        {
            key: "feature",
            name: "Feature this exercise",
            icon: "Star",
            isEnabled: ({ row }) => !row?.is_featured && row?.status === "published",
            disabledReason: ({ row }) => row?.is_featured
                ? "Already featured"
                : "Only published exercises can be featured",
            onClick: ({ row, id, path, context, collection }) => row &&
                updateRecord(context, collection?.slug ?? path, id, { is_featured: true }, "Exercise featured")
        },
        {
            key: "archive",
            name: "Archive",
            icon: "Archive",
            isEnabled: ({ row }) => row?.status !== "archived",
            disabledReason: () => "Already archived",
            onClick: ({ row, id, path, context, collection }) => row &&
                updateRecord(context, collection?.slug ?? path, id, { status: "archived", is_featured: false }, "Exercise archived")
        }
    ],
    defaultViewMode: "table",
    kanban: {
        columnField: "difficulty",
        orderField: "__order"
    },
    display: {
        title: "name",
        subtitle: ({ row }) => {
            const equipment = Array.isArray(row.equipment) ? row.equipment : [];
            const reps = row.default_sets && row.default_reps
                ? `${row.default_sets}×${row.default_reps}`
                : undefined;
            return [equipment.length ? equipment.join(", ") : "Bodyweight", reps]
                .filter(Boolean).join(" · ");
        },
        image: "images",
        status: "difficulty",
        tags: "body_parts"
    },
    form: {
        sidebar: ["status", "difficulty", "category", "is_featured"],
        sections: [
            {
                key: "exercise",
                fields: ["name", "images", "video_url", "description"]
            },
            {
                key: "classification",
                title: "Classification",
                fields: ["equipment", "body_parts", "is_compound"]
            },
            {
                key: "prescription",
                title: "Defaults",
                fields: ["default_reps", "default_sets", "rest_seconds", "calories_per_minute"]
            },
            {
                key: "howto",
                title: "Instructions",
                fields: ["instructions"]
            }
        ]
    },
    fieldOrder: [
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
        "updated_at",
        "__order"
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
    ],
    fields: {
        name: {
            name: "Exercise Name"
        },
        description: {
            markdown: true
        },
        images: {
            of: {
                name: "Image"
            }
        },
        difficulty: {
            enumLabels: {
                beginner: {
                    label: "Beginner",
                    color: "green"
                },
                intermediate: {
                    label: "Intermediate",
                    color: "orange"
                },
                advanced: {
                    label: "Advanced",
                    color: "red"
                }
            }
        },
        category: {
            enumLabels: {
                strength: {
                    label: "Strength",
                    color: "red"
                },
                cardio: {
                    label: "Cardio",
                    color: "blue"
                },
                flexibility: {
                    label: "Flexibility",
                    color: "green"
                },
                balance: {
                    label: "Balance",
                    color: "purple"
                },
                plyometrics: {
                    label: "Plyometrics",
                    color: "orange"
                },
                calisthenics: {
                    label: "Calisthenics",
                    color: "cyan"
                }
            }
        },
        equipment: {
            of: {
                name: "Equipment Item",
                enumLabels: {
                    none: "None (Bodyweight)",
                    pull_up_bar: "Pull-Up Bar",
                    trx: "TRX / Suspension Trainer",
                    box: "Plyo Box"
                }
            }
        },
        body_parts: {
            name: "Affected Body Parts",
            Field: BodyPartsField,
            Preview: BodyPartsPreview,
            of: {
                name: "Body Part",
                enumLabels: {
                    head_neck: "Head & Neck"
                }
            }
        },
        instructions: {
            markdown: true
        },
        rest_seconds: {
            name: "Rest (seconds)"
        },
        calories_per_minute: {
            name: "Calories / min"
        },
        is_compound: {
            name: "Compound Exercise"
        },
        is_featured: {
            name: "Featured"
        },
        status: {
            enumLabels: {
                draft: {
                    label: "Draft",
                    color: "gray"
                },
                published: {
                    label: "Published",
                    color: "green"
                },
                archived: {
                    label: "Archived",
                    color: "red"
                }
            }
        },
        created_at: {
            name: "Created at",
            readOnly: true,
            hidden: true
        },
        updated_at: {
            name: "Updated at",
            readOnly: true,
            hidden: true
        },
        __order: {
            disabled: true,
            hidden: true
        }
    }
});
