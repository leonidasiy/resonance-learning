# Changelog

## 2026-10-29 processing recovery, images and reviewer

- Switched the production knowledge/quiz reviewer to MiMo V2.6 Flash; the
  checked-in role and self-host template contain matching canonical digests.
- Persisted CPU-crash recovery, gradual smaller work admission and durable model
  stage checkpoints. Completed reviews are selected independently of CPU limits;
  interrupted requests and transient failures recover without discarding saved work.
- Extract embedded PDF/PowerPoint raster images and resume them from private,
  digest-bound storage. Read cached pixels only when needed and propagate integrity
  failures. Hosted PDF decoding uses Browser Run with separate launch/decode/transfer
  diagnostics and fewer transfer round trips.
- Reuse independent captions, fixed upload inventories and source audit work;
  reduce duplicate agent context, hashing allocations and D1 row scans.
- Preserve source language and useful subject relationships; reject generic course
  framing as learning targets. Ground review history in exact validated quotations.

## 2026-10-27–28 Library, source coverage and quiz publication

- Publish reviewed knowledge incrementally and begin quizzes during extraction.
  Account for every source block, preserve table context and inline links, and
  repair incomplete planner/reviewer responses with precise validation feedback.
- Accept grounded quizzes scoring at least 7/10. After bounded quiz exhaustion,
  retain accepted knowledge in Library; Feed still requires a usable paired quiz.
- Redesign processing cards and unify source disclosures. Link processing status
  to the source, allow failed-item dismissal without source deletion, retain search
  options and bound expanded knowledge lists. Match Library subject badges to Feed.
- Exclude YouTube URLs from Brave web results; the dedicated YouTube provider
  remains metadata-only.

## 2026-10-19–24 Feed and Review

- Cache opened panels while retaining content during refresh. Add optional Feed
  card reading with browser speech synthesis.
- Keep submitted feedback and show canonical text answers and per-component
  results. Refresh batches without reopening already attempted quiz variants.
- Check quiz answer importance and repair answer targets before rejecting useful
  questions. Coordinate paired recall intervals and show associated Review images.
- Add skipped-question replacement and next-batch countdowns. Skipping does not
  record an answer or change recall scheduling.

## 2026-10-18 study and progress

- Refresh Feed after Library additions and replace batches without losing saved
  progress. Review can refresh early, skips do not schedule answers, and choice
  order stays shuffled consistently within a batch.
- Show daily-goal completion feedback and clearer Progress charts with calendar
  date axes, source-subject filtering and subjects ranked by knowledge count.
  Daily accuracy history is connected to actual recorded review outcomes.

## 2026-10-18 repository cleanup

- Excluded local agent/design tools, internal notes, generated validation reports,
  editor/runtime state and personal Cloudflare configuration from Git.
- Kept local copies and complete public setup inputs. Deployment/seed checks now
  use the public templates instead of requiring the maintainer's local files.

## 2026-10-18 unused ZIP dependency removal

- Replaced Cloudflare Puppeteer's unused browser-helper dependency with upstream
  3.2.5 through a scoped npm override. This removes `extract-zip` and its old
  FTP/proxy chain while preserving the existing Cloudflare browser client.
- Full npm audit now reports zero vulnerabilities. Dependency and remote-binding
  regressions replace checks for packages no longer installed; URL/PDF capture
  behavior retains its existing coverage. See [the assessment](DEPENDENCY_SECURITY.md).

## 2026-10-18 model API substitution and dependency review

- Added server-side OpenAI-compatible model API configuration, replacement semantic
  grading and reranking, and a canonical agent-digest command. An isolated synthetic
  pipeline verifies a different endpoint/model through publication, grading and restart.
- Updated vulnerable IP parsing and FTP parsing dependencies. Three remaining high
  audit alerts trace to an unpatched ZIP installer dependency outside the deployed
  Worker graph; see [the scoped assessment](DEPENDENCY_SECURITY.md).

## 2026-10-18 independent setup

- Added a standalone computer backend with private SQLite/files, password login,
  persistent learning workflows and private HTTPS phone access using readers’
  own API services. It needs no Cloudflare account.
- Added portable acquisition deployment, authenticated private Cloudflare bridge,
  own-account templates and empty-install seed. Shared workflow execution keeps
  local and cloud processing aligned.
- Added beginner computer/cloud/acquisition/API guides with option tradeoffs,
  backups, troubleshooting and no dependency on maintainer credentials.
- Fixed private-document links when moving between computer and phone origins.
  Synthetic integration covers upload, publication, study, review and restart.

## 2026-10-14

- Follow-up user exploration by Luna verified signed-in production navigation,
  responsive layouts, keyboard access and empty states. Fixed internal quiz IDs
  in answer feedback, desktop tagline spacing, and Review reloads reopening
  already answered questions. Actual-content isolated browser regression passed.
- Added hybrid browser navigation for public educational sources and durable
  processed-page tracking. Unavailable robots metadata does not by itself block
  processing accessible public content; access barriers remain respected.
- Added per-source Library progress that refreshes every minute, source-card
  navigation after extraction starts, and confirmed cancellation cleanup.
- Updated the production reviewer to MiMo v2.6 Pro, repaired paired Review
  projections, and preserved source-linked image associations.
- Semantic answer grading uses `~typesafe/jev-latest` with an inclusive 70%
  correctness-probability threshold. Recall preferences adjust intervals.
- Expanded `SETUP.md` with beginner local-demo instructions, phone installation,
  everyday use, and troubleshooting.

## 2026-10-04

- Started approved source-wide classification milestone. Confirmed legacy classification is stored per knowledge point and is included in old extraction prompts; preserving those values while adding a source-owned record.
- Added one provider-injected source classifier after extraction consolidation, source-owned revision-checked persistence, two-field Feed editing, and topic inclusion in keyword/semantic Library knowledge search. Added migration 0019 with legacy audit and retryable review-issue tables plus FTS topic synchronization.
- Source classification, topic search, and the owner-scoped backfill path are implemented with Deno/SQLite integration coverage. The all-source job has not been run against hosted data.
- Completed paired-quiz generation and learner UI, canonical-answer validation, stable IDs, atomic persistence, answer-safe review projection, exact-set choices, Jev semantic grading, and idempotent knowledge-level progress. Independent local desktop/mobile browser review passed in both themes, with all seven scores above 8.5 and no critical defects.
- Learner packaging follow-up: inspected the production graph (19 JavaScript files, 222,630 raw / 72,317 gzip) and found no safe duplicate/dead code optimization that closes the 2,630 raw / 317 gzip gap without changing behavior or presentation. Set aggregate limits to the exact measured totals, preserving initial/per-chunk caps and separate raw/gzip failure checks. Full validation passed: Deno (1,099/1,099), Node (55/55), strict check, 20 migrations / 136 schema objects, and migration tests (6/6). The build artifact is local; release remained gated on independent acceptance.
- Release checkpoint: the initial budget gate correctly failed at 222,630 raw / 72,317 gzip against the earlier 222,424 / 72,250 caps. The approved exact measured caps now accept equality and independently reject values one byte above either cap. The earlier 300,000 / 100,000 diagnostic allowances were not release validation.
- Jev grader now receives the typed model, endpoint, threshold, and evidence configuration explicitly from Worker composition. Adapter tests prove injected serving/acceptance settings are used; nine bounded synthetic live Decisions API cases passed with no false acceptance. No hosted learner records or classification backfill were changed.

## 2026-10-06

- Closed approved image boundaries: typed malformed-upload failures, stored uploaded visual cues, verified matches with durable candidate/page warnings, and owner-attributed persistent page/run budgets with original model/acquisition attempt deadlines and pixel-bound model replay.
- Added the configurable labelled holdout harness and working offline positive/rejection exercises; synthetic fixture arithmetic is not model accuracy. Full local checks/build/browser evidence and remaining semantic/prescribed-review limits: final closure. No live requests, deployment, Git mutation or learner data changes.

## 2026-10-07

- Fixed webpage extraction schema/types, canonical quote provenance, shared phase/request admission, and cancellation/timer/body/usage diagnostics. Mocked production workflow retains text after image-association failure. Historical paid evidence and learner data remain unchanged.

## 2026-10-08

- Added canonical validation-evidence snapshot/artifact/retention tasks: explicit SHA256 file manifests, verified immutable digest reuse with per-run receipts, and report-only 30-day inactive/unreferenced eligibility. Future Codex review/benchmark guidance uses these tasks instead of recursive history/dependency copies. Historical outputs and build contracts retained; deletion remains separately gated.

## 2026-10-08 validation evidence lifecycle repair

- Clean owned OS-temp test fixtures, retire only successful invocation stages (including identical receipts), and protect inactive parents with registered active/unknown descendants. Behavioral RED25/2 → GREEN27/27; two final repeats leave zero project fixtures. Fresh directory sealing is0555; historical0700 remains unchanged.
- Deleted exactly267 manifest-bound disposable roots,0skips; retained18logs, real evidence, canonical outputs, dependencies and caches. Preserved the original1,000-line PROCESS byte-for-byte in PROCESS.history-2026-10-08.md and consolidated active guidance below450lines.

## 2026-10-13

- Improve source-backed webpage coverage and preserve the taught relationship during review and repair. Allow labeled contextual illustrations while checking factual diagrams against their visible content.
- Give quiz generation an initial attempt plus three retries. Remove the knowledge point and quiz after exhausted generation, and report knowledge/quiz drop and retry statistics against their original cohorts.
- Fix captured image attachments at the model boundary and retain text-only knowledge and quizzes when optional image storage fails. Preserve processing diagnostics across workflow phases.
- Reuse cached shell markup for Library, Upload and Feed to keep the existing frontend size limits.
