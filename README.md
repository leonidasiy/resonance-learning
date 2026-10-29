# Resonance Learning

Resonance is a private learning platform for turning permitted sources into
source-linked knowledge cards and retrieval-practice quizzes. Music is its first
subject; extraction now uses a fixed 22-subject taxonomy with source-specific
subcategories. Fieldnotes is the light theme and Observatory the dark theme.

## License

Original project code and documentation use the custom
[Resonance Personal Use License](LICENSE). Individuals may install, self-host,
and modify it privately for their own noncommercial use. Commercial or business
use, hosted access for others, and republication of original or modified copies
require the copyright owner's separate written permission. Commercial rights
to the owner's original work are reserved. This is source-available software,
not open source or a standard GitHub license template.

Third-party materials retain their own terms, including the licenses in
[`vendor/ts-fsrs`](vendor/ts-fsrs/LICENSE), [`vendor/yaml`](vendor/yaml/LICENSE),
and [`assets/fonts`](assets/fonts/LICENSE.txt). The Open Music Theory walkthrough
content retains its attribution and CC BY-SA 4.0 terms recorded in
[`local/walkthrough-content.json`](local/walkthrough-content.json).

## Set up your own copy on computer and phone

Start with [SETUP.md](SETUP.md) to compare two complete setups:

- [Run the backend on your computer](COMPUTER_SETUP.md): local database/storage,
  password login, your own API keys, and private phone access. No Cloudflare
  account; the computer must stay on.
- [Deploy to your own Cloudflare account](SELF_HOSTING.md): hosted app, database,
  files and login, plus [your acquisition server](ACQUISITION_SETUP.md) for web
  extraction. More setup and cloud services, with learning available when your
  computer is off.

Both use [your own API services](SERVICES.md), never the maintainer's credits.
The repository includes the runtime, lockfiles, assets, agent configuration,
migrations, new-install seed and safe configuration examples. No private
maintainer files are required. A separate [sample demo](SETUP.md#run-the-local-demo)
needs no API keys. Phone installation opens your backend; it does not run one
on the phone.

To record the real Library → Feed → Review → Progress workflow with isolated
sample history, run `deno task walkthrough` and open `http://localhost:4180`.

Personal deployment configurations stay local and are excluded from Git.
For your account use `wrangler.self-host.example.jsonc` and the guide above.

The repository keeps application source, reusable tests, lockfiles, required
runtime assets and setup examples. Agent skills, internal development notes,
editor state, credentials, local databases, validation reports and build outputs
stay local. `npm ci` recreates dependencies; `deno task build` recreates `dist/`.
The pinned `vendor/` files and source offline manifest are runtime inputs,
so they remain included.

## Use the learning workflow

Open **your own backend URL** and sign in with your local password or
Cloudflare Access policy. The maintainer's private deployment is not a shared backend for forks.
Enable optional discovery providers only with your own keys; use direct uploads
until any required acquisition service is provisioned.

1. In **Discover**, search for an educational source and choose **Add to
   Library** when its rights evidence permits processing. If acquisition is
   blocked or permission is unclear, use the offered authorized-upload path.
   For your own file, open **Library → Upload a private document**.
2. Enter a title if needed; paste text or select a `.txt`, `.md`, `.pdf`,
   `.pptx`, PNG, JPEG, WebP, or GIF file. Text processing is the default.
   Embedded raster images in PDFs and PowerPoint files are extracted and matched
   automatically, including in text mode; those images are sent to the vision
   model. **Read PDF pages as images** additionally reads whole pages for scanned
   text or vector diagrams. A blank PDF page range means all pages; `1,3-5`
   selects specific pages. Confirm that you have permission for storage,
   transformation, and external AI processing, then choose **Upload and process**.
3. Watch the source in **Library**. Its card refreshes every minute with the
   current page/section, extracted points and generated question count. It reports a named reason when
   action is needed, or **Knowledge extraction and paired question generation
   completed**. If a transient failure shows **Retry processing**, use that
   control. Reviewed knowledge appears incrementally while the rest of the
   source continues processing. Expand the source to inspect its knowledge;
   long lists scroll inside the expanded panel. Dismissing a failed processing
   item keeps its saved source.
   **Cancel processing** asks for confirmation and removes that run's points,
   quizzes and associated images.
4. Open **Feed** to study a five-card batch. Reach the bottom and choose **Mark
   batch studied** to unlock its paired questions. If no batch is available,
   at least five eligible published knowledge-and-quiz pairs are needed.
5. Open **Review** to answer the unlocked questions. Submit with **Check
   answer** to see feedback; uncertain text answers remain pending until the
   grader is available. Review intervals follow your completed attempts.

Semantic text grading uses `~typesafe/jev-latest` and accepts answers at ≥70%
correctness probability. Exact answers and choices use answer-key checks.
The production reviewer uses `xiaomi/mimo-v2.6-flash` to approve extracted
points and quizzes before publication; external test evaluation does not control
publication. Knowledge without an accepted quiz can remain in Library; Feed
requires eligible knowledge-and-quiz pairs.

Only upload material you are allowed to use. Source rights checks, access
controls and private storage apply in both full backend modes. The sample demo
uses separate browser-local records.

## Project map

Library offers subject shelves and source/knowledge search. Feed cards reveal
as you scroll; missing associated imagery leaves no placeholder box. Progress
shows daily and subject review accuracy, activity, scores and attempt totals.
Historical unclassified records are preserved without backfills.

Review supports skipping without recording an answer, explicit batch refresh,
and countdowns before replacing skipped questions or moving to the next batch.
Submitted text answers show canonical answers and component feedback. Associated
images appear in Review too. Feed offers optional card reading through the
browser's speech synthesis. These controls and five-card batches are product
choices; activity and model scores do not establish durable learning.

See [setup and everyday use](SETUP.md) for installation, reminders, data and offline limits,
and [recent changes](changelog.md) for the current implementation history.

## Development and validation

Application features live in `src/features/`, with route/startup composition in
`src/routes/` and `src/startup/`. `worker/` contains the hosted API, durable
workflows and migrations; `local/` supplies computer-mode bindings for the shared
pipeline. `acquisition/` handles permitted website resources. The four
`agent-config/` roles and their canonical digests configure model work; see
[model configuration](MODEL_APIS.md).

Use the Deno tasks in `deno.json`:

```sh
npm ci
deno task check
deno task build
deno task test
deno task check:migrations
deno task test:migrations
```

Build before the Deno test suite: build-contract tests read `dist/`. Node runtime
and integration coverage lives in `tests-node/`; run the files relevant to the
change with `node --test --test-timeout=30000 tests-node/NAME.test.mjs`.
`deno task test:material-batch` covers synthetic upload/checkpoint recovery.
These commands use fixtures; paid provider/benchmark runs need their own inputs
and authorization. After previews and checks close, generated root builds and
disposable test outputs can be removed. Preserve runtime data, required fixtures,
canonical dependencies and retained accounting/provenance.
