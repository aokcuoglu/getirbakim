import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: ["src/app/search/search-content.tsx", "src/app/products/[id]/product-detail-content.tsx", "src/app/admin/requests/requests-content.tsx", "src/app/admin/suppliers/health/health-content.tsx", "src/app/request/request-content.tsx"],
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;