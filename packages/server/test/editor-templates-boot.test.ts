/**
 * The panel's starter templates, put through the panel's own save path.
 *
 * These four are the first collection most people ever create, and they were
 * outside every gate: `check:templates` compiles the CLI scaffold,
 * `check:doc-examples` evaluates the docs' fences, and neither one knows these
 * files exist. All four were written against the pre-0.11 property shape behind
 * an `as unknown as AdminCollection` cast — products 2 errors, blog 6, users 1,
 * pages 4 — so *every* template produced a project that would not boot.
 *
 * `satisfies AdminCollection` on each file now catches a misplaced key at
 * compile time. This catches what a type cannot: what comes out the far side of
 * `nestAdminKeysDeep`, which is the object that actually reaches disk, judged by
 * the function the server runs at boot.
 *
 * The templates are imported across the package boundary on purpose. A copy of
 * them here would be a copy that drifts, and drift is the whole defect.
 */
import { nestAdminKeysDeep } from "../src/api/ast-schema-editor";
import { findCollectionConfigProblems } from "../src/collections/validate-config";

import { productsCollectionTemplate } from "../../cms/src/collection_editor/ui/collection_editor/templates/products_template";
import { blogCollectionTemplate } from "../../cms/src/collection_editor/ui/collection_editor/templates/blog_template";
import { usersCollectionTemplate } from "../../cms/src/collection_editor/ui/collection_editor/templates/users_template";
import { pagesCollectionTemplate } from "../../cms/src/collection_editor/ui/collection_editor/templates/pages_template";

const TEMPLATES: Record<string, unknown> = {
    products: productsCollectionTemplate,
    blog: blogCollectionTemplate,
    users: usersCollectionTemplate,
    pages: pagesCollectionTemplate
};

describe("every collection template the panel offers boots", () => {
    it.each(Object.keys(TEMPLATES))("%s", (name) => {
        const template = TEMPLATES[name] as Record<string, unknown>;
        // A template that failed to import would validate clean — `[]` problems
        // for an object with nothing in it. This is what makes the assertion
        // below mean something.
        expect(Object.keys(template.properties as Record<string, unknown>).length).toBeGreaterThan(3);

        const saved = nestAdminKeysDeep(template);
        // `unknownKeys: "error"` is the strictest setting a project can ask for,
        // and a template is exactly the file nobody wants to see a warning on.
        const problems = findCollectionConfigProblems([saved] as never, { unknownKeys: "error" });
        expect(problems).toEqual([]);
    });
});
