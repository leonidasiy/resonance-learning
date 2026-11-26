# Website acquisition for your own Cloudflare deployment

This guide completes [Cloudflare setup, step 5](SELF_HOSTING.md#5-configure-acquisition-and-save-your-own-secrets).
**Computer backend users do not need these steps**: acquisition is already
bundled in [computer mode](COMPUTER_SETUP.md).

Your acquisition process checks robots policies and fetches permitted media.
Your own Firecrawl Browser Sandbox handles website browsing. The included
private Worker bridge connects your cloud app to that process. Nothing connects
to the maintainer's server or uses their keys. Website access restrictions still
apply; an API account does not grant permission to process private material.

## 1. Prepare your acquisition computer

Use your own Windows, macOS or Linux computer with **Node.js 24 LTS or newer**
and the downloaded project. In its project folder run `npm ci` if you have not
already. Keep this computer awake during website processing. No local Chrome
installation is required for robots/resource/media operations; Firecrawl does
the page browsing. This launcher does not enable unsupported browser isolation
or bypass the network policy.

Copy `acquisition.env.example` to **`.env.acquisition`**:

```sh
cp acquisition.env.example .env.acquisition
```

Use `copy acquisition.env.example .env.acquisition` in Windows Command Prompt.
Open the copy in a plain-text editor; avoid an extra `.txt` extension. Create a
unique token of at least **32 random characters** in a password manager, paste it
after `ACQUISITION_TOKEN=`, and save. Keep it private. Leave port `8788` and
`ACQUISITION_TRANSPORT=loopback` unchanged. The copied file is ignored by Git.

Start the server:

```sh
deno task acquisition:serve
```

It should report loopback port 8788. Leave this terminal running. Stop with
**Ctrl+C**. It accepts only authenticated operation requests, not a browsable
home page; a blank/denied result at its root is not a health check failure.

## 2. Give it an HTTPS address

The cloud app cannot reach your computer's `localhost`. An HTTPS tunnel can
connect it without a router port or an unencrypted public listener.

For an initial working setup, install **cloudflared** from
[Cloudflare's official downloads](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/).
Open a second terminal and run:

```sh
cloudflared tunnel --url http://127.0.0.1:8788
```

Copy the printed HTTPS address, such as `https://random-name.trycloudflare.com`.
This Quick Tunnel requires no login and does not use the maintainer's account.
It is public, but the acquisition server requires your private bearer token.
Do not expose any other local application through it. Leave both terminals open.
Do not add an Access email-login page to this endpoint: requests come from the
private bridge using the server token, not an interactive browser session.

[Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
are for testing/development, have service limits and change address on restart.
They provide the shortest first-run path, not an always-on production guarantee.
For regular use choose one of these with **your own** resources:

| Option | Advantage | What you manage |
| --- | --- | --- |
| Named Cloudflare Tunnel on your computer | Stable HTTPS hostname; no public listener/router port. | Your Cloudflare account/domain, tunnel service, awake computer and acquisition process. Follow [published application setup](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/), pointing only to `http://127.0.0.1:8788`. |
| Your own always-on server with tunnel/reverse proxy | Website processing stays available while your personal computer is off. | Hosting bill, patching, process restart, private token and trusted HTTPS hostname. Use the same Node launcher and loopback target. |
| Direct TLS on your own server | No tunnel dependency. | Public DNS, trusted renewable certificate, firewall and process supervision. See [direct TLS](#direct-tls-and-process-supervision). |

The cloud app, uploads, published cards and review stay available if acquisition
is off; new website processing can fail or need retry until it is restored.

## 3. Deploy your private bridge

Back in your main project folder, duplicate
`wrangler.acquisition.example.jsonc` as **`wrangler.acquisition.jsonc`**. Edit:

- `account_id`: your Account ID from `npx wrangler@4.151.1 whoami`.
- `name`: keep `my-learning-acquisition`, or consistently use your own name.
- `vars.ACQUISITION_ORIGIN`: the exact HTTPS origin from step 2, **without a
  trailing slash**, path, password or query string.

Leave `workers_dev` and `preview_urls` **false**. The gateway is a private
service binding, not a public Worker site. It forwards only the expected
acquisition operation paths to that exact origin; it does not forward app
cookies or provide a general proxy.

```sh
npx wrangler@4.151.1 deploy --dry-run --config wrangler.acquisition.jsonc
npx wrangler@4.151.1 deploy --config wrangler.acquisition.jsonc
```

Verify that the account/name shown are yours. No secrets are stored in this
bridge config. Its destination server authenticates the token from the main app.

## 4. Connect your main app and Firecrawl

In your private `wrangler.self-host.jsonc` from the main setup:

1. Set `services[0].service` to the deployed bridge's name
   (`my-learning-acquisition`). Keep its binding named **`PUBLIC_ACQUISITION`**.
2. Set `vars.PUBLIC_ACQUISITION_ENDPOINT` to the **same exact HTTPS origin** as
   `ACQUISITION_ORIGIN` in the bridge. It is the tunnel/server origin, not the
   main app URL. A URL setting alone does not create the service binding.
3. Save the matching token with the command below. At its hidden prompt paste
   the exact token from `.env.acquisition`, then press Enter.

```sh
npx wrangler@4.151.1 secret put PUBLIC_ACQUISITION_TOKEN --config wrangler.self-host.jsonc
```

Create your own [Firecrawl account/key](https://www.firecrawl.dev/), check its
[Browser Sandbox API access](https://docs.firecrawl.dev/features/browser) and
pricing, then save that key at the hidden prompt:

```sh
npx wrangler@4.151.1 secret put FIRECRAWL_API_KEY --config wrangler.self-host.jsonc
```

This uses Firecrawl's HTTP API, not the Firecrawl CLI or MCP integration. It is
separate from your OpenRouter key. No key goes into the website's Settings or
browser bundle. Return to [main setup, step 5](SELF_HOSTING.md#5-configure-acquisition-and-save-your-own-secrets)
to save OpenRouter/cursor secrets, then build/deploy the main app.

## 5. Verify and maintain it

After main deployment, test a short public source whose license/permission
allows processing. Use **Discover → Add to Library** or the Library URL workflow.
Observe the named status in Library. This consumes **your** provider credits.
A robots/rights/upload requirement is an intentional restriction; do not bypass
it to make the test pass. Start with your own file upload if the chosen site is
unavailable. Confirm publication, Feed, Review and Progress as in the main guide.

When a temporary tunnel restarts and its address changes:

1. Update `ACQUISITION_ORIGIN` in your private bridge config and
   `PUBLIC_ACQUISITION_ENDPOINT` in your private main config to the new origin.
2. Redeploy the bridge with `--config wrangler.acquisition.jsonc`.
3. Redeploy the main app with `--config wrangler.self-host.jsonc`.
4. Retry the affected source through its offered recovery control. Do not
   repeatedly create new runs when the existing one is still processing.

After changing a token, stop/edit/restart the acquisition server and update
`PUBLIC_ACQUISITION_TOKEN` with the secret command. Never rotate it by changing
only one side. Keep private configs and tokens in private backup storage.
Restart this launcher/tunnel after a computer restart. Stop both terminals with
Ctrl+C when you no longer need acquisition; cloud storage/jobs still exist.

For a supervised Quick Tunnel, `scripts/acquisition-tunnel.mjs` starts cloudflared,
checks authenticated connectivity and publishes each new destination to your
private bridge. Run it under your operating system's service manager alongside
the acquisition server, with automatic restart and the same `.env.acquisition`.
Its arguments are the installed cloudflared executable, Wrangler's JavaScript
CLI file, and your private bridge configuration path. It uses your existing
Cloudflare login; an expired login or failed bridge deployment needs attention.
Set `vars.ACQUISITION_CLIENT_ORIGIN` in that bridge config to the **current** main
app's `PUBLIC_ACQUISITION_ENDPOINT` first. This preserves existing workflow
routing while `ACQUISITION_ORIGIN` changes, so reconnection needs only a bridge
deployment. Keep this routing identity fixed. For a new setup you can use
`https://acquisition.internal` on both sides; it is a service-binding identity,
not a public DNS destination. The authenticated acquisition service still needs
an awake, online host, and Quick Tunnels still have no uptime guarantee.

During an acquisition outage, background recovery checks connectivity without
fetching a source or starting AI work. It waits without spending workflow
resume attempts and resumes interrupted sources when connectivity returns.

| Symptom | Check |
| --- | --- |
| Tool not found | Install Node/Deno/cloudflared, reopen the terminal; run commands from the project folder. |
| ConfigurationInvalid | Token must be private, nonempty, 32+ characters without whitespace; use either token or token-file mode. Check port/transport settings. |
| AuthenticationRequired | Main `PUBLIC_ACQUISITION_TOKEN` must match the server's token exactly. |
| ConnectFailed or acquisition unavailable | Both processes must be running; check the tunnel URL, matching origins, bridge name/binding and no interactive login on the endpoint. |
| Browser credential/model error | Check your own Firecrawl/OpenRouter keys, credits and model/API access. |
| BrowserIsolationUnavailable | Normal workflow page browsing uses Firecrawl. Do not enable local Chrome page capture without its supported isolation requirements. |
| A public source is denied | Read its named rights/robots/network failure. Supply permitted material; do not disable the checks. |

### Direct TLS and process supervision

The launcher also supports trusted TLS without a tunnel. In `.env.acquisition`,
set `ACQUISITION_TRANSPORT=tls` and uncomment/fill
`ACQUISITION_TLS_KEY_FILE`, `ACQUISITION_TLS_CERT_FILE` with absolute paths to
your private key and full certificate chain. Set `ACQUISITION_HOST=0.0.0.0` only
on your own secured server. Use a publicly trusted certificate for the hostname
configured on both Workers; a self-signed certificate is not a working substitute.
The key/token files must be readable only by the server's operating-system user.

For a continuously running Linux host, your service manager should run the
**same** `node --env-file=.env.acquisition scripts/acquisition-server.mjs` command
from the project folder as an unprivileged user, restart on failure, and send
SIGTERM on stop. Allow at least 35 seconds for shutdown. Keep the HTTPS proxy or
tunnel supervised too. With direct TLS, restrict the firewall to its chosen
port and arrange certificate renewal followed by a service restart. Avoid
running Node as root just to bind port 443; use a reverse proxy or unprivileged
port. These host-specific tasks belong to your server/provider, not GitHub or
the maintainer's Cloudflare account.

No production server, domain, provider subscription or automatic OS service is
silently provisioned. The runnable server, authentication, portable decoder,
gateway and configuration are included; you control where and when they run.
