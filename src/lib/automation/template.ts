/**
 * {{ctx.path}} template resolver — same field-resolution semantics as
 * src/lib/guard.ts. Used by automation actions to substitute runtime
 * values into action params.
 *
 * Unknown placeholders throw — caught by the worker and recorded as a
 * failed run; the rule rolls back.
 */

export type TemplateContext = Record<string, unknown> & {
  custom_fields?: Record<string, unknown> | null;
};

const PLACEHOLDER = /\{\{\s*ctx\.([a-zA-Z0-9_.]+)\s*\}\}/g;

function lookup(ctx: TemplateContext, path: string): unknown {
  const parts = path.split(".");
  const head = parts[0];
  const rest = parts.slice(1);
  let cur: unknown;
  const cf = ctx.custom_fields ?? {};
  if (head in (cf as Record<string, unknown>)) {
    cur = (cf as Record<string, unknown>)[head];
  } else if (head in ctx) {
    cur = (ctx as Record<string, unknown>)[head];
  } else {
    throw new Error(`Unknown ctx field: ${path}`);
  }
  for (const k of rest) {
    if (cur == null || typeof cur !== "object") {
      throw new Error(`Cannot read "${k}" of null/non-object in ${path}`);
    }
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function renderScalar(value: unknown, ctx: TemplateContext): unknown {
  if (typeof value !== "string") return value;
  const onlyPlaceholder = value.match(/^\{\{\s*ctx\.([a-zA-Z0-9_.]+)\s*\}\}$/);
  if (onlyPlaceholder) return lookup(ctx, onlyPlaceholder[1]);
  return value.replace(PLACEHOLDER, (_m, p: string) => {
    const v = lookup(ctx, p);
    return v == null ? "" : String(v);
  });
}

export function renderTemplate<T = unknown>(input: T, ctx: TemplateContext): T {
  if (input == null) return input;
  if (Array.isArray(input)) {
    return input.map((x) => renderTemplate(x, ctx)) as unknown as T;
  }
  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = renderTemplate(v, ctx);
    }
    return out as T;
  }
  return renderScalar(input, ctx) as T;
}

/**
 * Parse a relative date offset like "+30d", "+2w", "+12h".
 * Returns an ISO date string (YYYY-MM-DD) for d/w units, or full ISO for h.
 */
export function parseOffset(spec: string, from: Date = new Date()): string {
  const m = spec.match(/^([+-]?\d+)([dwh])$/);
  if (!m) return spec; // assume already formatted
  const n = parseInt(m[1], 10);
  const unit = m[2];
  const d = new Date(from);
  if (unit === "d") d.setUTCDate(d.getUTCDate() + n);
  else if (unit === "w") d.setUTCDate(d.getUTCDate() + n * 7);
  else if (unit === "h") d.setUTCHours(d.getUTCHours() + n);
  return unit === "h" ? d.toISOString() : d.toISOString().slice(0, 10);
}
