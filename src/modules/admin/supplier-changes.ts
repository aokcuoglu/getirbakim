export type SupplierFieldChange = { path: string[]; before: unknown; after: unknown };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function equal(before: unknown, after: unknown): boolean {
  if (Object.is(before, after)) return true;
  if (Array.isArray(before) && Array.isArray(after)) {
    return before.length === after.length && before.every((value, index) => equal(value, after[index]));
  }
  if (record(before) && record(after)) {
    const keys = Object.keys(before);
    return keys.length === Object.keys(after).length && keys.every(key => Object.hasOwn(after, key) && equal(before[key], after[key]));
  }
  return false;
}

/** Compare JSON snapshots by field. Arrays remain one value; object key order never creates a change. */
export function supplierFieldChanges(before: Record<string, unknown> | null, after: Record<string, unknown>): SupplierFieldChange[] {
  const changes: SupplierFieldChange[] = [];
  function visit(previous: unknown, next: unknown, path: string[]) {
    if (equal(previous, next)) return;
    if ((record(previous) && (record(next) || next === undefined)) || (previous === undefined && record(next))) {
      const left = record(previous) ? previous : {};
      const right = record(next) ? next : {};
      const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
      if (keys.length) {
        for (const key of keys) visit(left[key], right[key], [...path, key]);
        return;
      }
    }
    changes.push({ path, before: previous, after: next });
  }
  visit(before ?? {}, after, []);
  return changes;
}
