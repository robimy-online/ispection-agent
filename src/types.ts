// Mirrors the server's MeasurementSample wire type. The agent stays standalone with no runtime
// dependency on the server, so the wire contract is duplicated here on purpose — keep the two in sync.
export interface MeasurementSample {
  ts: string;
  target: string;
  reachable: boolean;
  rttMs: number | null;
  lossPct: number;
  rttJitterMs?: number | null;
  samples?: number;
  dnsMs?: number | null;
  ttfbMs?: number | null;
  tlsMs?: number | null;
}
