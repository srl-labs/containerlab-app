/**
 * Shared module counter producing stable row identities for list components
 * (DynamicList, KeyValueList) whose items arrive as plain values via props.
 */
let rowIdCounter = 0;

/** Next unique row id. */
export function nextRowId(): number {
  rowIdCounter += 1;
  return rowIdCounter;
}

/** Fresh id list for `count` rows. */
export function createRowIds(count: number): number[] {
  return Array.from({ length: count }, () => nextRowId());
}
