/**
 * Transition guard evaluator. Guard shape:
 *   { all: [ { field, op, value } ] }   // AND
 *   { any: [ ... ] }                    // OR
 *   {}                                  // always pass
 *
 * `field` resolves against, in order:
 *   1. `ctx.custom_fields[field]`
 *   2. `ctx[field]` (built-in: priority, assigned_to, status, etc.)
 *
 * Ops: eq | neq | in | nin | gt | gte | lt | lte | is_set | is_empty
 */

export type GuardOp =
  | "eq" | "neq" | "in" | "nin"
  | "gt" | "gte" | "lt" | "lte"
  | "is_set" | "is_empty";

export type GuardClause = { field: string; op: GuardOp; value?: unknown };
export type GuardExpr = { all?: GuardClause[]; any?: GuardClause[] } | Record<string, never>;

export type GuardContext = {
  custom_fields?: Record<string, unknown> | null;
  [k: string]: unknown;
};

function resolve(ctx: GuardContext, field: string): unknown {
  const cf = ctx.custom_fields ?? {};
  if (field in cf) return (cf as Record<string, unknown>)[field];
  return ctx[field];
}

function evalClause(c: GuardClause, ctx: GuardContext): boolean {
  const left = resolve(ctx, c.field);
  switch (c.op) {
    case "eq":  return left === c.value;
    case "neq": return left !== c.value;
    case "in":  return Array.isArray(c.value) && (c.value as unknown[]).includes(left);
    case "nin": return Array.isArray(c.value) && !(c.value as unknown[]).includes(left);
    case "gt":  return typeof left === "number" && typeof c.value === "number" && left > c.value;
    case "gte": return typeof left === "number" && typeof c.value === "number" && left >= c.value;
    case "lt":  return typeof left === "number" && typeof c.value === "number" && left < c.value;
    case "lte": return typeof left === "number" && typeof c.value === "number" && left <= c.value;
    case "is_set":   return left !== undefined && left !== null && left !== "";
    case "is_empty": return left === undefined || left === null || left === "";
    default: return false;
  }
}

export function evalGuard(expr: GuardExpr | null | undefined, ctx: GuardContext): boolean {
  if (!expr || (!("all" in expr) && !("any" in expr))) return true;
  const e = expr as { all?: GuardClause[]; any?: GuardClause[] };
  if (e.all && e.all.length) {
    if (!e.all.every((c) => evalClause(c, ctx))) return false;
  }
  if (e.any && e.any.length) {
    if (!e.any.some((c) => evalClause(c, ctx))) return false;
  }
  return true;
}

export function describeGuard(expr: GuardExpr | null | undefined): string {
  if (!expr || (!("all" in expr) && !("any" in expr))) return "Always";
  const e = expr as { all?: GuardClause[]; any?: GuardClause[] };
  const parts: string[] = [];
  if (e.all?.length) parts.push(e.all.map(describeClause).join(" AND "));
  if (e.any?.length) parts.push(e.any.map(describeClause).join(" OR "));
  return parts.join(" AND ") || "Always";
}

function describeClause(c: GuardClause): string {
  const v = JSON.stringify(c.value);
  switch (c.op) {
    case "is_set": return `${c.field} is set`;
    case "is_empty": return `${c.field} is empty`;
    default: return `${c.field} ${c.op} ${v}`;
  }
}
