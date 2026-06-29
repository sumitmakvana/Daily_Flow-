/** Derive a snake_case key from a human label. */
export function toKey(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/['"]+/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^([0-9])/, "_$1")
    .slice(0, 60);
}

export const isValidKey = (k: string) => /^[a-z][a-z0-9_]*$/.test(k);
