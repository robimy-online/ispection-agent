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
  private meta: Meta;
  private samples: MeasurementSample[];

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.metaPath = path.join(dir, 'meta.json');
    this.bufferPath = path.join(dir, 'buffer.json');
    this.meta = this.readJson<Meta>(this.metaPath, { agentId: null, seq: 0 });
    this.samples = this.readJson<MeasurementSample[]>(this.bufferPath, []);
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

  append(samples: MeasurementSample[]): void {
    this.samples.push(...samples);
    this.writeBuffer();
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
