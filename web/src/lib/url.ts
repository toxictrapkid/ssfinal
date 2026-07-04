/**
 * URL safety for rendering scraped listing links.
 *
 * `l.url` is scraped/ingested data typed only as a string, and React does NOT
 * sanitize an <a href> — a listing whose url is `javascript:…` would execute in
 * the app origin on click and can read the localStorage watchlist/notes. Only
 * ever hand an http(s) URL to an href; make anything else inert ("#").
 *
 * Window-independent (parses with no base) so it is unit-testable and SSR-safe.
 * Listing urls are always absolute https, so requiring an absolute http(s) URL
 * is exactly the intended contract.
 */
export function safeHref(u: string | null | undefined): string {
  if (!u) return "#";
  try {
    const proto = new URL(u).protocol;
    return proto === "http:" || proto === "https:" ? u : "#";
  } catch {
    return "#";
  }
}
