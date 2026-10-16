# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Communication Style

Write explanations to be understood on the first read. The reader may not have the code in front of them.

- **Plain language over jargon.** When a technical term is unavoidable, explain it in everyday words right after.
- **Lead with the short answer**, then the detail. Don't make the reader assemble the conclusion from scattered pieces.
- **Use concrete before/after.** To explain a change in behavior, describe what happened _before_ and what happens _now_, with a real example ("books used to enter one by one; now they enter all at once").
- **Explain the _why_, not just the _what_.** If something couldn't be done, say plainly what blocked it.
- **Avoid over-compression.** A few clear sentences beat one dense sentence packed with terms. Don't sacrifice clarity to be brief.
- **Don't bury trade-offs.** When presenting options, make the consequence of each one obvious.

This applies to all prose responses — summaries, explanations, and trade-off discussions — not to code itself.

## Project Overview

**sb-discord-app** is a Discord app that helps users generate useful links and content for [seedbible.org](https://seedbible.org) through slash commands.

It is mainly an **HTTP interactions app**: Discord sends each slash command as a signed `POST` request, and we reply in the HTTP response. The one exception is **inline verses** (replying to "John 3:16" written in chat), which needs to see messages. For that, a Durable Object (`src/gateway/`) holds one Gateway connection, Discord's WebSocket that streams events, with the `GuildMessages` and `MessageContent` intents. It's a small hand-written client, not `discord.js`. Don't add `discord.js` or more intents unless explicitly asked; everything else should stay an interaction.

It runs on **Cloudflare Workers** (configured in `wrangler.jsonc`): Cloudflare calls the Worker for each request, with no long-running server. That means no Node-only APIs in `src/` (no `fs`, `process`, `node:*` imports) except in `src/scripts/`, which runs on your machine; settings and secrets come from the Worker's `env`, not `.env`; and per-server data lives in a **D1** database (Cloudflare's hosted SQLite).

## Bible Data: Free Use Bible API

Both this app and seedbible.org get their Bible text from the **Free Use Bible API** (`https://bible.helloao.org`). It's free, needs no API key, and serves 1000+ translations as static JSON. Use it for anything involving translations, books, chapters, or verses. Don't scrape seedbible.org or hardcode Bible text.

- Docs: https://bible.helloao.org/docs/ (JS SDK: https://bible.helloao.org/docs/sdks/javascript.html)
- SDK: the `free-use-bible-api` npm package (MIT, ships TypeScript types), already a dependency. Its types (`ApiTranslationBookChapter`, `ChapterVerse`, etc.) are exported from the package root; use them instead of redefining response shapes.

### Using the SDK

```ts
import { FreeUseBibleApi } from "free-use-bible-api";

const api = new FreeUseBibleApi(); // options: { endpoint?: string, useCache?: boolean (default true) }

const { translations } = await api.getAvailableTranslations();           // every translation
const { books } = await api.getTranslationBooks("BSB");                 // books in one translation
const chapter = await api.getTranslationBookChapter("BSB", "JHN", 3);   // full chapter, structured
const simple = await api.getSimpleTranslationBookChapter("BSB", "JHN", 3); // full chapter, plain-text verses
const next = await api.getNextChapter(chapter);                          // null at the end of the Bible
```

Other methods include `getPreviousChapter`, `getCompleteTranslation` (whole Bible, very large, never cached), commentaries (`getAvailableCommentaries`, `getCommentaryBookChapter`, e.g. `"matthew_henry"`), and datasets such as cross-references. Check the package's types before using them.

The SDK uses the global `fetch` and **throws on any non-2xx response**. A 404 almost always means a wrong translation, book, or chapter ID. Catch it and show the user a friendly ephemeral message.

### IDs are case-sensitive

- **Translation IDs** must match the list exactly: `BSB` (Berean Standard Bible), `ENGWEBP`, `eng_asv`, `eng_bbe`, … Casing varies between translations. `bsb` and `engwebp` return 404, even though the docs show `engwebp`. Validate user input against `getAvailableTranslations()` rather than guessing or upper-casing.
- **Book IDs** are uppercase USFM codes: `GEN`, `EXO`, `PSA`, `MAT`, `JHN`, `REV`. `jhn` returns 404. Map user-friendly names ("John", "1 Cor") to codes using the `books` list (`id`, `name`, `commonName`).
- **Chapters** are numbers. Each book entry gives `numberOfChapters`, `firstChapterNumber`, and `lastChapterNumber`.

### Response shapes (verified against the live API)

- **Translation:** `id`, `name`, `englishName`, `shortName`, `language` (ISO 639-3, e.g. `"eng"`), `languageName`, `languageEnglishName`, `textDirection` (`"ltr"`/`"rtl"`), `website`, `licenseUrl`, `numberOfBooks`, `totalNumberOfChapters`, `totalNumberOfVerses`.
- **Book:** `id`, `name`, `commonName`, `title`, `order`, `numberOfChapters`, `firstChapterNumber`, `lastChapterNumber`, `totalNumberOfVerses`, `isApocryphal?`.
- **Chapter** (`getTranslationBookChapter`): `{ translation, book, chapter: { number, content, footnotes }, numberOfVerses, nextChapterApiLink, previousChapterApiLink, … }`. `chapter.content` is a list of items with a `type`:
  - `"verse"`: `{ number, content }`, where `content` mixes plain strings with objects: formatted text, inline headings or line breaks, and footnote markers (`{ noteId }`). Flattening this by hand is error-prone: for example, John 3:16 BSB is split into `"…one and only"`, `{ noteId: 17 }`, `"Son, that…"` with no space between the strings, and formatted-text objects carry text too.
  - `"heading"`: `{ content: string[] }`, a section heading like "Jesus and Nicodemus".
  - `"line_break"` and `"hebrew_subtitle"` (used for Psalm superscriptions).
  - `chapter.footnotes`: `{ noteId, caller, text, reference: { chapter, verse } }`.
- **Simple chapter** (`getSimpleTranslationBookChapter`): the same structure, but each verse is `{ type: "verse", number, text, footnotes: [{ noteId, offset, text, caller }] }`, with the full verse as one plain string. **Prefer this for Discord replies.** It avoids flattening the structured format by hand.

### Things to plan for

- **Shared client and helpers:** use `bibleApi` from `src/bible/api.ts` rather than creating a new client, so every command shares one cache. `findTranslation()` turns user text ("bsb", "kjv", "R09") into the exact translation and throws a `UserFacingError` with a friendly message if there's none; `searchTranslations()` ranks translations for autocomplete. `loadBooks()` gets a translation's books (plus English names), and `findBook()` looks one up by USFM code.
- **3-second limit:** API calls are usually fast, but not guaranteed. Commands that fetch Bible data should return `deferReply(interaction, work)` (see Important Constraints).
- **Caching:** the SDK caches responses in memory for as long as the Worker instance lives (Cloudflare reuses instances but discards them at any time), except complete translations, and the API sends `Cache-Control: max-age=86400`. Bible text never changes, so don't add another caching layer unless profiling shows a need.
- **CPU time:** Workers limit CPU time per request (10 ms on the free plan). Parsing the full translation list (~900 KB, used by `findTranslation()` and translation autocomplete) is the heaviest thing the app does; watch for "exceeded CPU" errors in `wrangler tail` if the Worker is on the free plan.
- **Too many translations for a dropdown:** there are 1,250+ translations, and Discord limits a slash-command option to 25 fixed choices. Use an **autocomplete** option instead (see `/open`'s `translation` option and `searchTranslations()`).
- **Discord's message limit:** messages are capped at 2,000 characters, and a full chapter often exceeds that. Plan for verse ranges, truncation with a link to seedbible.org, or paging with buttons (see `components/`).
- **Tests** must mock `fetch` and never call the real API (see the `interaction-tests` skill).

## Package Manager

This project requires **pnpm v10+**. Do not use npm or yarn.

## Common Commands

```sh
pnpm dev                 # run the Worker locally (wrangler dev, http://localhost:8787), with a local D1 copy
pnpm dev:bot             # run your dev bot on local code: dev server + tunnel + endpoint URL + commands (see Local Development)
pnpm typecheck           # type-check without emitting — run after every change
pnpm test                # run the Vitest suite once
pnpm test:watch          # re-run tests on change
pnpm build               # bundle the Worker into dist/ without deploying (checks it builds for Workers)
pnpm deploy-worker       # deploy the Worker to Cloudflare (wrangler deploy); not `pnpm deploy`, a pnpm built-in
pnpm deploy-commands     # register slash commands with Discord (global); runs locally, reads .env
pnpm db:migrate:local    # apply migrations/ to the local D1 copy used by `pnpm dev`
pnpm db:migrate:remote   # apply migrations/ to the real D1 database — do this before deploying code that needs them
```

`wrangler` is a dev dependency, so run it as `pnpm wrangler …` (e.g. `pnpm wrangler tail` to stream the deployed Worker's logs).

There is no linter configured. Verify changes with `pnpm test` and `pnpm typecheck`.

## CI/CD (GitHub Actions)

- **`.github/workflows/ci.yml`** runs on every pull request and every push except to `main`: `pnpm install --frozen-lockfile`, `typecheck`, `test`, `build`. Keep `pnpm-lock.yaml` in sync with `package.json` (commit both), or the install step fails.
- **`.github/workflows/deploy.yml`** runs on every push to `main` (and by hand from the Actions tab): it calls CI, then applies D1 migrations (`db:migrate:remote`), deploys the Worker, registers slash commands (`deploy-commands`), and smoke-tests the live Worker (`/health` must be 200; an unsigned `POST /interactions` must be 401, where 500 means `DISCORD_PUBLIC_KEY` is missing). Merging to `main` is how changes go live; manual `pnpm deploy-worker` is only needed outside that flow.
- Deploy secrets (repository secrets, Settings → Secrets and variables → Actions): `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit, D1: Edit), `CLOUDFLARE_ACCOUNT_ID`, `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`. The Worker's `DISCORD_PUBLIC_KEY` and `DISCORD_TOKEN` are Cloudflare secrets set once with `pnpm wrangler secret put`, not GitHub secrets (the GitHub `DISCORD_TOKEN` is only for registering commands).

## Architecture

```
wrangler.jsonc                 # Worker config: entry point, D1 binding (DB → database "db1"), GATEWAY Durable Object, cron (every minute)
migrations/                    # D1 schema, applied with pnpm db:migrate:local / db:migrate:remote
src/
  worker.ts                    # Cloudflare Workers entry: the Hono app (fetch), the cron (scheduled: sessions, Gateway wake), the Gateway class
  gateway/
    client.ts                  # GatewayClient: Discord's Gateway protocol (identify, heartbeat, resume, reconnect)
    durable-object.ts          # Gateway Durable Object: holds the client, runs it on its alarm
    control.ts                 # useGateway() / wakeGateway(): how the Worker reaches the Durable Object
  inline/
    messages.ts                # replyToReferences(): a new message → replies to its Bible references
    passages.ts                # passageReplies(): one components reply per passage (a box: text cut to fit, Seed Bible button)
  interactions/
    router.ts                  # handleInteraction(): find the command, component or modal → return its response
    deferred.ts                # deferReply() / deferUpdate(): answer now, edit the message when slow work finishes
    open-link.ts               # resolveOpenLink() / openMessage(): the "Open John 3 in Seed Bible" link
    permissions.ts             # hasPermission(): the user's server permissions; appCanPost(): can the bot post here
    user.ts                    # interactionUserId(): who clicked or typed, in a server or a DM
    autocomplete.ts            # translationChoices() / uiLanguageChoices() / timeZoneChoices(): shared suggestions
    commands/
      types.ts                 # `Command` interface: { data, execute, autocomplete? }
      index.ts                 # `commandList` — every command must be registered here
      open.ts                  # /open [translation] [lang]: shows the open-picker component
      setseedbiblelinks.ts     # /setseedbiblelinks [on|off]: per-server switch for Seed Bible links (Manage Server)
      setinlineverses.ts       # /setinlineverses [on|off]: per-server switch for inline verses (Manage Server)
      launchsession.ts         # /launchsession: opens the session-builder form
      preferences.ts           # /preferences [translation] [lang] [timezone] [reset]: the user's own preferences
    components/                # buttons and select menus
      types.ts                 # `Component` interface: { id, execute(interaction, args) }
      index.ts                 # `componentList` — every component must be registered here
      custom-id.ts             # customId() / parseCustomId(): "<id>:<arg>:<arg>" encoding
      open-picker.ts           # /open's private picker: book → chapter (paged with "Next →"), then posts the link
      pages.ts                 # pagedOptions(): split long lists into menu pages with "← Previous" / "Next →"
      session-time.ts          # the private time picker for a scheduled session: day, hour, minute, time zone
      session.ts               # a session's Join / Leave / Cancel session / Get my link buttons
    modals/                    # pop-up forms
      types.ts                 # `Modal` interface: { id, execute(interaction, args) }
      index.ts                 # `modalList` — every modal must be registered here
      fields.ts                # modalFields() / textField() / choiceField(): read what was submitted
      session-builder.ts       # /launchsession's form: passage, title, start now or later, reminder
  sessions/
    time.ts                    # clock time in a time zone ↔ Unix seconds; the picker's time zone list
    messages.ts                # the announcement, reminder, start message and private "Get my link" reply
    scheduler.ts               # runDueSessions(): the cron's job, posting due reminders and start messages
  bible/
    api.ts                     # shared Free Use Bible API client
    translations.ts            # findTranslation() / searchTranslations(): user text → exact translation ID
    books.ts                   # loadBooks() / findBook(): a translation's books, looked up by USFM code
    references.ts              # findPassages(): Bible references in chat text (openbibleinfo parser) → book + chapter/verse segments
  seedbible/
    links.ts                   # seedBibleUrl() / seedBibleChapterUrl() / seedBibleSessionUrl(): seedbible.org links (always source=discord_bot)
    ui-languages.ts            # the 77 interface languages seedbible.org supports (`lang` URL parameter)
  storage/
    database.ts                # useDatabase() / database(): the D1 database for the current request
    guild-settings.ts          # per-server settings (seedBibleLinksEnabled / setSeedBibleLinksEnabled)
    user-settings.ts           # per-user preferences (translation, lang, time zone)
    sessions.ts                # reading sessions and who joined them
  utils/
    config.ts                  # `Env` (the Worker's secrets and bindings) and parseEnv(), which validates it with zod
    errors.ts                  # UserFacingError: an error whose message is shown to the user privately
    text.ts                    # truncate() for Discord's label limits
    discord.ts                 # createMessage(): post a message as the bot (needs DISCORD_TOKEN)
  server/
    app.ts                     # Hono app: POST /interactions (signature check → router → waitUntil), GET /health
  scripts/
    deploy-commands.ts         # PUTs `commandList` definitions to Discord's REST API (runs in Node, reads .env)
    dev-bot.ts                 # `pnpm dev:bot`: wrangler dev + cloudflared tunnel, then points the dev app at it
    discord-app.ts             # registerCommands() / setInteractionsEndpoint(): Discord REST calls the scripts share
    tunnel.ts                  # findTunnelUrl() / isDevEndpoint(): helpers for dev-bot.ts
    install.ts                 # the bot's install scopes and permissions (BOT_PERMISSIONS, with reasons), invite link
```

### Adding a slash command

1. Create `src/interactions/commands/<name>.ts` exporting a `Command`. Follow `setseedbiblelinks.ts` as the pattern for options with fixed choices, and `open.ts` for autocomplete and deferred replies.
   - `data` is the raw Discord command JSON (`RESTPostAPIChatInputApplicationCommandsJSONBody`).
   - `execute` returns an `APIInteractionResponse` object; it does not call `reply()`.
2. Add it to `commandList` in `src/interactions/commands/index.ts`.
3. Run `pnpm deploy-commands`. Global commands can take **up to an hour** to appear or update in Discord.

To report a problem with the user's input, throw a `UserFacingError("…")`: the router (and `deferReply`) shows its message privately instead of the generic "Something went wrong".

For an option with too many values for 25 fixed choices, set `autocomplete: true` on it and add an `autocomplete(interaction)` method to the command that returns up to 25 `{ name, value }` choices for the option marked `focused`. Autocomplete can't show errors; if it throws, the router returns no suggestions. Users can still submit text that isn't a suggestion, so `execute` must validate it too.

### Adding a component (button or select menu)

Components are the interactive parts of a message. A command (or another component) sends them; when a user clicks one, Discord POSTs an interaction carrying the component's `custom_id`, and the router finds the handler by the part before the first `:`.

1. Create `src/interactions/components/<name>.ts` exporting a `Component` with a unique `id`, plus a function that builds the message or action rows it appears in (see `open-picker.ts` and its `pickerMessage()`).
2. Always build `custom_id` with `customId(id, ...args)`. It enforces Discord's 100-character limit and rejects `:` inside args. Store small state the handler needs (counts, IDs) in the args, because the app keeps no memory between requests.
3. Add it to `componentList` in `src/interactions/components/index.ts`. Components don't need `pnpm deploy-commands`.
4. Respond with `InteractionResponseType.UpdateMessage` to edit the message the component is on, or `ChannelMessageWithSource` to post a new one. If the handler needs the Bible API, return `deferUpdate(interaction, work)` instead; `work` returns the new message, and can post extra messages with `sendFollowUp()`.

Every menu holds at most **25 options**, and a message holds at most **5 rows** of components. When there are more choices than that (66 books, 150 psalms), page them with `pagedOptions()` from `components/pages.ts`: the last option is "Next →" and later pages start with "← Previous". Choosing one sends a value like `page:2` (read it with `pageFromValue()`), so carry the current page in the custom_id and redraw the menu at the new page.

Buttons on old messages keep working after a deploy only if their `id` and arg format stay the same, so treat a component's `id` as permanent once released.

### Adding a modal (pop-up form)

A command or component opens a modal by returning `{ type: InteractionResponseType.Modal, data }`. When the user submits it, Discord POSTs a separate interaction, routed like a component by the part of its `custom_id` before the first `:`.

1. Create `src/interactions/modals/<name>.ts` exporting a `Modal` with a unique `id`, plus a function that builds the response opening it (see `session-builder.ts`). Wrap each field in a **Label** component (`ComponentType.Label`): text inputs, select menus, radio groups and checkboxes all go inside one. A modal holds at most 5.
2. Read the submission with `modalFields(interaction)`, then `textField()` (trimmed, `undefined` when blank) and `choiceField()` (a radio group or single-choice menu).
3. Add it to `modalList` in `src/interactions/modals/index.ts`.

Modals have no date or time input; the session time picker uses menus in a message instead.

## Per-server settings and storage

Per-server settings, per-user preferences and reading sessions live in the **D1 database** bound as `DB` in `wrangler.jsonc` (database `db1`). It's the app's only persistent state. `server/app.ts` passes the binding to `useDatabase()` on each request; code reads it with `database()`, using D1's API (`prepare(sql).bind(...).first() / .all() / .run()`, all async). Add a setting as a pair of functions in `storage/guild-settings.ts`; the `guild_settings` table stores one row per server and setting name, so no schema change is needed. Per-user preferences (`/preferences`) work the same way in `storage/user-settings.ts` (table `user_settings`).

**Schema changes** go in a new numbered file in `migrations/` (never edit an applied one). Apply it with `pnpm db:migrate:local` for `pnpm dev`, and with `pnpm db:migrate:remote` **before** deploying code that relies on it. Tests build their database from the same files, so a broken migration fails the tests.

**Seed Bible link buttons can be turned off per server** (`/setseedbiblelinks off`). Everything still works; links are just written out as text instead of shown as buttons. Any reply with a seedbible.org link must respect it: check `seedBibleLinksEnabled(interaction.guild_id)` when building the reply (on every click for components, so the change applies to messages already open) and, when it's false, use no link buttons. `openMessage(link, { button: false })` and `pickerMessage(state, books, { buttons: false })` do this; for other text, write the address with `plainLink(url)`, which wraps it in `<…>` so Discord doesn't add a preview card.

**Admin-only commands:** set `default_member_permissions` (hides the command by default) and `contexts: [InteractionContextType.Guild]`, and also check `hasPermission()` in `execute`, because server admins can make a command visible to anyone in Server Settings → Integrations.

## Inline verses and the Gateway connection

When a server turns on `/setinlineverses` (off by default), the bot replies to Bible references in ordinary messages, **one reply per passage** ("gen 1 1 and exo 2 3" gets two, at most 3). Each reply is a **Components V2** message (`MessageFlags.IsComponentsV2`: no `content`, only components): a box (Container) with a heading, the text cut short at a line break to fit Discord's 4,000-character limit, and an "Open in Seed Bible →" link button built with `seedBibleChapterUrl()`. The text is `INLINE_TRANSLATION` (AAB, the Accessible Ancients Bible and Seed Bible's own default). Per-user preferences exist now (`/preferences`), but inline replies don't use them yet: the whole channel reads a reply, not just its author.

`findPassages()` uses the [openbibleinfo Bible Passage Reference Parser](https://github.com/openbibleinfo/Bible-Passage-Reference-Parser) (`bible-passage-reference-parser`), so nearly any way of writing a reference works: "genesis 2 3-4", "Jn 3:16; 4:2", "1 Cor 13". The parser also accepts everyday words as books, so two lists in `references.ts` keep chat from triggering replies: `COMMON_WORDS` (abbreviations like "is", "am", "so", "ex" never count, even before a number, unless written with a dot: "it is 5 pm" isn't Isaiah 5, "Ex. 3:14" is Exodus) and `AMBIGUOUS_ALONE` (full names that are common words or first names, like Job, Mark, John, Acts, Numbers, only count with a chapter). Otherwise a book on its own, written in full, means its first chapter ("genesis" → Genesis 1). Code, links and mentions are skipped; a range over many chapters loads at most 3 of them (in parallel).

How messages arrive:

- **One connection for the whole bot.** The `Gateway` Durable Object (named `"main"`) holds it, and connects only while *some* server has inline verses on (`anyInlineVersesEnabled()`). `/setinlineverses` calls `wakeGateway()`, so turning the first server on connects at once and turning the last one off disconnects.
- **Everything runs on the object's alarm.** `GatewayClient.tick()` sends heartbeats, notices a dead connection, and reconnects with growing delays. Whether any server has inline verses on is read once and cached until the object is woken (`/setinlineverses` calls `wakeGateway()`, and so does the cron every 5th minute, in `scheduled()` in `worker.ts`), so heartbeats don't query D1.
- **Restarts resume.** Every deploy restarts the object. The session ID and how far events have been handled are saved in its storage, so the new copy resumes and Discord replays what it missed. Saved progress never passes a message whose reply is still being sent (so a restart can't lose it), and the last 50 messages answered are remembered (so a replayed one isn't answered twice).
- **Misconfiguration backs off.** A close that retrying won't fix (wrong token, Message Content intent not enabled) is logged with the fix, and the next try is 15 minutes later, even if inline verses are turned off and on in between. Discord allows only 1,000 new sessions a day per bot.
- **Replies are posted as the bot** (`POST /channels/{id}/messages` with `DISCORD_TOKEN`), not through an interaction. So the bot must be a member of the server (`bot` scope) with View Channels, Send Messages and Read Message History.
- **More than ~2,500 servers** would need sharding (several connections). The client doesn't support that yet; Discord closes with 4011 if it's needed.

Testing: `GatewayClient` takes its socket, storage, clock and handlers as options, so `test/gateway/client.test.ts` drives the protocol with `FakeSocket` / `FakeStorage` from `test/helpers/gateway.ts`. Test message handling by calling `replyToReferences(gatewayMessage("John 3:16"), token)` with `mockFetch()`.

## Reading sessions (`/launchsession`)

A reading session is one chapter that people open together in Seed Bible. Everyone's link carries the same `sessionId`, plus their own interface language and translation: `https://seedbible.org/en/AAB/genesis/5?sessionId=session-<uuid>&source=discord_bot` (`seedBibleSessionUrl()`). The bot makes up the session ID itself (`session-` + the session's UUID); it doesn't ask seedbible.org to create the session first.

1. `/launchsession` opens a form (`modals/session-builder.ts`): passage (read with `findPassages()`, using its first chapter), title, "Start now" or "Schedule for later", and a reminder.
2. **Start now** posts the public announcement with a **Get my link** button.
3. **Schedule for later** saves a `draft` session and shows a private **time picker** (`components/session-time.ts`). Discord has no date or time input, so it's four menus: day (the next 25), hour, minute (5-minute steps) and time zone. Its preview is a Discord timestamp (`<t:…:F>`), which each viewer sees in their own time zone, so a wrong zone shows up as a wrong time. **Schedule** posts the public announcement (Join / Leave / Cancel session, and who's going), adds the planner, and saves their time zone to their preferences.
4. The **cron** (every minute, `sessions/scheduler.ts`) posts the reminder and then the start message as the bot, pinging only the people who joined (`allowed_mentions.users`, at most 60). The start message has **Get my link**, which replies privately with that person's link (from `/preferences`, else their Discord language and AAB). Join on an announcement after the start does the same. The buttons count a session as started once its start time has passed, without waiting for the cron to mark it.

Times are Unix seconds, so they go straight into Discord timestamps. The picker saves the clock time and time zone chosen; `sessions/time.ts` converts them, handling daylight saving. Scheduled sessions need the bot in the server with permission to post in the channel: the form checks `appCanPost()`, and the cron logs (and doesn't retry) a message Discord rejects. A session is marked as reminded or started *before* its message is posted, so nothing is posted twice. If the announcement can't be posted, the booking is undone (`unscheduleSession()`), so Schedule can be clicked again. Time pickers left open for a day are deleted, and sessions 30 days after they started or were cancelled, with who joined them. Only the planner, or someone with **Manage Events**, can cancel.

## seedbible.org links

Build links with `seedBibleUrl()` (`src/seedbible/links.ts`), e.g. `https://seedbible.org/?book=JHN&chapter=3&translation=BSB&source=discord_bot`. It supports `book` (USFM code), `chapter`, `translation` (Bible API ID, exact casing) and `lang`. `lang` sets the **interface** language and is independent of the translation; the codes it accepts are listed in `src/seedbible/ui-languages.ts`, copied from the site's locale files.

Inline verses link to the reader instead, with `seedBibleChapterUrl()`: `https://seedbible.org/genesis/2?verse=3-4&source=discord_bot`. It leaves out the language and translation (the full form is `/en/BSB/genesis/2`), so the site redirects to the reader's saved translation, or its defaults. Books are their English names in lowercase with hyphens (`1-corinthians`, `song-of-solomon`), which matches the site for all 66 books; `verse` takes `16`, `16-18` or `1,3,5-7`.

Use types and enums from `discord-api-types/v10` (e.g. `InteractionResponseType`, `ApplicationCommandOptionType`, `MessageFlags`). Use `discord-interactions` only for `verifyKey`.

## Important Constraints

- **Verify the raw body.** `server/app.ts` checks Discord's signature with `verifyKey()` against the request body exactly as received (`c.req.text()`), before parsing it. Never verify a parsed and re-serialized body, or add anything that consumes the body first — every request would then fail verification, and Discord disables an endpoint that accepts unsigned requests.
- **3-second response limit.** Discord drops the interaction if `execute` doesn't respond within 3 seconds. For slow work (external fetches, etc.), return `deferReply(interaction, async () => message)` from `src/interactions/deferred.ts`. `server/app.ts` sends the deferred response and keeps the Worker alive for the work with `ctx.waitUntil()` (without it, Cloudflare stops the Worker as soon as it responds). The work edits the reply via `PATCH /webhooks/{application_id}/{interaction_token}/messages/@original`, retrying once if Discord hasn't registered the response yet. If the work throws, the "thinking…" message is deleted and the error is sent as a private follow-up.
- **User text in replies.** When echoing user input, set `allowed_mentions: { parse: [] }` so users can't trigger `@everyone` or role pings through the bot.
- **PING** (Discord's endpoint check) is answered by `handleInteraction()` with PONG, after the signature check.

## Code Conventions

- **ES modules with NodeNext resolution.** Relative imports must include the `.js` extension, even from `.ts` files (`import { truncate } from "../utils/text.js"`).
- **TypeScript 7** with `strict` on. Keep type-check clean.
- **Logging** uses `console` with a bracketed area prefix: `[server]`, `[interactions]`.

## Environment

There are two separate sets of settings, because two things run in different places:

| Variable             | Where it's set | Source (Discord Developer Portal) | Used for |
| -------------------- | -------------- | --------------------------------- | -------- |
| `DISCORD_PUBLIC_KEY` | Deployed Worker: `pnpm wrangler secret put DISCORD_PUBLIC_KEY`; `pnpm dev`: `.env` | General Information → Public Key | Verifying incoming request signatures |
| `DB`                 | Worker binding in `wrangler.jsonc` | — | The D1 database |
| `GATEWAY`            | Worker binding in `wrangler.jsonc` | — | The Gateway Durable Object (inline verses) |
| `DISCORD_TOKEN`      | Deployed Worker: `pnpm wrangler secret put DISCORD_TOKEN`; your machine: `.env` | Bot → Token | Messages the bot posts by itself: inline verses (and their Gateway connection), session reminders and start messages; `pnpm deploy-commands` (REST auth). Optional for the Worker: without it, everything else works |
| `DISCORD_CLIENT_ID`  | `.env` (your machine only) | General Information → Application ID | `pnpm deploy-commands` |
| `DISCORD_DEV_GUILD_ID` | `.env.dev` only, optional | Your dev server's ID (Discord → Developer Mode → right-click the server → Copy Server ID) | `pnpm dev:bot` registers commands in that server only, so they appear at once |

Local values live in the git-ignored `.env` file (`.env.example` lists them). The dev bot has its own git-ignored **`.env.dev`** (`.env.dev.example`), with the same names plus `DISCORD_DEV_GUILD_ID`; only `pnpm dev:bot` uses it. `wrangler dev` loads it into the local Worker's `env` — but only when no `.dev.vars` file exists, so don't create one. The deployed Worker never reads `.env`; it gets `DISCORD_PUBLIC_KEY` and `DISCORD_TOKEN` from Cloudflare secrets. Only the Gateway Durable Object and the cron (session reminders) use the bot token; interactions never need it.

For local development, use a **separate Discord application**, the dev bot (its own values in `.env.dev`, invited only to a dev server). If the local Worker and the deployed one share a bot, both receive every message and reply twice.

The Worker's variables are declared and validated in `src/utils/config.ts` (`Env`, `parseEnv()`); when adding one, update it, `.env.example`, and this table, and set it on Cloudflare with `pnpm wrangler secret put`.

Never print, log, or commit `.env` values.

## Local Development

`pnpm dev` runs the Worker at `http://localhost:8787` in Wrangler's local runtime, with a local copy of D1 (in `.wrangler/`, set up with `pnpm db:migrate:local`), the Gateway Durable Object, and the secrets from `.env`. The Gateway connection is outgoing, so inline verses work locally without a tunnel once a test server runs `/setinlineverses state: on`. Discord can't reach `localhost`, so to try it from Discord either expose it with a tunnel (`cloudflared tunnel --url http://localhost:8787`) or deploy, then set **Interactions Endpoint URL** in the Developer Portal to `https://<url>/interactions`. The Worker must be running when you save, since Discord sends a verification request.

**`pnpm dev:bot` does all of that in one command** (`src/scripts/dev-bot.ts`), for the dev bot in `.env.dev`: sets its install settings (Installation → Guild Install: the `bot` and `applications.commands` scopes and the permissions in `src/scripts/install.ts`), applies local migrations, starts `wrangler dev --env-file .env.dev` (so the local Worker gets only the dev bot's values, never `.env`'s), opens a Cloudflare quick tunnel (a new random `https://….trycloudflare.com` address each run, no account needed), sets the dev application's Interactions Endpoint URL through Discord's API (`PATCH /applications/@me`), and registers the commands. With `DISCORD_DEV_GUILD_ID` set, commands go to that server only and appear at once; without it they're global and can take an hour. It keeps running with the Worker's logs until Ctrl+C, and prints an invite link: open it to add the dev bot to a server, or again to give it new permissions where it already is (changing the install settings doesn't update servers it's already in). When the bot starts using a new permission, add it to `BOT_PERMISSIONS`. It needs `cloudflared` (`winget install --id Cloudflare.cloudflared`). As safeguards it refuses to run if `.env.dev` names the same application as `.env`, or if the application's current endpoint isn't a tunnel address (it would be the deployed bot's) unless given `--force` (`pnpm dev:bot --force`). `wrangler dev` doesn't run the cron by itself, so `pnpm dev:bot` triggers it every minute (`GET /cdn-cgi/local/scheduled`), like Cloudflare does; under plain `pnpm dev`, run `curl "http://127.0.0.1:8787/cdn-cgi/local/scheduled"` by hand.

The dev machine runs Windows. In scripts (`src/scripts/`), avoid calling `process.exit()` while sockets are still closing; it can crash Node with a libuv assertion. Set `process.exitCode` and let the process exit on its own.

### Tests (`test/`)

Tests use **Vitest**, run in Node, and live in `test/`, mirroring the `src/` path of the file under test. They never contact Discord or Cloudflare: `test/helpers/server.ts` calls the Hono app directly with a test `env` (a throwaway signing key, so tests sign requests the way Discord does) and a stand-in `ctx` that records `waitUntil()` work, and `test/setup.ts` gives every test a fresh in-memory database built from `migrations/` (`test/helpers/database.ts`, which mimics D1's API with Node's SQLite). Follow the `interaction-tests` skill (`.claude/skills/interaction-tests/SKILL.md`) when writing or changing tests, and add tests with every new or changed slash command.

- `tsconfig.json` type-checks `src/` and `test/` (no output). Wrangler bundles the Worker from `src/worker.ts`, so tests never ship.