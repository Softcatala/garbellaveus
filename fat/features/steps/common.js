const { When, Then } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');

const field = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

When('I request {string}', async function (path) { await this.api('GET', path); });
When('I fetch the site path {string}', async function (path) { await this.fetch(`${this.site}${path}`); });
When('I send {string} {string}', async function (method, path) { await this.api(method, path); });
When('I send {string} {string} with JSON {string}', async function (method, path, body) {
  await this.api(method, path, this.expand(body));
});
When('I send {string} {string} without credentials', async function (method, path) {
  await this.api(method, path, method === 'POST' ? {} : undefined);
});

Then('the response status is {int}', function (status) {
  assert.equal(this.res.status, status, `${this.res.status}: ${this.res.text.slice(0, 200)}`);
});
Then('the response status is {int} or {int}', function (a, b) {
  assert.ok([a, b].includes(this.res.status), `expected ${a} or ${b}, got ${this.res.status}`);
});
Then('the response content type contains {string}', function (type) {
  assert.match(this.res.headers.get('content-type') || '', new RegExp(type.replace('/', '\\/'), 'i'));
});
Then('the response took less than {int} ms', function (ms) {
  assert.ok(this.res.ms < ms, `took ${this.res.ms} ms`);
});
Then('the response body contains {string}', function (text) {
  assert.ok(this.res.text.includes(text), `body does not contain ${text}`);
});
Then('the response body is identical to {string}', async function (url) {
  const other = Buffer.from(await (await fetch(url)).arrayBuffer());
  assert.ok(this.res.buf.equals(other), `differs from ${url}`);
});
Then('the response header {string} matches {string}', function (name, pattern) {
  assert.match(this.res.headers.get(name) || '', new RegExp(pattern), `${name}: ${this.res.headers.get(name)}`);
});
Then('the deployed version matches the expected version', function () {
  const got = this.res.headers.get('x-app-version') || '';
  assert.match(got, /^[0-9a-f]{8}$/, `x-app-version: ${got}`);
  const want = process.env.FAT_EXPECTED_VERSION;
  if (want) assert.ok(got.startsWith(want.slice(0, 8)), `deployed ${got}, expected ${want}`);
  else console.log(`      (deployed version ${got}; set FAT_EXPECTED_VERSION to enforce)`);
});

Then('the field {string} equals {int}', function (path, n) { assert.equal(field(this.res.json, path), n); });
Then('the field {string} is greater than {int}', function (path, n) { assert.ok(field(this.res.json, path) > n); });
Then('the field {string} is true', function (path) { assert.equal(field(this.res.json, path), true); });
Then('the field {string} is false', function (path) { assert.equal(field(this.res.json, path), false); });
Then('the field {string} has {int} entries', function (path, n) { assert.equal(field(this.res.json, path).length, n); });
