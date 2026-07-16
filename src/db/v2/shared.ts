// Shared helpers for v2 domain modules (batch limits + id normalize).

// D1 limits each statement to 100 bound variables. Some batched queries bind
// an extra leading param (e.g. last_injected_at) on top of the id placeholders,
// so N ids bind N+1 variables. Keep the batch size under 99 to stay safe; 90
// leaves headroom for any future extra params.
export const SQLITE_BIND_BATCH_SIZE = 90;

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()))];
}
