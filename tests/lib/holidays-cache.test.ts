import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOLIDAY_MISS_TTL_MS, __resetHolidayCacheForTests, fetchIndianHolidays } from "@/lib/format";

// date.nager.at is a third-party API. It must be asked at most once per year: a good answer is cached,
// concurrent callers share one request, and an unusable answer (empty / 204 / error) is remembered.

const fetchMock = vi.fn();
const body = (data: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), { status });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  localStorage.clear();
  __resetHolidayCacheForTests();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SAMPLE = [{ date: "2027-01-26", name: "Republic Day", localName: "Republic Day" }];

describe("fetchIndianHolidays", () => {
  it("fetches once, then serves memory and localStorage", async () => {
    fetchMock.mockResolvedValue(body(SAMPLE));
    const a = await fetchIndianHolidays(2027);
    expect(a["2027-01-26"]).toMatchObject({ name: "Republic Day", isHoliday: true });
    await fetchIndianHolidays(2027);
    __resetHolidayCacheForTests(); // a fresh page load: localStorage still has it
    await fetchIndianHolidays(2027);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("concurrent callers share ONE request and all get the data", async () => {
    fetchMock.mockResolvedValue(body(SAMPLE));
    const [a, b, c] = await Promise.all([fetchIndianHolidays(2027), fetchIndianHolidays(2027), fetchIndianHolidays(2027)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Object.keys(b)).toEqual(["2027-01-26"]);
    expect(Object.keys(c)).toEqual(["2027-01-26"]);
    expect(a).toBe(b);
  });

  it.each([
    ["a 204 with no body", () => body(null, 204)],
    ["an empty 200 body", () => new Response("", { status: 200 })],
    ["an empty list", () => body([])],
    ["a server error", () => new Response("nope", { status: 503 })],
  ])("%s is remembered, not re-requested on every call", async (_n, make) => {
    fetchMock.mockImplementation(async () => make());
    expect(await fetchIndianHolidays(2030)).toEqual({});
    expect(await fetchIndianHolidays(2030)).toEqual({});
    __resetHolidayCacheForTests(); // page reload: the miss is in localStorage
    expect(await fetchIndianHolidays(2030)).toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a network error is remembered too, and does not throw", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(fetchIndianHolidays(2031)).resolves.toEqual({});
    await fetchIndianHolidays(2031);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks again after the miss expires, and caches a good answer then", async () => {
    fetchMock.mockResolvedValueOnce(body(null, 204));
    await fetchIndianHolidays(2032);
    vi.advanceTimersByTime(HOLIDAY_MISS_TTL_MS + 1000);
    fetchMock.mockResolvedValueOnce(body([{ date: "2032-01-26", name: "Republic Day" }]));
    const r = await fetchIndianHolidays(2032);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r["2032-01-26"]).toBeTruthy();
    await fetchIndianHolidays(2032);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("each year is independent", async () => {
    fetchMock.mockImplementation(async (url: string) => (String(url).includes("/2033/") ? body(null, 204) : body(SAMPLE)));
    await fetchIndianHolidays(2033);
    expect(Object.keys(await fetchIndianHolidays(2034))).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
