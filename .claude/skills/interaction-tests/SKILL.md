---
name: interaction-tests
description: Write and run Vitest tests for this repo's Discord HTTP interactions — slash command handlers in src/interactions/commands/, button/select-menu components in src/interactions/components/, and the signed POST /interactions endpoint. Use this whenever the user asks to test, add tests for, cover, or verify a slash command, a component, a command's options or replies, custom_id handling, the interactions router, signature verification, deferred/follow-up responses, or error handling — and also whenever you add or change a slash command or component, even if tests weren't explicitly requested, since every one should ship with tests.
---

# Testing Discord interactions

This app receives slash commands as signed HTTP POSTs and runs on Cloudflare Workers (see CLAUDE.md). Tests run on **Vitest** in Node and never talk to Discord or Cloudflare: a throwaway Ed25519 key pair stands in for Discord's, so tests can sign requests exactly as Discord does and exercise the real Hono app, and an in-memory SQLite database stands in for D1.

## Run

```sh
pnpm test                                    # whole suite, once
pnpm test:watch                              # re-run on change
pnpm vitest run test/interactions/commands/open.test.ts   # one file
pnpm typecheck                               # also type-checks test/
```

Finish every testing task with `pnpm test` and `pnpm typecheck` both passing.

## Layout

```
vitest.config.ts               # runs test/setup.ts before every test file
test/
  setup.ts                     # gives every test a fresh database (useDatabase(createTestDatabase()))
  helpers/
    keys.ts                    # test key pair + signRequest()
    interactions.ts            # chatInputInteraction(), buttonInteraction(), selectInteraction(),
                               #   autocompleteInteraction(), withPermissions(), opt.* option builders
    server.ts                  # postInteraction(), request(), testEnv(): call the Hono app like Cloudflare does
    database.ts                # createTestDatabase(): D1 stand-in built from migrations/
    bible-api.ts               # mockFetch(): fake Bible API (all 66 books) + records Discord webhook calls
  interactions/
    router.test.ts             # endpoint: signatures, routing, errors
    commands/<name>.test.ts    # one file per command, mirroring src/
    components/<name>.test.ts  # one file per component, mirroring src/
```

Tests live in `test/`, mirroring the path of the file under test in `src/`. Imports are relative and end in `.js`, like the rest of the codebase (`../../../src/interactions/commands/open.js`).

The Worker reads its settings from the `env` Cloudflare passes in, not `process.env`; endpoint tests pass `testEnv()` (the test public key and the current test database). Code that touches settings uses `database()`, which `test/setup.ts` points at a fresh in-memory database before every test, so tests never share data and need no cleanup. Don't read real `.env` values in tests.

## Two kinds of tests — pick by what you're checking

**1. Command tests (most tests).** Call `command.execute()` directly with a fake interaction. Fast, no server, no signing. Use for everything about what a command *does*.

```ts
import { expect, it } from "vitest";
import { InteractionResponseType, PermissionFlagsBits } from "discord-api-types/v10";
import { setSeedBibleLinks } from "../../../src/interactions/commands/setseedbiblelinks.js";
import { chatInputInteraction, opt, withPermissions } from "../../helpers/interactions.js";

it("turns links off", async () => {
  const interaction = chatInputInteraction("setseedbiblelinks", [opt.string("state", "off")]);
  const response = await setSeedBibleLinks.execute(withPermissions(interaction, PermissionFlagsBits.ManageGuild));

  expect(response.type).toBe(InteractionResponseType.ChannelMessageWithSource);
  expect(response).toMatchObject({ data: { content: expect.stringContaining("now **off**") } });
});
```

`execute` returns the `APIInteractionResponse` union, so TypeScript won't let you read `response.data.content` directly. Use `toMatchObject` / `toEqual` on the whole response rather than casting.

**2. Endpoint tests.** POST signed requests to the real app. Use only for behavior that lives in `router.ts` or `server/app.ts`: signature checks, routing by name, unknown commands, thrown errors, unsupported interaction types, Worker config errors, `waitUntil()` handling. Don't re-test each command's output here. That's what command tests are for.

```ts
import { expect, it } from "vitest";
import { chatInputInteraction } from "../helpers/interactions.js";
import { postInteraction } from "../helpers/server.js";

it("routes a slash command to its handler", async () => {
  const res = await postInteraction(chatInputInteraction("open"));
  expect(res.status).toBe(200);
});
```

`postInteraction(payload, options)` calls the Hono app directly (no server or port) and returns `{ status, body, text, background }`. `background` resolves once everything the app handed to `waitUntil()` has finished, so `await res.background` before checking a deferred reply's follow-up. Options: `badSignature`, `unsigned`, `rawBody` (sign and send an exact string, used to prove verification runs on raw bytes), and `env` (e.g. to test a missing secret). `request(path, init)` sends any other request (e.g. `GET /health`).

## Helpers

- `chatInputInteraction(name, options?, overrides?)` builds a realistic slash-command payload (guild, member, user, token). Pass `overrides` to test context-dependent behavior, e.g. `{ guild_id: undefined, member: undefined, user: {...} }` for a DM, or a different `member.user.id`.
- `opt.string | opt.integer | opt.number | opt.boolean (name, value)` produce option objects shaped like Discord's. If a command needs another option type (user, channel, subcommand), add a builder to `test/helpers/interactions.ts` rather than inlining payloads in tests, so every test file shares one accurate shape.

## What to cover for a command

Work through this list for every command. Skip items that don't apply.

1. **Definition**: `data.name` matches the file/registration, and options have the right `name`, `type`, and `required`. A typo here passes type-checking but breaks the command in Discord.
2. **Happy path**: the exact response for typical input (`type` and `data`).
3. **Each option**: present vs. absent for optional ones, and boundary values (empty string, very long text, 0/negative numbers).
4. **Mention safety**: if any user-supplied text reaches `content`, assert `allowed_mentions: { parse: [] }`. Use input like `"@everyone"` so the test explains itself.
5. **Ephemeral vs. public**: if a reply should be private, assert `flags: MessageFlags.Ephemeral`.
6. **Failures**: what the user sees when input is invalid or an external call fails. It should be a friendly ephemeral message, not a thrown error, unless throwing is intended (the router turns throws into a generic ephemeral error).
7. **Registration**: when adding a command, make sure it's in `commandList` — a quick endpoint test (`postInteraction(... chatInputInteraction("<name>"))` → not the "Unknown command." reply) catches a forgotten registration.

## Components (buttons and select menus)

Test a component the same two ways as a command. Call `component.execute(interaction, args)` directly for what it does, and use endpoint tests only for routing. Build the click with `buttonInteraction(customId("<id>", ...args))` or the menu choice with `selectInteraction(customId("<id>", ...args), [value])`. Always build custom_ids with the real `customId()` from `src/interactions/components/custom-id.ts` rather than hand-writing strings, so tests break if the encoding changes.

```ts
const id = customId("open-picker", "book", "", "", "", 0, 0);
const response = await openPicker.execute(selectInteraction(id, ["JHN"]), parseCustomId(id).args);
expect(response).toEqual({ type: InteractionResponseType.DeferredMessageUpdate });
await runDeferredWork(response); // with mockFetch(): the PATCH redrawing the picker is in discordCalls
```

What to cover for a component:

1. **Wiring**: the row/button builder produces a `custom_id` whose id part matches `component.id`, and the component is in `componentList` (`components.get(id)` returns it). A mismatch means clicks hit "This button or menu no longer works."
2. **Response type**: `UpdateMessage` (edits the clicked message) vs. `ChannelMessageWithSource` (posts a new one). Picking the wrong one is a real user-facing bug, so assert it explicitly.
3. **Args from custom_id**: normal values, plus missing, garbled, or hostile ones (`"abc"`, `"-5"`, empty). Anyone can send any custom_id to the endpoint, so a component must not crash or misbehave on bad args.
4. **Follow-on components**: if the response includes new buttons or menus, assert their custom_ids carry the updated state (e.g. the picker's chapter menu is `open-picker:chapter:::JHN:0:0`).
5. **The command that sends it**: the command's test should assert the component is attached to its reply.

Use `selectInteraction(customId, values)` for a select-menu choice.

## External calls (Bible API, Discord webhooks)

Tests must never hit the real network. `mockFetch()` from `test/helpers/bible-api.ts` answers Bible API requests from fixtures (all 66 books with real chapter counts, a few translations) and records Discord webhook calls in `discordCalls`; pass `discordStatus` to make Discord fail. For a one-off response:

```ts
vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));
```

`restoreMocks: true` in `vitest.config.ts` undoes spies after each test. Also test the failure path (`status: 500`, `mockRejectedValue(new Error("network"))`). Endpoint tests don't use the network themselves, so a blanket `fetch` mock is safe there.

The Bible API client caches responses. To test a lookup in isolation, pass a fresh `new FreeUseBibleApi()` where the function accepts one; to simulate the shared client failing, spy on it (`vi.spyOn(bibleApi, "getTranslationBooks").mockRejectedValue(...)`).

## Settings (D1)

Each test starts with an empty database built from `migrations/`, so set any state the test needs (`await setSeedBibleLinksEnabled(guildId, false)`) and don't clean up. All storage functions are async. To inspect rows, use the same API as D1: `await database().prepare("SELECT …").all()`.

## Deferred responses (slow commands)

A command that can't answer within 3 seconds returns `deferReply(interaction, work)` (or `deferUpdate` for components) and later edits the reply via `PATCH /webhooks/{application_id}/{token}/messages/@original`. Test both halves:

- `execute()` returns the deferred type immediately.
- The follow-up sends the right request: pass the response to `runDeferredWork(response)` and await it with `fetch` mocked, then assert on `discordCalls` (method, URL, body). Through the endpoint, `await res.background` instead.

## Make sure the test can fail

A test that passes no matter what protects nothing. For any new safeguard test, briefly break the code it guards (change the reply text, remove `allowed_mentions`, skip a permission check), confirm the test fails, then restore the code. This matters most for router and signature tests. For example, re-serialized JSON happens to match the signed bytes, so only the `rawBody` test catches verification running on a parsed body instead of the raw one.

## Conventions

- One `describe` per command or endpoint, with `it` names that read as behavior ("replies privately when a command throws"), not implementation.
- When a test triggers an expected `console.warn`/`console.error`, silence it with `vi.spyOn(console, "error").mockImplementation(() => {})` so test output stays readable.
- Use enums from `discord-api-types/v10` (`InteractionResponseType.ChannelMessageWithSource`), not magic numbers like `4`.
