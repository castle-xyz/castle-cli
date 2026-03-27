/**
 * Utilities for generating and decoding stable actor keys (persistentIds).
 *
 * Keys follow the pattern: {letter(s)}{digit}
 * Examples: a0, a1, ..., a9, b0, b1, ..., z9, aa0, aa1, ...
 *
 * The letter part uses bijective base-26 ordering:
 *   a=0, b=1, ..., z=25, aa=26, ab=27, ..., az=51, ba=52, ..., zz=701, aaa=702, ...
 *
 * Encoding: counter 0 → "a0", 9 → "a9", 10 → "b0", 259 → "z9", 260 → "aa0"
 */

// Convert a letter-index (0=a, 1=b, ..., 25=z, 26=aa, 27=ab, ...) to a letter string.
function letterIndexToStr(L: number): string {
  if (L < 26) return String.fromCharCode(97 + L);
  return letterIndexToStr(Math.floor(L / 26) - 1) + String.fromCharCode(97 + (L % 26));
}

/** Convert a counter (0, 1, 2, …) to an actor key ("a0", "a1", …, "b0", …). */
export function counterToActorKey(n: number): string {
  return letterIndexToStr(Math.floor(n / 10)) + String(n % 10);
}

/** Return the next actor key not already in existingKeys. */
export function nextActorKey(existingKeys: Set<string>): string {
  let counter = 0;
  while (true) {
    const key = counterToActorKey(counter);
    if (!existingKeys.has(key)) return key;
    counter++;
  }
}

/** Sort actor keys in canonical order: a0 < a1 < … < a9 < b0 < … < z9 < aa0 < … */
export function sortActorMap<T>(map: Record<string, T>): Record<string, T> {
  const sorted: Record<string, T> = {};
  const keys = Object.keys(map).sort((a, b) => {
    if (a.length !== b.length) return a.length - b.length;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  for (const key of keys) sorted[key] = map[key];
  return sorted;
}
