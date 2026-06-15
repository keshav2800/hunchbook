/** Read a theme token at runtime so charts follow theme.css. Client-only. */
export function cssVar(name: string): string {
  if (typeof window === 'undefined') return '#888888';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888888';
}
