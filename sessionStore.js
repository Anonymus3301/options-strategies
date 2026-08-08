// Persists small pieces of "what was open last" state in cookies, so reloading
// chart.html restores exactly where you left off (indicators, drawings). Ported
// from the sibling deltaExahangeChart project's own src/sessionStore.js — same
// cookie mechanics, but scoped to "/" here rather than a fixed sub-path, since
// this repo is served from whatever root GitHub Pages (or wherever else) puts it
// at, not a known fixed base path.
//
// A cookie caps total state at ~4KB per name — plenty for a handful of
// indicators/drawings, but worth knowing if this ever needs to grow much further
// (localStorage has no such limit and would be the more typical choice for pure
// client-side state like this).
const COOKIE_MAX_AGE_DAYS = 365;
const COOKIE_PATH = "/";

function readCookie(name) {
  const prefix = `${name}=`;
  for (const part of document.cookie.split("; ")) {
    if (part.startsWith(prefix)) return decodeURIComponent(part.slice(prefix.length));
  }
  return null;
}

function writeCookie(name, value, maxAgeDays) {
  const maxAgeSeconds = Math.round(maxAgeDays * 24 * 60 * 60);
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAgeSeconds}; path=${COOKIE_PATH}; samesite=lax`;
}

/** Creates an independent {load, save} pair backed by its own cookie. */
export function createSessionStore(cookieName) {
  return {
    /** Reads the last-saved session, or null if there isn't one (or it's corrupt). */
    load() {
      const raw = readCookie(cookieName);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },
    save(session) {
      writeCookie(cookieName, JSON.stringify(session), COOKIE_MAX_AGE_DAYS);
    },
  };
}
