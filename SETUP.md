# Setup and everyday use

## Choose how to use Resonance

| Option | Advantages | Tradeoffs | Guide |
| --- | --- | --- | --- |
| Full backend on your computer | No Cloudflare account/provisioning; database and files stay on your computer; uses your own API keys. | Computer must stay awake with server running; phone needs private Tailscale HTTPS; you manage backups. AI still needs internet and provider credits. | [Computer setup](COMPUTER_SETUP.md) |
| Your own Cloudflare deployment | App, files and learning records stay available when your computer is off; Access email login; scheduled cloud jobs. | More account/billing/configuration steps; cloud storage/compute can cost money. Public website extraction also needs your acquisition computer/server running, or your own always-on host. | [Cloudflare setup](SELF_HOSTING.md) and [acquisition setup](ACQUISITION_SETUP.md) |
| Sample demo | No API keys/charges; quickly try the screens. | Sample browser-local data only; no full processing backend or phone synchronization. | [Run the demo](#run-the-local-demo) |

Both full options process permitted sources into knowledge and quizzes using
[your own API services](SERVICES.md). Neither needs the maintainer's keys,
Cloudflare membership, private files or credits. Cloudflare mode uses the
included `wrangler.self-host.example.jsonc`; personal deployment configurations
are excluded from Git. Phone installation is a window onto your backend, not a server
running on the phone. YouTube search is metadata-only; automatic podcast
transcription is not included.

## Install on your devices

First finish [computer setup](COMPUTER_SETUP.md#5-use-the-same-backend-on-your-phone)
or [Cloudflare setup](SELF_HOSTING.md). Open **your own HTTPS URL** on both
devices. Computer mode uses your local app password; Cloudflare mode uses the
email allowed by your Access policy. Installation is optional. Use the same URL
and owner login to share server data. Cloudflare dashboard login is separate
from application login. A GitHub/Cloudflare account does not grant access to
someone else's private deployment.

### Desktop

In Chrome on Windows, macOS or Linux, open your signed-in site, then use the
address-bar install icon or **Menu → Cast, save, and share → Install page as app**.
Confirm and open Resonance from your app launcher. If installation is unavailable,
bookmark the site instead. Menu wording varies by browser/version.
[Chrome's official guide](https://support.google.com/chrome/answer/9658361?hl=en&co=GENIE.Platform%3DDesktop).

### Android

1. Open your deployed HTTPS URL in Chrome and sign in, outside an embedded messaging browser.
2. Choose **Menu → Install and create shortcut → Install**. Some versions show
   **Install app** or **Add to Home screen**.
3. Launch the Resonance icon; sign in again if that app context asks you to.
4. Open **Settings** to choose appearance, motion and sound.

No APK or Play Store package is required: this is the approved home-screen web
app. [Chrome's Android guide](https://support.google.com/chrome/answer/9658361?hl=en&co=GENIE.Platform%3DAndroid).

### iPhone and iPad

Open your deployed HTTPS URL in Safari, sign in, then choose **Share → Add to Home Screen**.
Enable **Open as Web App** if offered, then tap **Add**. Launch the new icon;
its login/storage context may differ from the Safari tab.
[Apple's guide](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios).
These are platform instructions; physical iPhone/iPad installation and push
delivery have not been acceptance-tested for this release.

### Turn a source into learning cards

1. In **Discover**, find a source and choose **Add to Library**. For a private
   file, use **Library → Upload a private document** and confirm your permission
   to process it.
2. Choose **Extract knowledge points** when offered. The app opens the matching
   source card in **Library**.
3. While processing, that card refreshes every minute. It shows the current
   page/link and section when available, extracted knowledge, and the number of
   generated quiz questions. Leave Library open to watch updates; processing
   runs on the server even if you close the browser.
4. To stop, choose **Cancel processing** and confirm. This removes knowledge
   points, quizzes and associated images produced by that processing run.
5. Once ready, study a five-card batch in **Feed**, choose **Mark batch studied**,
   and answer its paired questions in **Review**. At least five eligible
   knowledge-and-quiz pairs are needed for a batch.

Multiple-choice and exact text answers use the saved answer key. Other text
answers pass when the configured decision model (Jev by default) gives them at least 70% probability of
being correct. Choice and fill-blank variants appear as separate Review questions;
all blanks in a fill-blank question must pass for full credit.
If the grading service is unavailable, the answer stays pending; try again later.
**See more often** moves a knowledge point to a shorter recall interval;
**See less often** moves it to a longer one and informs future extraction.

### Processing and review controls

Accepted knowledge appears in Library while the source continues processing.
Expand a source to read its knowledge; long lists have an internal scroll area.
A failed processing item can be dismissed without deleting the source. Use
**Retry processing** when offered; transient failures can also recover
from saved checkpoints automatically. Billing or permission failures still need
your action. **Cancel processing** removes that run's generated content.

PDF and PowerPoint uploads automatically extract embedded raster images for
vision-model matching, including when their text is processed normally.
**Read PDF pages as images** additionally reads complete PDF pages. A selected
PDF text excerpt does not authorize extracting images from elsewhere in the
original document. These operations use your configured model services.

In Review, **Skip** records no answer or scheduling result. Its **Replace quiz**
countdown lets you continue without treating a skip as a wrong answer. When
all questions are handled, a **Next batch** countdown loads another batch;
you can also use **Refresh batch** early. A refresh clears unsent input while
preserving saved attempts. Text-answer feedback includes canonical answers and
per-blank results; question images stay associated with their source.

Feed also offers browser speech synthesis for reading a card. Voice support
comes from your browser/device and is separate from uploaded-audio transcription.
Five-card batches, refresh delays and model acceptance scores are product choices.
Progress reports activity and answer outcomes; it does not prove mastery or transfer.

### Login and data

Computer mode uses your password and signs browsers out when the server restarts.
Cloudflare mode uses its Access login; admin login is separate. Do not share
passwords/codes. New devices, cleared cookies, sign-out or session expiry can
require signing in again.

Server sources, knowledge and review records belong to the authenticated server
account. Appearance and reminder enrollment are browser/device-specific.
Local-demo IndexedDB records are separate: **Library → Export** exports local
data, not a complete backup of your hosted account. Clearing browser data can erase local
study/settings and notification enrollment. **Erase local data** does not erase
server records; do not use it as an update troubleshooting shortcut.

### Notifications

Reminders are configured for Android Chrome. Installing the app does not schedule notifications.
Choose **Settings → Enable on this device**,
select a local time, allow notifications and save. **Skip today** suppresses one
day; completed study/review can suppress a reminder too. Choose **Test notification**
and check your notification tray, then tap the notification to open the app.
To test delivery while closed, save a time a few minutes ahead and return to your
home screen without force-stopping Chrome. If you already completed today's
learning, the scheduled reminder is suppressed. Restore your preferred time after
the check. No reinstall is needed; reopen the app online if Settings looks stale.
Check site/browser and OS permissions if notifications stop. Revisit settings
after a timezone change. Computer-hosted reminders need the computer awake and running.
Delivery is best-effort, not an exact alarm; physical
Android test-push delivery has been confirmed; scheduled and source-event delivery
still need your device check. iOS delivery remains unverified.

The same device opt-in also sends one alert when a source's knowledge and quizzes
are ready, or when permission, an upload or a processing retry needs your action.
There is no separate scraping-complete alert. Source alerts open Library and
omit source titles from the lock screen. **Skip today** affects only daily
reminders; disabling notifications turns off both kinds. Existing completed
sources do not receive backfilled alerts.

### Updates and offline use

Reload/reopen online after a release. The service worker caches the app shell,
not a full offline hosted service: search, extraction, grading, synchronization
and push need connectivity. Local fixture study is separate. If an app looks
stale, close other Resonance tabs and reopen online before considering any cache
reset. Installation does not bypass Cloudflare Access.

## Run the local demo

This is a sample version for learning how the screens work. It does not provide
the hosted search, extraction, image processing, AI grading or notifications.
Its records stay in the browser on that computer and do not sync to your phone.
Use [computer setup](COMPUTER_SETUP.md) or [Cloudflare setup](SELF_HOSTING.md)
for those features. No API keys
are needed for the demo.

### 1. Install the tools once

- Install **Node.js 24 LTS or newer** from [nodejs.org](https://nodejs.org/en/download).
  Keep the installer's default options; it includes `npm`.
- Install **Deno 2** using the instructions for your operating system at
  [deno.com](https://docs.deno.com/runtime/getting_started/installation/).
- Install **Python 3** from [python.org](https://www.python.org/downloads/).
  On Windows, enable the installer's **Add Python to PATH** option if offered.

Close and reopen your terminal after installation. On Windows, open
**PowerShell** from Start; on macOS, open **Terminal** from Applications →
Utilities; on Linux, open your terminal application.

### 2. Download the project

Open the [GitHub project](https://github.com/leonidasiy/Personal-Knowledge-Platform),
choose **Code → Download ZIP**, then extract the ZIP to a folder you can find.
Open that extracted folder: it should contain `SETUP.md`, `deno.json` and
`package.json` directly, rather than another ZIP or outer folder.

In your terminal, type `cd ` (with a space), then the full folder path in quotes,
and press Enter. For example, replace the path below with your own:

```sh
cd "/path/to/Personal-Knowledge-Platform-main"
```

On Windows a path might be `"C:\Users\YourName\Downloads\Personal-Knowledge-Platform-main"`.
On macOS it might be `"/Users/YourName/Downloads/Personal-Knowledge-Platform-main"`.

### 3. Build and open it

Copy these commands into that terminal **one at a time**, pressing Enter and
waiting for each to finish:

```sh
npm ci
deno task build
deno task serve
```

The first two commands download dependencies and build the app. The last stays
running: leave that terminal open, then open
[http://localhost:4173](http://localhost:4173) in your browser.
If Windows says `python3` was not found, use this instead of `deno task serve`:

```sh
python -m http.server 4173 --directory dist
```

To stop the demo, return to the terminal and press **Ctrl+C**. To start it another
day, open a terminal in the same folder and run `deno task serve` again (or the
Windows command above). You only need to rebuild after changing/updating files.

### Common setup problems

| What you see | What to do |
| --- | --- |
| `npm`, `deno` or Python not found | Install the matching tool, then reopen your terminal. |
| `package.json` or `deno.json` not found | Use `cd` to enter the extracted project folder. |
| Build/download failure | Check your internet connection; keep the error message if you need help. Do not continue to the server step until the build succeeds. |
| Port 4173 already in use | Stop an earlier demo terminal with Ctrl+C. |
| The demo has no source processing | This is expected in the sample demo. Follow one of the two full backend guides above. |

To use Resonance on your phone with synchronized learning records, finish
[computer setup](COMPUTER_SETUP.md) or [Cloudflare setup](SELF_HOSTING.md),
open **your HTTPS URL**, then
follow the [device installation steps](#install-on-your-devices). `localhost` on
a phone points to the phone itself. A computer's local demo is not a full online
service and does not synchronize its sample records to your hosted account.

To replace the default AI models or API, see [Switching model APIs](MODEL_APIS.md).
See [Dependency security assessment](DEPENDENCY_SECURITY.md) for known dependency alerts.
