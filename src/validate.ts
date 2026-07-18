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

/**
 * True when `ip` is a public (globally routable) IPv4 literal. False for the ranges that identify
 * someone's home/LAN and must never be published: RFC1918 private (10/8, 172.16/12, 192.168/16),
 * CGNAT (100.64/10), loopback (127/8), link-local (169.254/16), "this network" (0/8) and
 * multicast/reserved (>=224). Non-IPv4 input → false. Used to mask private traceroute hops.
 */
export function isPublicIpv4(ip: string): boolean {
  if (net.isIPv4(ip) === false) return false;
  const o = ip.split('.').map(Number);
  const [a, b] = o;
  if (a === 10) return false; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12
  if (a === 192 && b === 168) return false; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return false; // 100.64.0.0/10 (CGNAT)
  if (a === 127) return false; // loopback
  if (a === 169 && b === 254) return false; // link-local
  if (a === 0) return false; // "this" network
  if (a >= 224) return false; // multicast + reserved
  return true;
}

/**
 * True when `ip` is a public IPv6 literal. False for loopback (::1), unspecified (::),
 * unique-local (fc00::/7) and link-local (fe80::/10). Non-IPv6 input → false.
 */
export function isPublicIpv6(ip: string): boolean {
  if (net.isIPv6(ip) === false) return false;
  const h = ip.toLowerCase().split('%')[0]; // strip zone id (fe80::1%eth0)
  if (h === '::1' || h === '::') return false;
  const first = Number.parseInt(h.split(':')[0] || '0', 16);
  if (Number.isNaN(first)) return false;
  const hiByte = first >> 8;
  if (hiByte === 0xfc || hiByte === 0xfd) return false; // fc00::/7 (ULA)
  if (first >= 0xfe80 && first <= 0xfebf) return false; // fe80::/10 (link-local)
  return true;
}

/**
 * True for a target we're willing to probe on a public, hobby monitor: a public IP literal or a
 * hostname. Rejects private/reserved IP literals so a stray or malicious target (env or remote
 * config) can never point the probes at someone's LAN. Hostnames pass (not resolved here).
 */
export function isPublicTarget(s: string): boolean {
  if (!isValidHost(s)) return false;
  if (net.isIPv4(s)) return isPublicIpv4(s);
  if (net.isIPv6(s)) return isPublicIpv6(s);
  return true; // syntactically valid hostname
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
