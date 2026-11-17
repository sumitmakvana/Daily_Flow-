/**
 * The CronTicker caches work_settings (workdays + digest times) and today's holiday status for the whole IST day.
 * Every in-app write to work_settings or holiday_calendar calls markTickerSettingsStale(), so the next tick (within
 * 60 s) reads them again. Kept in its own tiny module so the settings code does not import the ticker itself.
 * State is on globalThis, like the ticker's, so it survives dev-server module reloads.
 */
const state = globalThis as unknown as { __tickerSettingsStale?: boolean };

export function markTickerSettingsStale(): void {
  state.__tickerSettingsStale = true;
}

/** Returns whether the cache was marked stale, and clears the mark (a write that lands meanwhile marks it again). */
export function takeTickerSettingsStale(): boolean {
  const stale = state.__tickerSettingsStale === true;
  state.__tickerSettingsStale = false;
  return stale;
}
