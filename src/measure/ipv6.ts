import { tcpConnect } from './tcp';

export interface Ipv6Measurement {
  reachable: boolean;
  ipv6RttMs: number | null;
  ipv4RttMs: number | null;
}

/**
 * IPv6 reachability + connect time vs an IPv4 baseline. Uses TCP connect (privilege-free);
 * net.connect infers the address family from the literal, so no `ping -6` portability quirks.
 */
export async function measureIpv6(ipv6Target: string, ipv4Baseline: string): Promise<Ipv6Measurement> {
  const v6 = await tcpConnect(ipv6Target, 443);
  const v4 = await tcpConnect(ipv4Baseline, 443);
  return { reachable: v6.reachable, ipv6RttMs: v6.connectMs, ipv4RttMs: v4.connectMs };
}
