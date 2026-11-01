import { AudioCache } from './audio-cache';

const buf = (n: number) => Buffer.alloc(n, 1);

describe('AudioCache', () => {
  it('loads once, then serves hits', async () => {
    const cache = new AudioCache(1000);
    const load = jest.fn().mockResolvedValue(buf(100));

    expect((await cache.get('a', load)).result).toBe('miss');
    expect((await cache.get('a', load)).result).toBe('hit');
    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(100);
  });

  it('shares one load between concurrent callers', async () => {
    const cache = new AudioCache(1000);
    let release!: (b: Buffer) => void;
    const load = jest.fn(() => new Promise<Buffer>((r) => (release = r)));

    const calls = [cache.get('a', load), cache.get('a', load), cache.get('a', load)];
    release(buf(50));
    const results = (await Promise.all(calls)).map((c) => c.result);

    expect(load).toHaveBeenCalledTimes(1);
    expect(results).toEqual(['miss', 'coalesced', 'coalesced']);
  });

  it('evicts the least recently used entry to stay under the byte cap', async () => {
    const cache = new AudioCache(250);
    await cache.get('a', async () => buf(100));
    await cache.get('b', async () => buf(100));
    await cache.get('a', async () => buf(100)); // refresh a, so b is now oldest
    await cache.get('c', async () => buf(100)); // 300 > 250 -> evict b

    expect(cache.size).toBe(200);
    expect((await cache.get('a', async () => buf(100))).result).toBe('hit');
    expect((await cache.get('b', async () => buf(100))).result).toBe('miss');
  });

  it('does not store a clip larger than the whole cache', async () => {
    const cache = new AudioCache(100);
    await cache.get('big', async () => buf(500));
    expect(cache.size).toBe(0);
  });

  it('does not cache failures and lets the next caller retry', async () => {
    const cache = new AudioCache(1000);
    await expect(cache.get('a', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect((await cache.get('a', async () => buf(10))).result).toBe('miss');
  });

  it('is disabled at zero bytes', () => {
    expect(new AudioCache(0).enabled).toBe(false);
  });
});
