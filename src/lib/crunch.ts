/**
 * Length helpers for the Crunch mode of /api/clean-text.
 *
 * Models judge "half as long" poorly on their own, so the route counts the
 * source words and gives the model a number to aim for. The page uses the same
 * count to show how close the result came.
 */

/** Words separated by whitespace. Good enough for a length target, not a style check. */
export function count_words(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** About half the source, rounded up so a one-word input still asks for a word. */
export function crunch_target_words(source_words: number): number {
  return Math.max(1, Math.ceil(source_words / 2));
}
