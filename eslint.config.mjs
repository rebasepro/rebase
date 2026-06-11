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
            "**/e2e-screenshots/**",
            "**/playwright-report/**",
            "**/test-results/**",
            "**/videos/**",
            "**/website/**",
            "**/examples/**",
            "**/saas/**",
            "scripts/**",
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

        files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],

        plugins: {
            "react-hooks": pluginReactHooks
        },

        languageOptions: {
            parserOptions: {
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
                version: "detect"
            }
        },

        rules: {
            "no-undef": "off",
            "no-useless-escape": "off",
            "react/jsx-tag-spacing": ["warn", {
                "beforeSelfClosing": "never"
            }],
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
        files: [
            "packages/utils/src/**/*.{ts,tsx}",
            "packages/common/src/**/*.{ts,tsx}",
            "packages/server-core/src/**/*.{ts,tsx}"
        ],
        rules: {
            "@typescript-eslint/no-explicit-any": "error"
        }
    },
    {
        files: ["**/__tests__/**/*.ts", "**/__tests__/**/*.tsx", "**/*.test.ts", "**/*.test.tsx"],
        rules: {
            "prefer-const": "off",
            "no-unused-vars": "off",
            "@typescript-eslint/no-unused-vars": "off",
            "@typescript-eslint/no-unsafe-function-type": "off",
            "@typescript-eslint/no-require-imports": "off"
        }
    },
    {
        files: ["**/*.cjs", "**/*.js"],
        rules: {
            "@typescript-eslint/no-require-imports": "off"
        }
    }
];
