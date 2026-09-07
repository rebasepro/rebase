import pluginJs from "@eslint/js";
import pluginReact from "eslint-plugin-react";
import tseslint from "typescript-eslint";
import pluginReactHooks from "eslint-plugin-react-hooks";

/** @type {import("eslint").Linter.Config[]} */
export default [
    {
        ignores: [
            "**/node_modules/**",
            "**/node_modules_backup/**",
            // Sibling git worktrees are separate checkouts of this same repo.
            // Linting them double-reports every finding and makes them look
            // like competing TSConfig roots to typescript-eslint.
            ".claude/worktrees/**",
            // The projects the CLI e2e suites scaffold and npm-install at the
            // repo root. They are in .gitignore, but eslint reads its own
            // ignores and not that file, so once a suite has run locally these
            // hold thousands of errors in installed and bundled code — 17,616
            // of them, which reads as a catastrophic regression and is instead
            // a test artefact. CI never saw it because a fresh runner has no
            // such directory, so the gate disagreed with every local run of it.
            "test-cli-init-project/**",
            "test-cli-init-baas-project/**",
            "**/dist/**",
            "**/build/**",
            "**/.next/**",
            "**/.astro/**",
            "**/.turbo/**",
            "**/.yarn/**",
            "**/.idea/**",
            "**/.vscode/**",
            "**/.agent/**",
            "**/.antigravity/**",
            "**/scratch/**",
            "**/.artifacts/**",
            "**/playwright-report/**",
            "**/test-results/**",
            // The three workspace projects outside the library, each ignored for
            // a different reason and each measured rather than assumed. They are
            // not unchecked: `pnpm typecheck` reads none of them either, but
            // `check:examples` compiles `examples/*` against BUILT output — the
            // way a real user consumes them — and the website has its own
            // `astro check`. What is missing here is style rules, not types.
            //
            // `tooling/videos/` is Remotion, a React codebase whose components
            // are frames rather than UI. 2 errors today, both
            // `react/no-unescaped-entities` in a title card, where an apostrophe
            // rendered as `&apos;` would be a defect rather than a fix.
            "**/videos/**",
            // The Astro site. 88 errors, almost all `no-unescaped-entities` in
            // marketing prose — the same rule, and the same reason it is wrong
            // here: these are `.tsx` islands whose text is copy. Astro files
            // need a parser this config does not load, so linting the site means
            // linting a third of it and calling that coverage.
            "**/website/**",
            // The standalone example apps. They each carry their own tsconfig,
            // so typescript-eslint refuses them outright — "multiple candidate
            // TSConfigRootDirs are present", a parse error per file rather than
            // a finding. Fixing that means pinning `tsconfigRootDir` for a
            // nested project, which changes how every rule resolves types in
            // the rest of the repository.
            "**/examples/**",
            "**/saas/**",
            // Ad-hoc checkouts of the saas repo alongside it — `saas-sweep`,
            // `saas-<branch>` — which agents make to avoid sharing one HEAD.
            // They are excluded from git locally, but eslint reads its own
            // ignores, so their generated SDK types surface as errors that CI,
            // on a fresh runner, will never see. Same shape as the
            // test-cli-init-* entries above.
            "**/saas-*/**",
            // …and the ones that pattern cannot catch by name. A worktree is
            // named after the work, not the repository, so `cloud-fleet-safety`
            // is a checkout of the saas repo that looks like nothing of the
            // sort. Same shape and same consequence as every entry above.
            "cloud-fleet-safety/**",
            // DesignSync's working directories: the bundle it vendors and the
            // previews it renders. Untracked output of a tool rather than
            // source, and `_vendor` alone carries 1,339 errors in third-party
            // JS — enough to read as a catastrophic regression on any machine
            // that has run it, while CI, which never has, stays green.
            "ds-bundle/**",
            ".ds-sync/**",
            "tooling/design-sync/**",
            ".pnp.loader.mjs",
            "update_translations.js",
            "inspect_product.mjs",
            "screenshot.mjs"
        ]
    },
    pluginJs.configs.recommended,
    ...tseslint.configs.recommended,
    pluginReact.configs.flat.recommended,
    {

        // `mts`/`cts` included: `pluginReact.configs.flat.recommended` above is
        // unscoped, so it matches every file, while `settings.react.version`
        // below lives here. A file outside this glob got the plugin without its
        // settings, and eslint-plugin-react warned about the missing version on
        // every run — `tooling/scripts/verify-selfhost.mts` was the one such file.
        files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],

        plugins: {
            "react-hooks": pluginReactHooks
        },

        languageOptions: {
            parserOptions: {
                // Pin the root explicitly: a checked-out worktree (or any
                // nested copy of the repo) otherwise presents several
                // candidate roots and the parser refuses to guess, failing
                // every file with a parsing error.
                tsconfigRootDir: import.meta.dirname,
                ecmaFeatures: {
                    jsx: true
                }
            },
            globals: {
                // ...globals.browser,
            },

            ecmaVersion: "latest",
            sourceType: "module"
        },

        settings: {
            react: {
                version: "19.2.7"
            }
        },

        rules: {
            "no-undef": "off",
            "no-useless-escape": "off",
            "react/jsx-tag-spacing": "off",
            "space-before-function-paren": 0,
            "react/prop-types": 0,
            "react/jsx-handler-names": 0,
            "react/jsx-fragments": 0,
            "react/no-unused-prop-types": 0,
            "react/react-in-jsx-scope": "off",
            "import/export": 0,
            "no-use-before-define": "off",
            "no-empty-pattern": "off",
            "no-unused-vars": ["warn", {
                "argsIgnorePattern": "^_",
                "varsIgnorePattern": "^_",
                "caughtErrorsIgnorePattern": "^_"
            }],
            "no-shadow": "warn",
            "padded-blocks": "off",
            "brace-style": "off",
            curly: "off",
            semi: 0,
            "key-spacing": "warn",
            "no-trailing-spaces": "warn",
            "comma-dangle": "warn",
            "no-multi-spaces": "warn",
            "comma-spacing": "warn",
            "keyword-spacing": "warn",
            "no-multiple-empty-lines": "warn",
            "object-curly-spacing": ["warn", "always"],
            "multiline-ternary": "off",
            "space-before-blocks": "warn",
            "object-property-newline": "warn",
            "eol-last": "warn",
            "spaced-comment": "off",
            indent: [0, 4],

            quotes: [1, "double", {
                avoidEscape: true
            }],

            // `rules-of-hooks` is an error and source is clean of it: a hook
            // called conditionally or in a callback is wrong with no judgement
            // call to make, so there is nothing to weigh.
            //
            // `exhaustive-deps` stays a warning because it is the opposite —
            // adding the missing dependency is as often the bug as the fix
            // (`VirtualTableInput` re-runs on every keystroke and breaks its own
            // debounce if you "fix" it), so an error would be a rule that has to
            // be disabled to ship, and a rule everyone disables teaches nothing.
            //
            // What makes it useful anyway is `pnpm check:hooks`, which pins the
            // current 183 in `tooling/scripts/hooks-baseline.json` and fails on the
            // 184th. The count was never the problem; a list too long to read
            // hiding a genuinely new stale closure was.
            "react-hooks/rules-of-hooks": "error",
            "react-hooks/exhaustive-deps": "warn",
            "@typescript-eslint/no-unused-vars": ["warn", {
                "argsIgnorePattern": "^_",
                "varsIgnorePattern": "^_",
                "caughtErrorsIgnorePattern": "^_"
            }],
            "@typescript-eslint/no-empty-function": "warn",
            "@typescript-eslint/no-inferrable-types": "warn",
            "@typescript-eslint/ban-ts-comment": "warn",
            "@typescript-eslint/no-explicit-any": "off"
        }
    },
    {
        // typescript-eslint owns unused-variable reporting on TypeScript. Both
        // rules were on, over the same files, with the same options, and the
        // base rule cannot see a type position: it counted the parameter names
        // in a function *type* (`((value: string) => string)`) and in an
        // ambient `declare function gtag(...args: unknown[])` as unused
        // bindings. Every one of the 843 findings the TypeScript rule reported
        // was duplicated here, and the base rule added 1896 more that were all
        // false — 2739 warnings, none of them signal, burying the 179
        // exhaustive-deps warnings that are.
        files: ["**/*.{ts,tsx,mts,cts}"],
        rules: {
            "no-unused-vars": "off"
        }
    },
    {
        files: [
            "packages/utils/src/**/*.{ts,tsx}",
            "packages/common/src/**/*.{ts,tsx}",
            "packages/server/src/**/*.{ts,tsx}"
        ],
        rules: {
            "@typescript-eslint/no-explicit-any": "error"
        }
    },
    {
        files: ["**/__tests__/**/*.ts", "**/__tests__/**/*.tsx", "**/*.test.ts", "**/*.test.tsx", "**/*-test.ts", "**/*-test2.ts"],
        rules: {
            "prefer-const": "off",
            "no-unused-vars": "off",
            "@typescript-eslint/no-unused-vars": "off",
            "@typescript-eslint/no-unsafe-function-type": "off",
            "@typescript-eslint/no-require-imports": "off",
            "no-unassigned-vars": "off"
        }
    },
    {
        files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],
        rules: {
            "no-useless-assignment": "off",
            "preserve-caught-error": "off",
            "no-var": "off",
            "@typescript-eslint/no-unsafe-function-type": "off"
        }
    },
    {
        files: ["**/*.cjs", "**/*.js"],
        rules: {
            "@typescript-eslint/no-require-imports": "off"
        }
    },
    {
        // A package's public API surface is only as trustworthy as its
        // barrel file. `export *` into a folder literally named "internal"
        // silently republishes every future addition to that folder as
        // public API — nobody reviewing the barrel diff would notice. Named
        // re-exports (`export { x } from "./internal/y"`) are fine: they
        // make the internal-to-public boundary an explicit, reviewable list
        // (see packages/app/src/index.ts for the pattern — pair with an
        // `@internal` JSDoc tag on each re-exported symbol).
        files: ["packages/*/src/index.{ts,tsx}"],
        rules: {
            "no-restricted-syntax": ["error", {
                selector: "ExportAllDeclaration[source.value=/internal/]",
                message: "Do not `export *` from a folder/file named 'internal' in a package barrel — it silently republishes every future export as public API. Re-export the specific symbols by name instead, each with an @internal JSDoc tag."
            }]
        }
    }
];
