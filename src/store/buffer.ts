import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { MeasurementSample } from '../types';

interface Meta {
  agentId: number | null;
  seq: number;
}

/**
 * Durable local buffer + metadata (agentId, monotonic seq). Plain JSON with atomic writes
 * (tmp + rename) so the agent survives restarts/outages with zero native dependencies.
 * Samples persist until the server acknowledges them (HTTP 2xx), then they are dropped.
 */
export class AgentStore {
  private readonly metaPath: string;
  private readonly bufferPath: string;
  private readonly maxSamples: number;
  private meta: Meta;
  private samples: MeasurementSample[];

  constructor(dir: string, maxSamples = 50_000) {
    mkdirSync(dir, { recursive: true });
    this.maxSamples = Math.max(100, maxSamples);
    this.metaPath = path.join(dir, 'meta.json');
    this.bufferPath = path.join(dir, 'buffer.json');
    this.meta = this.readJson<Meta>(this.metaPath, { agentId: null, seq: 0 });
    this.samples = this.readJson<MeasurementSample[]>(this.bufferPath, []);
    // Trim a buffer that grew past the cap under an older build.
    if (this.samples.length > this.maxSamples) {
      this.samples = this.samples.slice(-this.maxSamples);
      this.writeBuffer();
    }
  }

  get agentId(): number | null {
    return this.meta.agentId;
  }

  setAgentId(id: number): void {
    this.meta.agentId = id;
    this.writeMeta();
  }

  /** Persisted before send so a crash never reuses a sequence number. */
  nextSeq(): number {
    this.meta.seq += 1;
    this.writeMeta();
    return this.meta.seq;
  }

  /** Appends samples, enforcing the cap by dropping the oldest. Returns how many were dropped. */
  append(samples: MeasurementSample[]): number {
    this.samples.push(...samples);
    let dropped = 0;
    if (this.samples.length > this.maxSamples) {
      dropped = this.samples.length - this.maxSamples;
      this.samples.splice(0, dropped); // ring behaviour: newest data wins during a long outage
    }
    this.writeBuffer();
    return dropped;
  }

  pending(): number {
    return this.samples.length;
  }

  peekBatch(max: number): MeasurementSample[] {
    return this.samples.slice(0, max);
  }

  dropBatch(count: number): void {
    this.samples.splice(0, count);
    this.writeBuffer();
  }

  private readJson<T>(p: string, fallback: T): T {
    try {
      return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : fallback;
    } catch {
      return fallback;
    }
  }

  private writeMeta(): void {
    this.atomicWrite(this.metaPath, JSON.stringify(this.meta));
  }

  private writeBuffer(): void {
    this.atomicWrite(this.bufferPath, JSON.stringify(this.samples));
  }

  private atomicWrite(p: string, data: string): void {
    const tmp = `${p}.tmp`;
    writeFileSync(tmp, data);
    renameSync(tmp, p);
  }
}
