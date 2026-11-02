# Functional acceptance tests (FAT)

Black-box checks of a **deployed** GarbellaVeus, written in
[Gherkin](https://cucumber.io/docs/gherkin/) (the `.feature` files) and run with
[cucumber-js](https://github.com/cucumber/cucumber-js). They talk to the public HTTP surface only,
so they work against production, staging or a local stack.

```
features/*.feature      what is checked, in plain language: edit these to add coverage
features/steps/*.js     step definitions (the code behind each sentence)
features/support/       world (HTTP helpers), and the safety/cleanup hooks
```

## Running

```bash
cd fat && npm install

# Read-only: touches nothing, safe any time
npm run fat:readonly

# Full run: also casts test votes and flags, then deletes them
FAT_API_KEY=… npm run fat

# Pin the check to the build you just deployed (short commit SHA)
FAT_EXPECTED_VERSION=$(git rev-parse --short HEAD) FAT_API_KEY=… npm run fat
```

| Variable | Default | Purpose |
|---|---|---|
| `FAT_BASE_URL` | `https://garbellaveus.softcatala.org` | Site under test (API is `<base>/api`) |
| `FAT_API_KEY` | none | The backend `API_KEY`. Used **only** for cleanup (`DELETE /votes?username=`). Write scenarios refuse to run without it |
| `FAT_USERNAME` | `fat-YYYYMMDD` | The one username every test row is created under |
| `FAT_EXPECTED_VERSION` | none | Fails if `x-app-version` is not this commit |

Never commit the key; ask whoever operates the deployment for it.

Run one scenario: `npx cucumber-js --name "A single flag"`. Run one file: `npx cucumber-js features/audio.feature`.

## Safety rules for scenarios that write (`@writes`)

Production has real reviewers, so write scenarios follow these rules. Keep them when adding new ones.

1. **One test user.** Everything is created under `FAT_USERNAME`. Cleanup is
   `DELETE /votes?username=<that user>`, and then the hook asserts that no votes are left on any clip touched.
2. **Only untouched clips.** The `next untouched clip to evaluate` step skips clips that already have votes, so a
   single `+1` can never reach the validation threshold (net votes ≥ 2). Dialect clips normally carry system
   votes, so those scenarios only **downvote**, which can never help a clip reach it.
3. **Retract flags via the unflag endpoint**, not just by deleting rows: it re-evaluates the 2-flag
   "irrelevant" rule. A single flag can't hide a clip, and the scenarios never flag one that already has a flag.
4. **Never create what cannot be deleted.** There is no delete for transcriptions or issue reports, and the email
   opt-in sends real mail. Those endpoints are only tested with invalid payloads that must return `400`.
5. **Mind the rate limits.** Unauthenticated writes and the email opt-in are rate-limited per IP at the proxy.
   A full run is far below the limits; don't loop it.

Things a FAT cannot undo: the cumulative metrics counters (`votes cast`, `clips flagged`) keep the test
votes. A run adds about 8 to them.

## What is covered

| Feature | Checks |
|---|---|
| `static-assets` | Site files and icons served with the right type, favicon links, SPA routes, header logo is the official artwork, deployed version |
| `browse-and-search` | List total/speed, capped search count (1000), 3-character minimum, no-match, page-size clamp, paging, detail, 404, `x-app-version` |
| `audio` | HuggingFace-backed proxy: 206 range, full 200, 404 not cached, 416 |
| `evaluation-and-voting` *(writes)* | Evaluate flow per dimension, vote target, vote upsert, summary, clip not served again |
| `flagging` *(writes)* | Single flag does not hide the clip, flag retraction, invalid flags rejected |
| `validation-and-auth` | Malformed writes return 400, admin endpoints reject missing key |

## Performance guards worth keeping

`GET /clips?page=1&limit=20` must stay under 1.5 s. The backend uses one SQLite connection, so a slow list
query stalls voting and evaluating for everyone (see the `transcriptions.clip_id` index). If that scenario
fails, check for a missing index before anything else.

## Known gap

`GET /clips?page=abc` returns 200 with the normal list instead of 400. This is harmless and is not asserted.
