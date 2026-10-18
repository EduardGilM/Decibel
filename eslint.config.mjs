import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: ["node_modules/**", ".tools/**", ".next/**", "out/**", "build/**", "src-tauri/**", "next-env.d.ts"],
  },
  {
    rules: {
      // Covers come from the user's own server (or data: URIs); static export has no image optimizer.
      "@next/next/no-img-element": "off",
    },
  },
];

export default eslintConfig;
