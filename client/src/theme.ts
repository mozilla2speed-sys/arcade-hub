/** Visual style. Purely local: players with different styles share a race. */
export type Theme = 'day' | 'night';

export function isTheme(v: unknown): v is Theme {
  return v === 'day' || v === 'night';
}
