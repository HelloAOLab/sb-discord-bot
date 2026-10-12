# sb-discord-app

A TypeScript Discord app for [seedbible.org](https://seedbible.org) that receives slash commands over HTTP ([interactions endpoint](https://discord.com/developers/docs/interactions/overview#configuring-an-interactions-endpoint-url)). It runs on [Cloudflare Workers](https://developers.cloudflare.com/workers/) with [Hono](https://hono.dev), stores per-server settings in [D1](https://developers.cloudflare.com/d1/), and gets Bible data from the [Free Use Bible API](https://bible.helloao.org).

## Setup

1. Create an application at the [Discord Developer Portal](https://discord.com/developers/applications), and install it to your server from the **Installation** page with the scopes `applications.commands` and `bot`, and the bot permissions **View Channels**, **Send Messages** and **Read Message History**. The `bot` scope is needed for inline verses (replying to references like "John 3:16"): Discord only sends messages to a bot that's a member of the server. For the same feature, turn on **Bot → Privileged Gateway Intents → Message Content Intent**.
2. Install dependencies: `pnpm install`.
3. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN` (**Bot**), and `DISCORD_CLIENT_ID` and `DISCORD_PUBLIC_KEY` (**General Information**). `.env` stays on your machine: `pnpm deploy-commands` and `pnpm dev` read it; the deployed Worker gets its key from a Cloudflare secret instead (below).
4. Register the slash commands: `pnpm deploy-commands`.

### Deploy to Cloudflare

Pushing to `main` deploys automatically (see [CI/CD](#cicd)). To deploy by hand:

```sh
pnpm wrangler login                              # once
pnpm db:migrate:remote                           # create the tables in the D1 database
pnpm wrangler secret put DISCORD_PUBLIC_KEY      # once: paste the Public Key when asked
pnpm wrangler secret put DISCORD_TOKEN           # once: paste the bot token (only inline verses use it)
pnpm deploy-worker                               # prints the Worker's URL, e.g. https://sb-discord-app.<you>.workers.dev
```

Then in the portal under **General Information → Interactions Endpoint URL**, enter `https://<worker-url>/interactions` and save. Discord sends a signed test request; saving only succeeds if the Worker verifies it.

### CI/CD

GitHub Actions runs two workflows:

- **CI** (`.github/workflows/ci.yml`): on every pull request and branch push, type-checks, runs the tests, and checks the Worker bundles.
- **Deploy** (`.github/workflows/deploy.yml`): on every push to `main`, runs CI, then applies D1 migrations, deploys the Worker, registers the slash commands, and smoke-tests the live Worker. You can also start it from the **Actions** tab.

One-time setup:

1. Set the Worker's secrets once (if not done): `pnpm wrangler secret put DISCORD_PUBLIC_KEY` and `pnpm wrangler secret put DISCORD_TOKEN`.
2. Create a Cloudflare API token (dashboard → **My Profile → API Tokens → Create Token**, "Edit Cloudflare Workers" template, plus **Account → D1 → Edit**).
3. In GitHub, **Settings → Secrets and variables → Actions**, add `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (dashboard → Workers & Pages, right sidebar), `DISCORD_TOKEN` and `DISCORD_CLIENT_ID`.
4. Optional: in **Settings → Branches**, require the "Type-check, test, build" check before merging into `main`.

### Run locally

```sh
pnpm db:migrate:local    # once, and after adding a migration
pnpm dev                 # http://localhost:8787
```

Discord can't reach `localhost`; to try local changes from Discord, expose it with a tunnel (`cloudflared tunnel --url http://localhost:8787` or `ngrok http 8787`) and point the Interactions Endpoint URL at `https://<tunnel>/interactions`.

Use a **separate Discord application for development** (its own token, public key and client ID in `.env`, invited only to a test server). Otherwise your local copy and the deployed bot share one bot: both receive every message and reply twice, and pointing the endpoint at your tunnel takes slash commands away from the live bot.

Inline verses work locally too: the Gateway connection is outgoing, so it needs no tunnel. It starts once a server runs `/setinlineverses state: on`. Wrangler restarts it whenever you save a file; it resumes its session, so that's cheap. Local cron triggers don't fire on their own; run `curl "http://127.0.0.1:8787/cdn-cgi/local/scheduled"` to trigger one by hand (rarely needed: the connection keeps itself running with its own alarm).

## Scripts

| Script                   | Description                                                     |
| ------------------------ | --------------------------------------------------------------- |
| `pnpm dev`               | Run the Worker locally with `wrangler dev`                      |
| `pnpm deploy-worker`     | Deploy the Worker to Cloudflare                                 |
| `pnpm build`             | Bundle the Worker into `dist/` without deploying                |
| `pnpm typecheck`         | Type-check without emitting                                     |
| `pnpm test`              | Run the tests                                                   |
| `pnpm deploy-commands`   | Register slash commands with Discord                            |
| `pnpm db:migrate:local`  | Apply `migrations/` to the local D1 copy                        |
| `pnpm db:migrate:remote` | Apply `migrations/` to the real D1 database                     |

## Structure

```
.github/workflows/           # CI (checks) and Deploy (main → Cloudflare)
wrangler.jsonc               # Worker config: D1 binding, Gateway Durable Object, cron
migrations/                  # D1 schema
src/
  worker.ts                  # Workers entry point (fetch, scheduled, Durable Object export)
  server/app.ts              # Hono app: verifies Discord's signature, routes interactions
  interactions/              # router, slash commands, buttons and menus
  gateway/                   # Durable Object holding the Gateway connection (receives messages)
  inline/                    # inline verses: replies to references found in messages
  bible/                     # Free Use Bible API helpers
  seedbible/                 # seedbible.org links and interface languages
  storage/                   # D1 access and per-server settings
  utils/                     # config, errors, text helpers
  scripts/deploy-commands.ts # registers slash commands via the REST API (runs locally)
```

## Adding a command

1. Create `src/interactions/commands/<name>.ts` exporting a `Command` (definition + `execute` returning a response).
2. Add it to `commandList` in `src/interactions/commands/index.ts`.
3. Run `pnpm deploy-commands`. Commands are registered globally and can take up to an hour to appear.

Discord requires a response within **3 seconds**. For slower work, return `deferReply(interaction, work)` from `src/interactions/deferred.ts`; see CLAUDE.md for details.
