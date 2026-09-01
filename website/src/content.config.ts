import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const blog = defineCollection({
	// Load Markdown and MDX files in the `src/content/blog/` directory.
	loader: glob({ base: "./src/content/blog", pattern: "**/*.{md,mdx}" }),
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			description: z.string(),
			pubDate: z.coerce.date(),
			updatedDate: z.coerce.date().optional(),
			heroImage: image().optional(),
			authors: z.string().optional(),
			// Parked, as opposed to scheduled. A future `pubDate` publishes itself
			// once a build runs past that date; `draft` never publishes until a
			// human removes it. Keeping them separate stops a post parked with a
			// far-future date from surprising everyone when the date arrives.
			draft: z.boolean().optional(),
			slug: z.string().optional(),
			image: z.string().optional(),
		}),
});

const docs = defineCollection({
	loader: docsLoader(),
	schema: docsSchema()
});

export const collections = {
	blog,
	docs
};
