# sb-discord-app

A TypeScript Discord app that receives slash commands over HTTP ([interactions endpoint](https://discord.com/developers/docs/interactions/overview#configuring-an-interactions-endpoint-url)) using [Express](https://expressjs.com) and [discord-interactions](https://github.com/discord/discord-interactions-js).

## Setup

1. Create an application at the [Discord Developer Portal](https://discord.com/developers/applications).
2. Copy `.env.example` to `.env` and fill in:
   - `DISCORD_CLIENT_ID` and `DISCORD_PUBLIC_KEY` — from **General Information**
   - `DISCORD_TOKEN` — from **Bot** (used only to register commands)
3. Install the app to your server from the **Installation** page (scope: `applications.commands`).
4. Install dependencies, register commands, and start the server:

```sh
pnpm install
pnpm deploy-commands
pnpm dev
```

5. Expose the server publicly (Discord can't reach `localhost`), e.g. with `ngrok http 3000` or `cloudflared tunnel --url http://localhost:3000`.
6. In the portal under **General Information → Interactions Endpoint URL**, enter `https://<your-public-url>/interactions` and save. Discord sends a signed test request; saving only succeeds if the server is running and verifies it.

## Scripts

| Script                 | Description                                  |
| ---------------------- | -------------------------------------------- |
| `pnpm dev`             | Run with auto-restart via `nodemon`          |
| `pnpm build`           | Compile TypeScript to `dist/`                |
| `pnpm start`           | Run the compiled build                       |
| `pnpm typecheck`       | Type-check without emitting                  |
| `pnpm deploy-commands` | Register slash commands with Discord         |

## Structure

```
src/
  index.ts                   # entry point: starts the Express server
  utils/
    config.ts                # env loading and validation (zod)
  interactions/
    router.ts                # POST /interactions — verifies signatures, dispatches commands
    commands/                # slash commands (register new ones in index.ts)
  server/
    app.ts                   # Express app
    routes/health.ts         # GET /health
  scripts/
    deploy-commands.ts       # registers slash commands via the REST API
```

## Adding a command

1. Create `src/interactions/commands/<name>.ts` exporting a `Command` (definition + `execute` returning a response).
2. Add it to `commandList` in `src/interactions/commands/index.ts`.
3. Run `pnpm deploy-commands`. Commands are registered globally and can take up to an hour to appear.

Discord requires a response within **3 seconds**. For slower work, respond with
`InteractionResponseType.DeferredChannelMessageWithSource`, then edit the reply later via
`PATCH /webhooks/{application_id}/{interaction_token}/messages/@original`.
