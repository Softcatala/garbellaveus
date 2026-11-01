import { HttpException, HttpStatus, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Clip } from '../domain/clip.entity';
import { Response } from 'express';
import * as https from 'https';
import * as http from 'http';
import { MetricsService } from '../observability/metrics.service';
import { AudioCache } from './audio-cache';

const HF_BASE =
  'https://huggingface.co/datasets/softcatala/catalan-youtube-speech/resolve/main';

// Every clip fetch hits huggingface.co (redirect) then a signed CDN URL on a
// consistent host (us.aws.cdn.hf.co as of writing) for the actual bytes —
// both are the same host across every clip/tar file. Node's default global
// agent doesn't keep connections alive, so without this every request pays
// for a fresh TCP+TLS handshake to both hosts (measured ~90-230ms each).
const httpsAgent = new https.Agent({ keepAlive: true });
const httpAgent = new http.Agent({ keepAlive: true });

// Idle time on the upstream socket before we give up on it.
const UPSTREAM_TIMEOUT_MS = 15_000;

// Clips average ~460 KB (max ~650 KB), so the default holds ~140 of them —
// enough for every clip being played at once. AUDIO_CACHE_MB=0 disables the
// cache and streams each range straight from upstream.
const DEFAULT_CACHE_MB = 64;

function cacheBytesFromEnv(): number {
  const mb = Number(process.env.AUDIO_CACHE_MB ?? DEFAULT_CACHE_MB);
  return Number.isFinite(mb) && mb >= 0 ? mb * 1024 * 1024 : DEFAULT_CACHE_MB * 1024 * 1024;
}

interface ByteRange {
  start: number;
  end: number;
  partial: boolean;
}

@Injectable()
export class AudioProxyService {
  private readonly cache = new AudioCache(cacheBytesFromEnv());

  constructor(
    @InjectRepository(Clip) private readonly clips: Repository<Clip>,
    private readonly metrics: MetricsService,
  ) {}

  async streamAudio(clipId: string, res: Response, rangeHeader?: string): Promise<void> {
    const start = process.hrtime.bigint();
    try {
      await this.doStreamAudio(clipId, res, rangeHeader);
      this.metrics.audioProxyRequestsTotal.inc({ outcome: 'ok' });
    } catch (err) {
      this.metrics.audioProxyRequestsTotal.inc({ outcome: this.outcomeFor(err) });
      // Errors must never be cached by browsers or intermediaries.
      if (!res.headersSent) res.setHeader('Cache-Control', 'no-store');
      else res.destroy();
      throw err;
    } finally {
      this.metrics.audioProxyDuration.observe(Number(process.hrtime.bigint() - start) / 1e9);
    }
  }

  private outcomeFor(err: unknown): string {
    if (err instanceof NotFoundException) return 'not_found';
    if (err instanceof HttpException && err.getStatus() === HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE) {
      return 'bad_range';
    }
    return 'upstream_error';
  }

  private async doStreamAudio(clipId: string, res: Response, rangeHeader?: string): Promise<void> {
    const clip = await this.clips.findOne({ where: { clipId } });
    if (!clip) throw new NotFoundException(`Clip ${clipId} not found`);

    if (clip.tarFile == null || clip.tarOffset == null || clip.tarSize == null) {
      throw new NotFoundException(
        `Audio for clip ${clipId} is not indexed yet. Run the indexing script first.`,
      );
    }

    const tarUrl = `${HF_BASE}/audio-${clip.tarFile}.tar`;
    const dataStart = clip.tarOffset;
    const size = clip.tarSize;
    const range = this.resolveRange(rangeHeader, size);

    if (this.cache.enabled) {
      const key = `${clip.tarFile}:${dataStart}:${size}`;
      const { buffer, result } = await this.cache.get(key, () =>
        this.fetchWhole(tarUrl, dataStart, size),
      );
      this.metrics.audioCacheTotal.inc({ result });
      this.metrics.audioCacheBytes.set(this.cache.size);
      this.writeHead(res, range, size);
      res.end(buffer.subarray(range.start, range.end + 1));
      this.metrics.audioProxyBytesTotal.inc(range.end - range.start + 1);
      return;
    }

    const upstream = await this.fetchUpstream(tarUrl, dataStart + range.start, dataStart + range.end);
    this.writeHead(res, range, size);
    await new Promise<void>((resolve, reject) => {
      upstream.pipe(res);
      upstream.on('end', () => {
        this.metrics.audioProxyBytesTotal.inc(range.end - range.start + 1);
        resolve();
      });
      upstream.on('error', reject);
    });
  }

  // Range bounds are relative to the clip, not the tar file. Only the
  // `bytes=a-b` / `bytes=a-` forms are honoured; anything else gets the whole clip.
  private resolveRange(rangeHeader: string | undefined, size: number): ByteRange {
    const match = rangeHeader ? /bytes=(\d+)-(\d*)/.exec(rangeHeader) : null;
    if (!match) return { start: 0, end: size - 1, partial: false };

    const start = parseInt(match[1], 10);
    const end = match[2] ? Math.min(parseInt(match[2], 10), size - 1) : size - 1;
    if (start >= size || end < start) {
      throw new HttpException('Range not satisfiable', HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE);
    }
    return { start, end, partial: true };
  }

  // Headers are only written once upstream has answered successfully, so a
  // failure never leaves a cacheable audio response behind it.
  private writeHead(res: Response, range: ByteRange, size: number): void {
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Length', range.end - range.start + 1);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    if (range.partial) {
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    }
    res.status(range.partial ? 206 : 200);
  }

  private async fetchWhole(tarUrl: string, dataStart: number, size: number): Promise<Buffer> {
    const upstream = await this.fetchUpstream(tarUrl, dataStart, dataStart + size - 1);
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      upstream.on('data', (chunk: Buffer) => chunks.push(chunk));
      upstream.on('end', resolve);
      upstream.on('error', reject);
    });
    const buffer = Buffer.concat(chunks);
    // A short body means the connection dropped mid-clip; never cache or serve it.
    if (buffer.length !== size) {
      this.metrics.audioUpstreamErrorsTotal.inc({ status: 'incomplete' });
      throw new ServiceUnavailableException('Incomplete audio from upstream');
    }
    return buffer;
  }

  private fetchUpstream(
    targetUrl: string,
    start: number,
    end: number,
    redirectsLeft = 3,
  ): Promise<http.IncomingMessage> {
    return new Promise((resolve, reject) => {
      const url = new URL(targetUrl);
      const protocol = url.protocol === 'https:' ? https : http;
      const headers: Record<string, string> = { Range: `bytes=${start}-${end}` };
      // Optional: authenticated requests get a higher HuggingFace rate limit than
      // anonymous ones. Only sent to huggingface.co, never to the signed CDN URL.
      if (process.env.HF_TOKEN && url.hostname === 'huggingface.co') {
        headers.Authorization = `Bearer ${process.env.HF_TOKEN}`;
      }

      const req = protocol.get(
        targetUrl,
        { headers, agent: protocol === https ? httpsAgent : httpAgent },
        (upstream) => {
          const code = upstream.statusCode ?? 0;
          if (code >= 300 && code < 400 && upstream.headers.location) {
            upstream.resume(); // drain to free socket
            if (redirectsLeft > 0) {
              const next = new URL(upstream.headers.location, targetUrl).toString();
              this.fetchUpstream(next, start, end, redirectsLeft - 1).then(resolve, reject);
            } else {
              reject(new ServiceUnavailableException('Too many redirects fetching audio'));
            }
            return;
          }
          if (code >= 400) {
            upstream.resume();
            this.metrics.audioUpstreamErrorsTotal.inc({ status: String(code) });
            reject(new ServiceUnavailableException(`Failed to fetch audio from upstream (${code})`));
            return;
          }
          resolve(upstream);
        },
      );
      req.setTimeout(UPSTREAM_TIMEOUT_MS, () => req.destroy(new Error('Upstream timeout')));
      req.on('error', (err) => {
        this.metrics.audioUpstreamErrorsTotal.inc({
          status: err.message === 'Upstream timeout' ? 'timeout' : 'network',
        });
        reject(new ServiceUnavailableException('Failed to fetch audio from upstream'));
      });
    });
  }
}
