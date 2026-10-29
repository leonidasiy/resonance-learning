# Your services, keys and configuration

Choose [computer setup](COMPUTER_SETUP.md) or [Cloudflare setup](SELF_HOSTING.md).
This reference explains credentials and optional features. In computer mode, put
your keys in the matching names in private `.env.local` and restart. Cloudflare
commands below instead store secrets in your private `wrangler.self-host.jsonc`
deployment; do not run them for computer mode.

## Costs and isolation

Your independent copy uses your provider keys. Computer mode uses local storage
and needs no Cloudflare account; cloud mode uses your own Cloudflare resources.
Your phone and computer share that copy's HTTPS address. Adding personal API
keys while visiting the original owner's site does not create an independent
installation; API credentials belong on your own server, never in the browser.
The app has no supported Settings screen for entering API keys.

Check current allowances and prices in your own accounts before enabling:

- [Workers](https://developers.cloudflare.com/workers/platform/pricing/),
  [D1](https://developers.cloudflare.com/d1/platform/pricing/),
  [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/)
  and [Workflows](https://developers.cloudflare.com/workflows/reference/pricing/).
- [R2](https://developers.cloudflare.com/r2/pricing/) and
  [Images](https://developers.cloudflare.com/images/pricing/) for private files
  and image transformations; [Browser Run](https://developers.cloudflare.com/browser-rendering/pricing/)
  for browser-bound image decoding and legacy acquisition.
- [OpenRouter model pricing](https://openrouter.ai/models),
  [Brave Search plans](https://api-dashboard.search.brave.com/),
  [Taddy plans](https://taddy.org/developers/podcast-api) and
  [Firecrawl plans](https://www.firecrawl.dev/pricing) if you enable them.

Free quotas are not promises of zero cost for a full workload. Set a dedicated
OpenRouter key credit limit and monitor Cloudflare/provider usage. The app's
R2 ledger limits and per-run browser budgets do not cap all account spending.
Background jobs and retained storage can consume resources while the app is
closed. A new user's setup never needs the original owner's API keys, login
cookies, D1 ID, R2 bucket or Cloudflare membership.

## AI and grading

**Default for uploaded-source extraction and AI features:** your own
`OPENROUTER_API_KEY`. [Create and limit a key](https://openrouter.ai/settings/keys);
see [OpenRouter authentication](https://openrouter.ai/docs/api/reference/authentication).
Store it with:

```sh
npx wrangler@4.151.1 secret put OPENROUTER_API_KEY --config wrangler.self-host.jsonc
```

The current checked-in implementation requests:

| Purpose | Model/API |
| --- | --- |
| Rights assessment, knowledge extraction, question generation and vision | `z-ai/glm-5.3-flash`, through OpenRouter. |
| Production knowledge/quiz review | `xiaomi/mimo-v2.6-flash`, through OpenRouter. |
| Semantic grading of non-exact answers | `~typesafe/jev-latest`, OpenRouter's alpha Decisions API. |

These are code/configuration contracts, not a claim that every account can access
them indefinitely. Model availability, account permissions and pricing can
change. Confirm access in your own account. If Jev is unavailable, exact-key and
choice checks still work; semantic answers can remain pending. A paid chat
subscription is not an API key. To use a different model or an
OpenAI-compatible API, follow [switching model APIs](MODEL_APIS.md). This includes
replacing semantic grading; the default Jev service is optional in that setup.

`agent-config/*.yaml`, their loader, the digest command, and the matching digest setting are included
in GitHub. The reviewer keeps `reasoningEffort: none`; configuration changes
require fresh canonical digests as described in [model configuration](MODEL_APIS.md).
Private development skills and evaluation credentials are not runtime
dependencies. Submitted text/images are sent to the configured AI services when
you authorize processing; review their privacy terms before uploading material.
The current adapter does not impose an OpenRouter zero-data-retention route.

`OPENROUTER_INPUT_USD_PER_MILLION` and `OPENROUTER_OUTPUT_USD_PER_MILLION` are
optional accounting rates (default `1` each). They are not provider prices,
billing limits or a way to choose a model. If you use them, set rates appropriate
to your workflow; dashboards remain the source of billing information.

## Optional source discovery

You can upload your own permitted documents without any discovery API key.
Missing optional providers are unavailable; they do not borrow anyone else's key.

| Feature | Where to obtain your own credentials | Worker secret names |
| --- | --- | --- |
| Web search | [Brave Search API](https://api-dashboard.search.brave.com/documentation/guides/authentication): create a subscription/API key under your account. | `BRAVE_SEARCH_API_KEY` |
| YouTube metadata search | [Google setup](https://developers.google.com/youtube/v3/getting-started): create your project, enable YouTube Data API v3, create a server API key restricted to that API. | `YOUTUBE_API_KEY` |
| Podcast-series search | [Taddy Podcast API](https://taddy.org/developers/podcast-api): register and obtain both the user ID and matching API key. | `TADDY_USER_ID`, `TADDY_API_KEY` |

In computer mode fill the matching `.env.local` values instead. In cloud mode,
run only the commands for the features you want; paste each value at its hidden
prompt, never into the command itself:

```sh
npx wrangler@4.151.1 secret put BRAVE_SEARCH_API_KEY --config wrangler.self-host.jsonc
npx wrangler@4.151.1 secret put YOUTUBE_API_KEY --config wrangler.self-host.jsonc
npx wrangler@4.151.1 secret put TADDY_USER_ID --config wrangler.self-host.jsonc
npx wrangler@4.151.1 secret put TADDY_API_KEY --config wrangler.self-host.jsonc
```

Both Taddy secrets must be present together. YouTube uses an API key, not Google
OAuth consent, and provides metadata/links, not media/caption downloads. The
template's YouTube quotas are app ledger settings, not a guarantee of your Google
project's quota or cost. Podcast search does not install speech transcription.
Processing a discovered web link requires the additional acquisition deployment
described in [ACQUISITION_SETUP.md](ACQUISITION_SETUP.md) for cloud mode. Computer
mode bundles acquisition and only needs your own Firecrawl key.

## Optional Android notifications

Computer mode automatically generates and stores its own VAPID keys in
`.private/local/credentials.json`; preserve that file across updates. Do not run
the cloud commands below for computer mode. Your private HTTPS phone connection
and device permission are still required, and the computer must remain awake.

Cloud mode can run without VAPID credentials. If you want notifications, create
**your own** stable VAPID key pair. Do not reuse the original owner's keys.
The template allows only the Android Chrome push-provider origin
`https://fcm.googleapis.com`; adding other providers requires implementation
review. Do not assume iPhone push works because home-screen installation works.

From the project folder, this command uses the already installed `web-push`
package to write a private file without printing the keys:

```sh
node --input-type=module -e "import webpush from 'web-push'; import {writeFileSync} from 'node:fs'; const keys=webpush.generateVAPIDKeys(); writeFileSync('.dev.vars.vapid.json', JSON.stringify({VAPID_PUBLIC_KEY:keys.publicKey,VAPID_PRIVATE_KEY:keys.privateKey,VAPID_SUBJECT:'mailto:you@example.com'},null,2),{mode:0o600,flag:'wx'});"
```

Open `.dev.vars.vapid.json` in your local plain-text editor and replace
`mailto:you@example.com` with your real contact email, keeping the `mailto:`
prefix. This filename is ignored by Git; never share it. `flag:'wx'` refuses to
overwrite an existing file so you do not accidentally replace keys already in
use. Back up the file in your private password manager/storage.

Upload these three secrets without displaying their contents:

```sh
npx wrangler@4.151.1 secret bulk .dev.vars.vapid.json --config wrangler.self-host.jsonc
```

The supplied cron triggers run notification dispatch and workflow recovery.
Keep `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` together; missing
all three leaves notifications unconfigured, partial configuration is an error.
Keep the key pair stable across updates; rotation requires device re-enrollment.

On your own Android phone, open your deployed site in Google Chrome, then
**Settings → Enable on this device**, allow notifications, choose a local time
and save. Choose **Test notification**, check the tray and tap it. Test scheduled
delivery separately; today's completed study may suppress that reminder.
Permission and enrollment are per device. Source completion/action alerts use
the same opt-in. Delivery is best-effort, not an exact alarm.

## Configuration reference

The template supplies the complete binding declarations; do not rename their
binding keys. Resource names and account identifiers are yours.

| Binding | Purpose |
| --- | --- |
| `ASSETS` | Built `dist/` website; supplied by Workers Static Assets. |
| `SOURCE_LIBRARY_DB` | Your migrated D1 database: sources, learning and workflow records. |
| `SOURCE_CONTENT_BUCKET` | Your private R2 bucket: uploaded files and generated media. |
| `KNOWLEDGE_WORKFLOW` | Your background `KnowledgeExtractionWorkflow`. |
| `IMAGES` | Cloudflare Images transformations; required by workflow composition even for text-first runs. |
| `YOUTUBE_QUOTA_LEDGER` | Durable Object for YouTube quota accounting. |
| `TRANSCRIPT_AUTHORIZATION_LEDGER` | Durable Object for publisher-transcript authorization. |
| `SOURCE_BROWSER` | Browser Run for hosted embedded-PDF image decoding and legacy acquisition; keep it alongside `PUBLIC_ACQUISITION`. |
| `CF_VERSION_METADATA` | Cloudflare's deployment version information. |
| `PUBLIC_ACQUISITION` | Private service binding to your acquisition gateway Worker. |

| Variables supplied by the template | Meaning |
| --- | --- |
| `ALLOWED_ORIGIN` | Your exact HTTPS app origin; no trailing slash. |
| `ACCESS_ISSUER`, `ACCESS_AUDIENCE`, `ACCESS_OWNER_EMAIL` | Your Access team issuer, application AUD and allowed owner email. |
| `ACCESS_OWNER_ID` | Stable internal ID matching `worker/seeds/self-host.sql`. Keep it after setup. |
| `TRANSCRIPT_LANGUAGES` | Comma-separated publisher-transcript languages; initially `en`. |
| `KNOWLEDGE_WORKFLOW_ENABLED` | `"true"` enables hosted knowledge workflows. |
| `KNOWLEDGE_WORKFLOW_CONFIG_DIGESTS` | Canonical digests matching the included agent YAML; keep matching a release. |
| `SOURCE_INGESTION_POLICY_VERSION` | Version label attached to ingestion records. |
| `SOURCE_MANUAL_MAX_BYTES`, `SOURCE_MANUAL_MAX_CHARACTERS` | Independent upload byte and extracted-text bounds. |
| `SOURCE_MANUAL_MEDIA_TYPES` | Legacy manual route's accepted media types; workflow parsing separately supports text/Markdown, PDF, PPTX and raster images. |
| `SOURCE_BROWSER_ACCOUNT_SCOPE`, `SOURCE_R2_ACCOUNT_SCOPE` | Internal capacity ledger namespaces in your database. R2 scope must match the seed. |
| `SOURCE_R2_STORED_BYTES_LIMIT`, `SOURCE_R2_CLASS_A_MONTHLY_LIMIT`, `SOURCE_R2_CLASS_B_MONTHLY_LIMIT` | App storage/operation bounds, not Cloudflare account-wide billing controls. |
| `SOURCE_R2_OBSERVATION_MAX_AGE_MS` | Maximum age of a bucket size observation before reconciliation. |
| `YOUTUBE_SEARCH_DAILY_LIMIT`, `YOUTUBE_GENERAL_DAILY_LIMIT` | Separate search/general quota buckets. |
| `REMINDER_PUSH_ORIGINS` | Exact allowed push-provider HTTPS origins, encoded as a JSON array string. |

The separate acquisition integration uses `PUBLIC_ACQUISITION` (Fetcher),
`PUBLIC_ACQUISITION_ENDPOINT` (HTTPS origin) and `PUBLIC_ACQUISITION_TOKEN`
(secret), plus `FIRECRAWL_API_KEY` (secret). The main template includes the service
binding and endpoint placeholder. Deploy the gateway first and configure your
own token/key using [ACQUISITION_SETUP.md](ACQUISITION_SETUP.md).

## Files and secrets

GitHub includes application/Worker/acquisition source, agent YAML, all SQL
migrations, a new-install seed, the standalone `local/` backend, portable acquisition
server and private bridge, dependency lockfiles, vendor code, assets, and
setup/configuration examples. It does not include anyone's credentials, private
learning records, provisioned cloud resources, development-only skills, or
compiled `dist/`. `npm ci` and `deno task build` recreate dependencies/builds.
Cloud mode provisions remote resources under your account; computer mode
automatically initializes its own SQLite database and filesystem storage.

The template is tracked; your `wrangler.self-host.jsonc` is ignored. `.env*`,
`.dev.vars*`, `.private/` and `.wrangler/` are ignored too. Keep backups outside
public repositories. Do not force-add secrets or dump files to Git, or copy them
into `assets/`/`dist/`. A leaked key must be revoked at its provider, even if you
later delete the file from GitHub.
