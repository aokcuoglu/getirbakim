/** The ids with the one at `from` moved to `to`; the same array when nothing moves (out of range or from === to). */
export function moveImage<T>(ids: readonly T[], from: number, to: number): readonly T[] {
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return ids;
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
