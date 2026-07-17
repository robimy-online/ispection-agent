import net from 'node:net';

// Single label: 1–63 chars, alphanumeric or hyphen, no leading/trailing hyphen.
const HOSTNAME_RE = /^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*$/;

/**
 * True for a value safe to hand to a network probe (ping/traceroute/connect):
 * an IPv4/IPv6 literal or a syntactically valid hostname. Rejects anything that
 * could be read as a command-line flag (leading '-') or otherwise malformed —
 * the guard against argument injection when targets come from remote config.
 */
export function isValidHost(s: string): boolean {
  if (typeof s !== 'string' || s.length === 0 || s.length > 253) return false;
  if (net.isIP(s) !== 0) return true; // IPv4 or IPv6 literal
  return HOSTNAME_RE.test(s);
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
