import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  distDir: process.env.CRM_NEXT_DIST_DIR || ".next",
  ...(process.env.CRM_STANDALONE_OUTPUT === "1" ? { output: "standalone" as const } : {}),
  serverExternalPackages: ["@sparticuz/chromium"],
  outputFileTracingExcludes: {
    "/*": [".data/**/*", ".next-qa/**/*"],
  },
  // Playwright's runtime reads browsers.json dynamically, outside traced imports.
  outputFileTracingIncludes: {
    "/*": ["./node_modules/playwright-core/**/*", "./node_modules/@sparticuz/chromium/**/*"],
  },
};

export default nextConfig;
