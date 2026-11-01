export type AudioCacheResult = 'hit' | 'miss' | 'coalesced';

// Byte-bounded LRU for whole clips, so the several range requests a browser
// makes per play (and replays) cost one upstream fetch instead of one each.
// Concurrent loads of the same key share a single in-flight fetch.
export class AudioCache {
  private readonly entries = new Map<string, Buffer>(); // insertion order = LRU order
  private readonly inFlight = new Map<string, Promise<Buffer>>();
  private bytes = 0;

  constructor(private readonly maxBytes: number) {}

  get enabled(): boolean {
    return this.maxBytes > 0;
  }

  get size(): number {
    return this.bytes;
  }

  async get(
    key: string,
    load: () => Promise<Buffer>,
  ): Promise<{ buffer: Buffer; result: AudioCacheResult }> {
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return { buffer: cached, result: 'hit' };
    }

    const pending = this.inFlight.get(key);
    if (pending) return { buffer: await pending, result: 'coalesced' };

    const loading = load()
      .then((buffer) => {
        this.store(key, buffer);
        return buffer;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, loading);
    return { buffer: await loading, result: 'miss' };
  }

  private store(key: string, buffer: Buffer): void {
    if (buffer.length > this.maxBytes) return;
    this.entries.set(key, buffer);
    this.bytes += buffer.length;
    for (const [oldest, evicted] of this.entries) {
      if (this.bytes <= this.maxBytes) break;
      this.entries.delete(oldest);
      this.bytes -= evicted.length;
    }
  }
}
