import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PassThrough, Readable } from 'stream';
import * as http from 'http';
import { AudioProxyService } from './audio-proxy.service';
import { MetricsService } from '../observability/metrics.service';

const CLIP = { clipId: 'c1', tarFile: 3, tarOffset: 1000, tarSize: 10 };
const BYTES = Buffer.from('0123456789');

function fakeRes() {
  const headers: Record<string, unknown> = {};
  const res: any = {
    headers,
    statusCode: 0,
    headersSent: false,
    body: undefined as Buffer | undefined,
    setHeader: (k: string, v: unknown) => (headers[k] = v),
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    end(b: Buffer) {
      res.body = b;
    },
    destroy: jest.fn(),
  };
  return res;
}

function build(clip: unknown = CLIP) {
  const metrics = new MetricsService();
  const service = new AudioProxyService({ findOne: async () => clip } as any, metrics);
  const upstream = jest
    .spyOn(service as any, 'fetchUpstream')
    .mockImplementation(async (..._args: unknown[]) => Readable.from([BYTES]) as any);
  return { service, upstream, metrics };
}

describe('AudioProxyService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.AUDIO_CACHE_MB;
  });

  it('fetches a clip from upstream once for several range requests', async () => {
    const { service, upstream } = build();

    const first = fakeRes();
    await service.streamAudio('c1', first, 'bytes=0-');
    const second = fakeRes();
    await service.streamAudio('c1', second, 'bytes=4-6');
    const third = fakeRes();
    await service.streamAudio('c1', third);

    expect(upstream).toHaveBeenCalledTimes(1);
    expect(upstream).toHaveBeenCalledWith(expect.stringContaining('audio-3.tar'), 1000, 1009);

    expect(first.statusCode).toBe(206);
    expect(first.headers['Content-Range']).toBe('bytes 0-9/10');
    expect(second.body.toString()).toBe('456');
    expect(second.headers['Content-Range']).toBe('bytes 4-6/10');
    expect(second.headers['Content-Length']).toBe(3);
    expect(third.statusCode).toBe(200);
    expect(third.body.toString()).toBe('0123456789');
    expect(third.headers['Cache-Control']).toBe('public, max-age=3600');
  });

  it('answers 416 for a range past the end, without touching upstream', async () => {
    const { service, upstream } = build();
    await expect(service.streamAudio('c1', fakeRes(), 'bytes=50-')).rejects.toMatchObject({ status: 416 });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('marks upstream failures no-store and does not cache them', async () => {
    const { service, upstream } = build();
    upstream.mockRejectedValueOnce(new ServiceUnavailableException('429'));

    const failed = fakeRes();
    await expect(service.streamAudio('c1', failed)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(failed.headers['Cache-Control']).toBe('no-store');
    expect(failed.headers['Content-Type']).toBeUndefined();

    const retry = fakeRes();
    await service.streamAudio('c1', retry);
    expect(retry.body.toString()).toBe('0123456789');
  });

  it('rejects a truncated upstream body instead of serving or caching it', async () => {
    const { service, upstream } = build();
    upstream.mockImplementationOnce(async () => Readable.from([BYTES.subarray(0, 4)]) as any);

    await expect(service.streamAudio('c1', fakeRes())).rejects.toBeInstanceOf(ServiceUnavailableException);
    const retry = fakeRes();
    await service.streamAudio('c1', retry);
    expect(retry.body.length).toBe(10);
  });

  it('streams straight from upstream when the cache is disabled', async () => {
    process.env.AUDIO_CACHE_MB = '0';
    const { service, upstream } = build();
    upstream.mockImplementation(async () => Readable.from([BYTES.subarray(4, 7)]) as any);

    const streamRes = () => {
      const res: any = Object.assign(new PassThrough(), {
        headers: {} as Record<string, unknown>,
        statusCode: 0,
        setHeader(k: string, v: unknown) {
          res.headers[k] = v;
        },
        status(code: number) {
          res.statusCode = code;
          return res;
        },
      });
      res.received = [] as Buffer[];
      res.on('data', (c: Buffer) => res.received.push(c));
      return res;
    };

    const res = streamRes();
    await service.streamAudio('c1', res, 'bytes=4-6');
    await service.streamAudio('c1', streamRes(), 'bytes=4-6');

    expect(upstream).toHaveBeenCalledTimes(2);
    expect(upstream).toHaveBeenCalledWith(expect.any(String), 1004, 1006);
    expect(res.statusCode).toBe(206);
    expect(Buffer.concat(res.received).toString()).toBe('456');
  });

  it('404s for unknown or unindexed clips', async () => {
    await expect(build(null).service.streamAudio('x', fakeRes())).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      build({ clipId: 'x', tarFile: null, tarOffset: null, tarSize: null }).service.streamAudio('x', fakeRes()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('upstream error metric', () => {
    let server: http.Server;
    let url: string;
    let respond: (res: http.ServerResponse) => void;

    beforeEach(async () => {
      server = http.createServer((_req, res) => respond(res));
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      url = `http://127.0.0.1:${(server.address() as any).port}/audio.tar`;
    });
    afterEach(() => new Promise<void>((r) => server.close(() => r())));

    const count = async (m: MetricsService, status: string) =>
      (await m.audioUpstreamErrorsTotal.get()).values.find((v) => v.labels.status === status)?.value ?? 0;

    it('counts a 429 from upstream under its status', async () => {
      const metrics = new MetricsService();
      const service = new AudioProxyService({} as any, metrics);
      respond = (res) => res.writeHead(429).end();

      await expect((service as any).fetchUpstream(url, 0, 9)).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(await count(metrics, '429')).toBe(1);
    });

    it('counts a dropped connection as a network error', async () => {
      const metrics = new MetricsService();
      const service = new AudioProxyService({} as any, metrics);
      respond = (res) => res.destroy();

      await expect((service as any).fetchUpstream(url, 0, 9)).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(await count(metrics, 'network')).toBe(1);
    });
  });
});
