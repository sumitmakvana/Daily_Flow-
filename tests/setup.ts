import "@testing-library/jest-dom/vitest";
import { vi, beforeEach } from "vitest";

// Provide env vars consumed via import.meta.env
Object.assign(import.meta.env, {
  VITE_SUPABASE_URL: "https://example.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
  VITE_SUPABASE_PROJECT_ID: "test",
});

// jsdom URL helpers used by csv.downloadCSV
if (!URL.createObjectURL) {
  Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:mock") });
}
if (!URL.revokeObjectURL) {
  Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn() });
}

// Reset fetch + supabase mock between tests
beforeEach(() => {
  globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as never;
});
