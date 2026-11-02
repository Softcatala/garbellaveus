const { When, Then } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');

When('I remember the first clip id as {string}', function (name) {
  this.saved[name] = this.res.json.items[0].clip.clipId;
});
Then('the first clip id differs from {string}', function (name) {
  assert.notEqual(this.res.json.items[0].clip.clipId, this.saved[name]);
});

When('I request the first listed clip', async function () {
  this.listed = this.res.json.items[0].clip.clipId;
  await this.api('GET', `/clips/${this.listed}`);
});
When('I request the transcriptions of the first listed clip', async function () {
  await this.api('GET', `/clips/${this.listed}/transcriptions`);
});

// Audio: the Background lists one clip, so remember it before anything else runs.
const listedId = (w) => (w.listed ??= w.res.json.items[0].clip.clipId);

When('I request the audio of the first listed clip', async function () {
  await this.api('GET', `/audio/${listedId(this)}`);
});
When('I request the audio of the first listed clip with range {string}', async function (range) {
  await this.api('GET', `/audio/${listedId(this)}`, undefined, { range });
});
When('I request the audio of clip {string}', async function (id) { await this.api('GET', `/audio/${id}`); });

Then('the audio body is {int} bytes starting with {string}', function (n, magic) {
  assert.equal(this.res.buf.length, n);
  assert.equal(this.res.buf.subarray(0, magic.length).toString(), magic);
});
Then('the audio body length equals its content-length header', function () {
  assert.equal(this.res.buf.length, Number(this.res.headers.get('content-length')));
});
