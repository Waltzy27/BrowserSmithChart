/**
 * Example Touchstone files embedded as text. Only the single-file offline build
 * (`npm run build:offline`) loads this module: a page opened from disk (file://)
 * cannot fetch() sibling files, so the examples travel inside the HTML instead.
 */
const files = import.meta.glob('../../public/examples/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
export const EMBEDDED_EXAMPLES: Record<string, string> = Object.fromEntries(
  Object.entries(files).map(([path, text]) => [path.split('/').pop()!, text]),
);
