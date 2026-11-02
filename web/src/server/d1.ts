/**
 * D1 binds at most 100 parameters per statement ("too many SQL variables"
 * past that), far fewer than SQLite's default. A bulk insert or a long IN
 * list must be split to stay under it.
 */
export const D1_MAX_BOUND_PARAMETERS = 100;

/**
 * How many rows of `paramsPerRow` bound values fit in one statement, after
 * `reserved` values the rest of the statement binds itself.
 */
export function rowsPerStatement(paramsPerRow: number, reserved = 0): number {
  const rows = Math.floor((D1_MAX_BOUND_PARAMETERS - reserved) / paramsPerRow);
  if (rows < 1) throw new Error("A single row exceeds D1's parameter limit.");
  return rows;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
