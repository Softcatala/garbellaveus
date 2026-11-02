const { Before, After } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const { API_KEY } = require('./world');

// Scenarios that write refuse to start without the key needed to clean up,
// so a run can never leave test votes behind.
Before({ tags: '@writes' }, function () {
  if (!API_KEY) {
    throw new Error('Write scenarios need FAT_API_KEY (used only for DELETE /votes?username=… cleanup). ' +
      'Run read-only with: npm run fat:readonly');
  }
});

After({ tags: '@writes' }, async function () {
  // Flags first, through the public endpoint, so the 2-flag hide rule is re-evaluated.
  for (const clipId of this.flagged) {
    await this.api('DELETE', `/clips/${clipId}/flag-irrelevant?username=${this.user}`);
  }
  const del = await this.api('DELETE', `/votes?username=${this.user}`, undefined, this.apiKeyHeaders());
  assert.equal(del.status, 200, `cleanup DELETE /votes failed: ${del.status} ${del.text}`);

  // Prove it: nothing of ours is left on any clip we touched.
  for (const clipId of this.touched) {
    const left = await this.api('GET', `/votes/clip/${clipId}/user/${this.user}`);
    assert.deepEqual(left.json, [], `votes left on ${clipId} after cleanup`);
  }
});
