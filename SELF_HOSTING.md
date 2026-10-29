# Set up your own Resonance service

This guide creates a separate copy in **your Cloudflare account**, using **your
API keys**, accessible from your computer and phone. You need a computer for
setup; your phone uses the finished HTTPS website. Installing the app icon does
not run its server on your phone. Learning and uploaded-file processing run in
the cloud. Website extraction also needs your acquisition computer/server on;
use your own always-on host if you want that available around the clock.

Do not use the original owner's website, account, database, bucket, credentials
or `wrangler.jsonc`. Every Wrangler command below explicitly selects
`wrangler.self-host.jsonc`. That separate file is ignored by Git.

## What this installs

Private uploads, AI-generated knowledge and quizzes, Feed, Review, Progress,
synchronized records, website extraction, and optional search/Android reminders.
The included acquisition server and private bridge complete the web pipeline;
set those up in step 5 before deploying the main app. All keys and cloud
resources belong to you. Start with a short document you wrote yourself.

Prefer no Cloudflare provisioning? [Computer setup](COMPUTER_SETUP.md) runs the
full backend locally and connects your phone through private HTTPS. Compare
[the advantages and tradeoffs](SETUP.md#choose-how-to-use-resonance).
There is no native Android/iOS package.

## 1. Prepare tools, files and accounts

Complete [SETUP.md: install and download](SETUP.md#run-the-local-demo), through
opening a terminal in the project folder. Install Node.js 24 LTS or newer and Deno 2; Python
3 is only needed for the separate demo. A terminal is the application where you paste the commands below. Run one
line at a time and wait for it to finish. Do not paste Markdown's backtick fences.

Create accounts that **you control**:

- [Cloudflare](https://dash.cloudflare.com/sign-up), for hosting, D1 (database),
  private R2 (files), Workflows (background processing), Images (transformations),
  Durable Objects (coordination) and Zero Trust Access (login).
- [OpenRouter](https://openrouter.ai/), for extraction, quiz generation/review,
  vision and semantic answer grading. A ChatGPT/Claude subscription is not an
  API key for this app. Other compatible APIs/models can be configured using
  [Switching model APIs](MODEL_APIS.md); native incompatible protocols need a gateway.
- Optional discovery accounts and notification setup are described in
  [SERVICES.md](SERVICES.md). Leave them until the basic workflow works.

Read each provider's current pricing before activation. Free allowances have
limits; R2 activation may request billing details. This guide does not promise
free operation. Set an OpenRouter key credit limit and provider budget alerts.
The application is **not** a universal monthly spending cap. Cloudflare alerts
are not guaranteed hard stops. See [cost and service reference](SERVICES.md#costs-and-isolation).

In the project terminal:

```sh
npm ci
node --version
deno --version
npx wrangler@4.151.1 login
npx wrangler@4.151.1 whoami
```

`npm ci` installs the versions recorded in `package-lock.json`. Wrangler is the
Cloudflare command-line tool; `npx` downloads the specified version when needed.
Login opens a browser: approve **your own** Cloudflare account. `whoami` lists
accounts available to that login. Copy your intended **Account ID**, not the
original owner's ID. If the wrong account is shown, run
`npx wrangler@4.151.1 logout`, then log in again. Run setup on your own computer,
not someone else's already authenticated workspace.

## 2. Make your configuration file

In Finder/File Explorer, duplicate `wrangler.self-host.example.jsonc` in the
project root. Rename the duplicate **`wrangler.self-host.jsonc`**. Enable file
extensions so it does not become `.jsonc.txt`. Open it in a plain-text/code
editor. Do not use Word or rich text. Keep the example unchanged for reference.

A configuration file contains settings in double quotes. Change the values,
leaving the property names, commas and braces intact:

| Setting | Your value |
| --- | --- |
| `account_id` | Account ID from `whoami`. |
| `name` | `my-resonance`, or your chosen Worker name. |
| `d1_databases[0].database_name` | `my-resonance-library`. |
| `r2_buckets[0].bucket_name` | `my-resonance-content`. |
| `workflows[0].name` | `my-resonance-extraction`. |
| `vars.ALLOWED_ORIGIN` | Your exact HTTPS site origin, with no trailing slash; see below. |
| `vars.ACCESS_OWNER_EMAIL` | The email you will use to sign in. |

Leave `ACCESS_OWNER_ID` as `self-host-owner-v1` and the two `*_ACCOUNT_SCOPE`
values as supplied. They are identifiers within your separate database, not
credentials or references to the original account. The included seed uses them.
Do not change the owner ID after you have created learning records.

Find your account's `workers.dev` subdomain on Cloudflare's **Workers & Pages**
page; create/select one if prompted. If it is `alex-learning`, your origin for
Worker name `my-resonance` is `https://my-resonance.alex-learning.workers.dev`.
Replace `YOUR_SUBDOMAIN` accordingly. This is the address both devices will use.
[Cloudflare's URL guide](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

Leave the D1 ID and Access placeholders until the following steps. Do not deploy
until you have replaced **every** `REPLACE_WITH_...`, `YOUR_SUBDOMAIN`,
`YOUR_TEAM`, `YOUR_ACQUISITION_HOST` and `you@example.com` value. The template includes all the runtime
bindings, scheduled jobs and agent configuration digests; keep those sections.

## 3. Create your database and private file bucket

These commands create resources in the account selected by your new config.
If you changed a resource name above, replace that name in the commands too.

```sh
npx wrangler@4.151.1 d1 create my-resonance-library --config wrangler.self-host.jsonc
npx wrangler@4.151.1 r2 bucket create my-resonance-content --config wrangler.self-host.jsonc
```

The first command prints a `database_id`. Copy **that new ID** into
`d1_databases[0].database_id`, replacing its placeholder. Do not append a second
D1 binding if Wrangler offers to edit the file; the binding already exists and
must remain named `SOURCE_LIBRARY_DB`. Check the file after any automatic edit.

If R2 asks you to activate the service, do that in your own dashboard after
reviewing its terms, then retry. Keep the bucket **private**: do not enable its
public development URL or add a public custom domain.

Apply the included database tables, then initialize the empty installation:

```sh
npx wrangler@4.151.1 d1 migrations apply my-resonance-library --remote --config wrangler.self-host.jsonc
npx wrangler@4.151.1 d1 execute my-resonance-library --remote --config wrangler.self-host.jsonc --file worker/seeds/self-host.sql
```

`--remote` means your cloud database, not a local copy. Check the displayed
account/resource before accepting prompts. Run the seed only for a **new empty
bucket/database**. It adds the initial Music interest area and initializes its
storage ledger. It does not include the original owner's sources or records.
Future uploads may contain other subjects; this initial interest is not a subject
limit. Later deployments apply pending migrations without reinitializing data.
The app refreshes stale bucket size observations through private bucket listing;
do not reset usage counters to work around a quota error.

[Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
and [R2 commands](https://developers.cloudflare.com/r2/reference/wrangler-commands/).

## 4. Configure your private sign-in

Use Cloudflare **Zero Trust → Access → Applications** (navigation names may
vary). Create your own Zero Trust team if this is your first application.

1. Enable **One-time PIN** as a login method, unless you deliberately use another
   supported identity provider. This sends a login code to your email.
2. Add a **Self-hosted** Access application for your exact planned
   `my-resonance.YOUR_SUBDOMAIN.workers.dev` hostname. Cover the **whole site**,
   including `/api/*`; do not restrict it to a single page/path.
3. Create an **Allow** policy with **Emails → your exact email address**. Do not
   choose Everyone or a Bypass policy. Other allowed emails do not become separate
   learners: this application maps one configured email to one owner.
4. Copy the application's **Application Audience (AUD) Tag** into
   `vars.ACCESS_AUDIENCE` in your config.
5. Copy your team issuer, such as `https://alex-learning.cloudflareaccess.com`,
   into `vars.ACCESS_ISSUER`. This is your Zero Trust team domain, not the app URL.

[Cloudflare Access application setup](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)
and [where to find issuer/AUD values](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).
After deployment, also verify production `workers.dev` Access protection in
step 6. The app verifies the Access token itself; removing authentication is not
an alternative setup path.

## 5. Configure acquisition and save your own secrets

Complete [ACQUISITION_SETUP.md](ACQUISITION_SETUP.md) now. It starts your
acquisition server, exposes it through authenticated HTTPS, deploys your private
`my-learning-acquisition` bridge, and configures its matching endpoint/token in
this app. Return here afterward. The supplied main template references that
bridge, so it must exist before main deployment.

Store your own `FIRECRAWL_API_KEY` as described there for website browsing.

These steps use the default OpenRouter setup. For another provider, use
[Switching model APIs](MODEL_APIS.md) for the replacement secrets/settings and
role digests instead of the OpenRouter key below.

On [OpenRouter's key page](https://openrouter.ai/settings/keys), create a dedicated
key for this app, set its credit limit, and ensure your account can use the
[models the app requires](SERVICES.md#ai-and-grading). Copy it when shown.

```sh
npx wrangler@4.151.1 secret put OPENROUTER_API_KEY --config wrangler.self-host.jsonc
```

At Wrangler's hidden input prompt, paste the key and press Enter. It may offer
to create the named Worker before uploading its first secret; verify that it is
**your Worker in your account**, then accept. Do not paste keys into commands,
chat, GitHub, app Settings, agent YAML or the configuration file. Local `.env`
files do not upload secrets to Cloudflare.

Generate a separate random secret for Library page cursors. This is not an API
key and costs nothing. Use a password manager to generate at least **32 random
characters**, save it privately, then paste it at this command's hidden prompt:

```sh
npx wrangler@4.151.1 secret put SOURCE_CURSOR_SECRET --config wrangler.self-host.jsonc
```

To check **names**, without revealing values:

```sh
npx wrangler@4.151.1 secret list --config wrangler.self-host.jsonc
```

These names must appear alongside your acquisition token and Firecrawl key.
Optional provider keys are added with the same pattern;
see [SERVICES.md](SERVICES.md). Do not copy the original owner's secrets.

## 6. Build and deploy your copy

```sh
deno task build
npx wrangler@4.151.1 deploy --dry-run --config wrangler.self-host.jsonc
npx wrangler@4.151.1 deploy --config wrangler.self-host.jsonc
```

Stop on any error. The build creates `dist/` from GitHub's sources, vendored
code, fonts and images. The first build downloads pinned minifiers with `npx`.
A dry run validates bundling without publishing; it does not test API credentials
or provision every service. A real deployment creates the configured Workflow
and Durable Objects and uploads the app into **your** Cloudflare account.
The `SOURCE_BROWSER` binding and built `pdfjs.mjs` asset also support decoding
embedded PDF images outside the Worker's CPU budget. Keep the browser binding
from the example even when website browsing uses Firecrawl. These sessions use
your account's Browser Run capacity; launch, decode and transfer timeout errors
are reported separately. Uploaded image manifests and original pixels stay in
private storage, with digest validation when pixels are read.

For an existing installation, apply the pending migrations using this guide's
migration command before deploying code that requires them. The chain currently
includes `0031_quiz_acceptance_seven.sql` (quiz score policy, preserving existing
rows) and `0032_workflow_media_lookup_index.sql` (media lookup index). Do not
reset the database or run the separate historical classification backfill.

Enable Images transformations in your account if Cloudflare requests activation.
Review the [Images service requirements](https://developers.cloudflare.com/images/optimization/binding/).

The terminal prints your HTTPS URL. It must match `ALLOWED_ORIGIN`; correct the
config and deploy again if needed. In **Workers & Pages → your Worker → Settings
→ Domains & Routes**, enable/verify **Cloudflare Access** for the production
`workers.dev` address. Ensure the resulting Access application uses your email
policy and its AUD matches the config. A preview-only Access setting does not
protect the production URL. Preview URLs are disabled in the template.

Open the URL in a private/incognito window. You should see the Access sign-in
page before accessing the app. Sign in as your configured email. If it is public,
finish Access protection before uploading personal material. If the app shell
opens but APIs fail, check the issuer, AUD and owner email rather than disabling
token checks.

## 7. Verify your first learning session

1. Open **Library → Upload a private document**. Paste a short original lesson
   containing several useful facts. Confirm permission for storage and external
   AI processing, then choose **Upload and process**. This uses your API credits.
2. Wait for completion in Library; the source card updates periodically. If it
   fails, keep its named error and use the troubleshooting table below.
3. When at least five eligible knowledge-and-quiz pairs are published, open
   **Feed**, study a batch and choose **Mark batch studied**. Very short content
   may produce fewer than five points; add another useful original lesson.
4. Open **Review**, answer and choose **Check answer**. Refresh can replace an
   unfinished batch; recorded answers remain saved, unsent answers are cleared.
5. Open **Progress**, then sign in at the **same URL and email** on your phone.
   Hosted learning records should match. Theme and notification choices can
   differ by browser/device.
6. Check usage in **your** Cloudflare and OpenRouter dashboards. Your app calls
   its own same-origin `/api/*` routes; there is no original-owner service proxy.

Install on [desktop, Android or iPhone/iPad](SETUP.md#install-on-your-devices)
after this test. The hosted app remains available without a computer terminal;
keep the acquisition server/tunnel running when processing website links.

## Automatic website extraction

[ACQUISITION_SETUP.md](ACQUISITION_SETUP.md) covers the complete included server
and private Cloudflare bridge. Your server handles robots checks and permitted
media; your own Firecrawl Browser Sandbox handles workflow page browsing. No
local Chrome is needed for those operations. The separate `SOURCE_BROWSER`
binding also decodes embedded PDF images; it does not replace acquisition.
Rights, authentication, public network and robots checks still apply.

Closing a temporary tunnel or sleeping its computer interrupts website
acquisition. Already-published Feed/Review/Progress and private-file uploads
continue in Cloudflare. For continuous website processing use your own stable
HTTPS server/tunnel and keep its process running. Changing a tunnel URL requires
updating both bridge and app configurations as the acquisition guide explains.

YouTube discovery remains metadata-only; it does not download videos/captions.
Podcast discovery does not automatically transcribe episodes. The local ASR
companion is not a packaged end-user daemon. Upload your own permitted text or
files when those paths are unavailable.

## Updates, backups and stopping costs

Keep `wrangler.self-host.jsonc`, your stable owner ID, API credentials and your
own backups privately. Keep the example, source and migrations under version
control. Do not copy files from an old download over your personal configuration.
If you forked the repository, use GitHub's **Sync fork**; otherwise download the
updated ZIP into a new folder and copy your private config into it.

Before an update, back up the database using a private output path:

```sh
npx wrangler@4.151.1 d1 export my-resonance-library --remote --config wrangler.self-host.jsonc --output .dev.vars.database-backup.sql
```

That filename is ignored by Git. Move a dated copy into your private backup
storage. Also back up your private R2 objects using your own bucket's dashboard
or R2 tools; a database export alone does not contain uploaded files or images.
The app's Library export is not a full server backup. Restoring D1 and R2 must
preserve their matching object keys. Never publish backups or upload them in an
issue report.

In the updated project folder, run `npm ci`, `deno task build`, the migration
**apply** command from step 3, then the dry run and deploy commands from step 6.
Do not run the seed again or delete/recreate the database. If you changed agent
YAML, its canonical configuration digests must also be updated; copying the
matching template's digest setting is sufficient for an unmodified release.
For replacement models/APIs, follow [model API configuration](MODEL_APIS.md),
including the command that prints your updated canonical digests.
Do not overwrite your own account/Access/database settings with the example.

Closing the installed app does not stop background processing, scheduled jobs
or storage charges. To retire your copy, first export/back up anything you want
to keep, stop its Workflow instances and cron triggers, then remove the Worker
and unused D1/R2 resources in **your** account and revoke its API keys. Deletion
permanently removes the affected records/files; review each resource name.

## Troubleshooting

| Problem | Check |
| --- | --- |
| Command/tool not found | Install the matching prerequisite, reopen the terminal, and return to the project folder. |
| PowerShell blocks `npm.ps1`/`npx.ps1` | Use `npm.cmd`/`npx.cmd` for those commands, or use Command Prompt. No system-wide policy change is required. |
| Account/resource not found | Check `whoami`, `account_id`, your resource names and `--config wrangler.self-host.jsonc`. Never retry with the original owner's config. |
| R2/Images/Browser/Workflows activation error | Open that service in your own Cloudflare dashboard; review plan/terms and enable it if you accept them. A local dry run cannot verify activation. |
| `DiscoveryDeploymentConfigurationMissing`/`Invalid` | The error's field identifies the missing/invalid variable or secret. Check placeholders, origin, bindings, cursor secret and the full template. |
| Sign-in denied or code missing | Check your Access email policy and One-time PIN method; inspect spam. The policy email must match `ACCESS_OWNER_EMAIL`. |
| API says unauthorized after sign-in | Issuer, AUD and email must belong to the same Access application/account. Protect production, not only preview URLs. |
| No knowledge appears | Check source processing status, OpenRouter credits/model access and named error. Wait for publication; do not mark a sample demo batch as hosted content. |
| No Feed batch | At least five published eligible knowledge-and-quiz pairs are needed. |
| Website extraction fails on robots/acquisition | Check your acquisition process/tunnel, matching HTTPS origins, private service binding, token and Firecrawl key. See ACQUISITION_SETUP.md; do not bypass robots/rights checks. |
| Search provider unavailable | Configure your optional provider's own secret(s); no search key is required for direct uploads. |
| Storage quota or uncertain capacity error | Inspect your actual bucket usage and ledger state; do not reset the ledger or claim a used bucket is empty. |
| Phone does not match computer | Open your exact deployed HTTPS URL with the same configured email. `localhost` and the original owner's site are different installations. |
| Notifications unavailable | They require optional VAPID setup and device permission; see SERVICES.md. Learning works without them. |

For help, share the failed step, tool versions and named error with keys, account
identifiers and private content removed. Never share `.env*`, `.dev.vars*`,
browser login state, uploaded material or database dumps.
