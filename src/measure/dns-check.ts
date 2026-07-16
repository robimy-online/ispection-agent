import { Resolver } from 'node:dns/promises';

export interface DnsCheckResult {
  ispResolveMs: number | null;
  publicResolveMs: number | null;
  nxdomainHijack: boolean;
  dohBlocked: boolean;
}

async function timed(fn: () => Promise<unknown>): Promise<number | null> {
  const start = Date.now();
  try {
    await fn();
    return Date.now() - start;
  } catch {
    return null;
  }
}

/**
 * DNS quality + tamper checks:
 *  - resolution time via the system/ISP resolver vs a public one,
 *  - NXDOMAIN hijack: a random non-existent name MUST NXDOMAIN; an IP back = ISP interception,
 *  - DoH reachability: if encrypted DNS can't be reached, the ISP likely blocks it.
 */
export async function measureDns(testDomain: string, publicServer: string, dohUrl: string): Promise<DnsCheckResult> {
  const sys = new Resolver();
  const pub = new Resolver();
  pub.setServers([publicServer]);

  const ispResolveMs = await timed(() => sys.resolve4(testDomain));
  const publicResolveMs = await timed(() => pub.resolve4(testDomain));

  // Random non-existent name (uncached). A correct resolver → ENOTFOUND; a hijacker → returns an IP.
  const bogus = `nx-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}.com`;
  let nxdomainHijack = false;
  try {
    const addrs = await sys.resolve4(bogus);
    nxdomainHijack = Array.isArray(addrs) && addrs.length > 0;
  } catch {
    nxdomainHijack = false;
  }

  let dohBlocked = false;
  try {
    const res = await fetch(`${dohUrl}?name=${encodeURIComponent(testDomain)}&type=A`, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(5000),
    });
    dohBlocked = !res.ok;
  } catch {
    dohBlocked = true;
  }

  return { ispResolveMs, publicResolveMs, nxdomainHijack, dohBlocked };
}
