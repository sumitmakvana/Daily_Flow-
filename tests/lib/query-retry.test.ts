import { describe, expect, it } from "vitest";
import { shouldRetryQuery } from "@/lib/query-retry";

describe("shouldRetryQuery", () => {
  it.each([
    [{ status: 401 }],
    [{ status: 403 }],
    [{ status: 404 }],
    [{ statusCode: 400 }],
    [{ response: { status: 422 } }],
    [new Error("Unauthorized")],
    [new Error('permission denied for table tasks')],
    [new Error('column "work_item_id" does not exist')],
    [new Error("JWT expired")],
  ])("never retries a permanent error (%j)", (err) => {
    expect(shouldRetryQuery(0, err)).toBe(false);
  });

  it.each([[{ status: 500 }], [{ status: 502 }], [{ status: 408 }], [{ status: 429 }], [new TypeError("Failed to fetch")], ["x"], [null]])(
    "retries a transient failure (%j), at most twice",
    (err) => {
      expect(shouldRetryQuery(0, err)).toBe(true);
      expect(shouldRetryQuery(1, err)).toBe(true);
      expect(shouldRetryQuery(2, err)).toBe(false);
    },
  );
});
