const { When, Then } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');

const MAX_TRIES = 12;

// "Untouched" = nothing that could change a clip's state with one vote:
// no votes at all, except dialect clips, which carry system votes, so those
// only need to be free of relevance flags (we only ever downvote them).
function untouched(dimension, evalResult, picks) {
  const free = dimension === 'dialect'
    ? !evalResult.votes.some((v) => v.dimension === 'relevance')
    : evalResult.votes.length === 0;
  return free && !Object.values(picks).some((p) => p.clip.clipId === evalResult.clip.clipId);
}

When('(I ask for )the next untouched clip to evaluate for {string}', async function (dimension) {
  for (let i = 0; i < MAX_TRIES; i++) {
    const r = await this.api('GET', `/evaluate/next?username=${this.user}&dimension=${dimension}`);
    assert.equal(r.status, 200);
    if (r.json.done) break;
    if (untouched(dimension, r.json, this.picks)) {
      this.picks[dimension] = r.json;
      return;
    }
  }
  assert.fail(`no untouched ${dimension} clip found in ${MAX_TRIES} tries`);
});

Then('every picked clip has indexed audio', function () {
  for (const [dim, p] of Object.entries(this.picks)) {
    assert.ok(p.clip.tarFile != null, `${dim} clip ${p.clip.clipId} has no audio index`);
  }
});

async function vote(world, dimension, targetId, value) {
  const clipId = world.picks[dimension].clip.clipId;
  world.touched.add(clipId);
  await world.api('POST', '/votes', { clipId, dimension, targetId, username: world.user, value });
  world.lastVote = { clipId, dimension, targetId };
}

When('I vote {int} for the first transcription of the {string} clip', async function (value, dim) {
  const target = String(this.picks[dim].uniqueTranscriptions[0].representativeId);
  await vote(this, 'transcription', target, value);
});
When('I vote {int} for {string} on the {string} clip', async function (value, target, dim) {
  await vote(this, dim, target, value);
});

Then('the stored vote targets the first transcription', function () {
  const want = String(this.picks.transcription.uniqueTranscriptions[0].representativeId);
  assert.equal(this.res.json.targetId, want);
});
Then('I have exactly {int} {string} vote on the {string} clip with value {int}', async function (n, dimension, clipDim, value) {
  const r = await this.api('GET', `/votes/clip/${this.picks[clipDim].clip.clipId}/user/${this.user}`);
  const mine = r.json.filter((v) => v.dimension === dimension);
  assert.equal(mine.length, n);
  assert.equal(mine[0].value, value);
});
Then('the summary of the {string} clip shows net {int} for {string} and not validated', async function (clipDim, net, dimension) {
  const r = await this.api('GET', `/votes/clip/${this.picks[clipDim].clip.clipId}`);
  assert.ok(r.json.some((s) => s.dimension === dimension && s.netVotes === net && s.isGolden === false), JSON.stringify(r.json));
});
Then('the evaluate view of the {string} clip lists my vote', async function (clipDim) {
  const r = await this.api('GET', `/evaluate/clip/${this.picks[clipDim].clip.clipId}?username=${this.user}`);
  assert.equal(r.status, 200);
  assert.ok(r.json.userVotes.length >= 1);
});
Then('the next clip to evaluate for {string} is not the {string} clip', async function (dimension, clipDim) {
  const r = await this.api('GET', `/evaluate/next?username=${this.user}&dimension=${dimension}`);
  assert.ok(r.json.done || r.json.clip.clipId !== this.picks[clipDim].clip.clipId);
});

// Flags
When('I flag the {string} clip as irrelevant because {string}', async function (dim, reason) {
  const id = this.picks[dim].clip.clipId;
  this.touched.add(id);
  this.flagged.add(id);
  await this.api('POST', `/clips/${id}/flag-irrelevant?username=${this.user}&reason=${reason}`);
});
Then('the {string} clip is not marked irrelevant', async function (dim) {
  const r = await this.api('GET', `/clips/${this.picks[dim].clip.clipId}`);
  assert.notEqual(r.json.clip.isRelevant, false, String(r.json.clip.isRelevant));
});
When('I retract my flag on the {string} clip', async function (dim) {
  const r = await this.api('DELETE', `/clips/${this.picks[dim].clip.clipId}/flag-irrelevant?username=${this.user}`);
  assert.ok(r.status < 300);
});
Then('I have no {string} vote on the {string} clip', async function (dimension, dim) {
  const r = await this.api('GET', `/votes/clip/${this.picks[dim].clip.clipId}/user/${this.user}`);
  assert.ok(!r.json.some((v) => v.dimension === dimension));
});
