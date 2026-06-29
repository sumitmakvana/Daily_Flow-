import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    css: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "json-summary", "html"],
      reportsDirectory: "./coverage",
      include: [
        "src/services/**/*.ts",
        "src/lib/**/*.ts",
        "src/hooks/**/*.ts",
        "src/hooks/**/*.tsx",
        "src/components/StatusBadge.tsx",
        "src/components/PriorityBadge.tsx",
        "src/components/RiskBadge.tsx",
        "src/components/StreakChip.tsx",
        "src/components/PredictiveBadge.tsx",
        "src/components/CarryForwardBadge.tsx",
        "src/components/BlockerAge.tsx",
        "src/components/CapacityBar.tsx",
      ],
      exclude: [
        "src/lib/types.ts",
        "src/lib/error-capture.ts",
        "src/lib/error-page.ts",
      ],
      thresholds: {
        lines: 95,
        functions: 95,
        statements: 95,
        branches: 85,
      },
    },
  },
});
