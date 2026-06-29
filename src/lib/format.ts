export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

export function isOverdue(due: string | null, status: string): boolean {
  if (!due || status === "Completed") return false;
  return new Date(due).getTime() < new Date(new Date().toDateString()).getTime();
}

export function isToday(due: string | null): boolean {
  if (!due) return false;
  const d = new Date(due);
  const today = new Date();
  return d.toDateString() === today.toDateString();
}

export function daysSince(iso: string | null): number {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

/** Today as YYYY-MM-DD in local time. */
export function todayISO(): string {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

/** Next working day (skip Sat/Sun) as YYYY-MM-DD. */
export function nextWorkingDay(fromISO?: string): string {
  const base = fromISO ? new Date(fromISO) : new Date();
  base.setDate(base.getDate() + 1);
  while (base.getDay() === 0 || base.getDay() === 6) base.setDate(base.getDate() + 1);
  const tz = base.getTimezoneOffset() * 60000;
  return new Date(base.getTime() - tz).toISOString().slice(0, 10);
}
