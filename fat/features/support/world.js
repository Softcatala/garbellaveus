const { setWorldConstructor, setDefaultTimeout } = require('@cucumber/cucumber');

setDefaultTimeout(60_000);

const SITE = (process.env.FAT_BASE_URL || 'https://garbellaveus.softcatala.org').replace(/\/$/, '');
const API = `${SITE}/api`;
// Every row this run creates belongs to this user, which is what cleanup deletes.
const USER = process.env.FAT_USERNAME || `fat-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
const API_KEY = process.env.FAT_API_KEY || '';

class FatWorld {
  constructor() {
    this.site = SITE;
    this.user = USER;
    this.res = null;
    this.saved = {};
    this.picks = {}; // dimension -> { clip, uniqueTranscriptions, votes }
    this.listed = null; // first clip of the last list response
    this.touched = new Set(); // clip ids this scenario wrote to
    this.flagged = new Set();
    this.lastVote = null;
  }

  expand(text) {
    return text
      .replace(/\{user\}/g, this.user)
      .replace(/\{(transcription|gender|dialect)\}/g, (_, d) => this.picks[d]?.clip.clipId ?? `{${d}}`);
  }

  async fetch(url, { method = 'GET', body, headers = {} } = {}) {
    const started = Date.now();
    const r = await fetch(url, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });
    const buf = Buffer.from(await r.arrayBuffer());
    const text = buf.toString('utf8');
    let json;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    this.res = { status: r.status, headers: r.headers, buf, text, json, ms: Date.now() - started };
    return this.res;
  }

  api(method, path, body, headers) {
    return this.fetch(`${API}${this.expand(path)}`, { method, body, headers });
  }

  apiKeyHeaders() {
    return { 'x-api-key': API_KEY };
  }
}

setWorldConstructor(FatWorld);
module.exports = { API_KEY, USER, SITE };
