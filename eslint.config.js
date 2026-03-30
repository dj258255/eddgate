import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      "no-console": ["error", { allow: ["warn", "error", "log"] }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/ban-ts-comment": "warn",
      "no-useless-escape": "warn",
      "no-useless-assignment": "warn",
      "no-loss-of-precision": "warn",
      "no-control-regex": "warn",
    },
  },
  {
    // types/ 는 순수 타입 정의 -- 다른 src/ 모듈 import 금지
    files: ["src/types/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "../core/*",
            "../eval/*",
            "../cli/*",
            "../render/*",
            "../trace/*",
            "../config/*",
            "../i18n/*",
          ],
        },
      ],
    },
  },
  {
    // eval/ 는 cli/, render/ import 금지
    files: ["src/eval/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: ["../cli/*", "../render/*"],
        },
      ],
    },
  },
  {
    // render/ 는 cli/ import 금지
    files: ["src/render/**/*.ts", "src/render/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: ["../cli/*"],
        },
      ],
    },
  },
  {
    ignores: ["dist/", "node_modules/", "*.config.*"],
  },
];
