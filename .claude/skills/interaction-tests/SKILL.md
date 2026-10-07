---
name: interaction-tests
description: Write and run Vitest tests for this repo's Discord HTTP interactions — slash command handlers in src/interactions/commands/, button/select-menu components in src/interactions/components/, and the signed POST /interactions endpoint. Use this whenever the user asks to test, add tests for, cover, or verify a slash command, a component, a command's options or replies, custom_id handling, the interactions router, signature verification, deferred/follow-up responses, or error handling — and also whenever you add or change a slash command or component, even if tests weren't explicitly requested, since every one should ship with tests.
---

# Testing Discord interactions

This app receives slash commands as signed HTTP POSTs (see CLAUDE.md). Tests run on **Vitest** and never talk to Discord: a throwaway Ed25519 key pair stands in for Discord's, so tests can sign requests exactly as Discord does and exercise the real Express app.

## Run

```sh
pnpm test                                    # whole suite, once
pnpm test:watch                              # re-run on change
pnpm vitest run test/interactions/commands/echo.test.ts   # one file
pnpm typecheck                               # also type-checks test/
```

Finish every testing task with `pnpm test` and `pnpm typecheck` both passing.

## Layout

```
vitest.config.ts               # runs test/setup.ts before every test file
test/
  setup.ts                     # sets DISCORD_* env vars (public key = test key)
  helpers/
    keys.ts                    # test key pair + signRequest()
    interactions.ts            # chatInputInteraction(), buttonInteraction(), opt.* option builders
    server.ts                  # startTestServer(), postInteraction()
  interactions/
    router.test.ts             # endpoint: signatures, routing, errors
    commands/<name>.test.ts    # one file per command, mirroring src/
    components/<name>.test.ts  # one file per component, mirroring src/
```

Tests live in `test/`, mirroring the path of the file under test in `src/`. Imports are relative and end in `.js`, like the rest of the codebase (`../../../src/interactions/commands/echo.js`).

`src/utils/config.ts` exits the process if env vars are missing, which is why `test/setup.ts` exists. Never import app code in a way that bypasses it (e.g. a standalone script), and don't read real `.env` values in tests.

## Two kinds of tests — pick by what you're checking

**1. Command tests (most tests).** Call `command.execute()` directly with a fake interaction. Fast, no server, no signing. Use for everything about what a command *does*.

```ts
import { describe, expect, it } from "vitest";
import { InteractionResponseType } from "discord-api-types/v10";
import { echo } from "../../../src/interactions/commands/echo.js";
import { chatInputInteraction, opt } from "../../helpers/interactions.js";

it("echoes the message back", async () => {
  const response = await echo.execute(chatInputInteraction("echo", [opt.string("message", "hello")]));

  expect(response.type).toBe(InteractionResponseType.ChannelMessageWithSource);
  expect(response).toMatchObject({ data: { content: "hello" } });
});
```

`execute` returns the `APIInteractionResponse` union, so TypeScript won't let you read `response.data.content` directly. Use `toMatchObject` / `toEqual` on the whole response rather than casting.

**2. Endpoint tests.** Start the real app and POST signed requests. Use only for behavior that lives in `router.ts` or `server/app.ts`: signature checks, routing by name, unknown commands, thrown errors, unsupported interaction types, middleware order. Don't re-test each command's output here. That's what command tests are for.

```ts
import { afterAll, beforeAll, expect, it } from "vitest";
import { chatInputInteraction } from "../helpers/interactions.js";
import { postInteraction, startTestServer, type TestServer } from "../helpers/server.js";

let server: TestServer;
beforeAll(async () => { server = await startTestServer(); });
afterAll(async () => { await server.close(); });

it("routes a slash command to its handler", async () => {
  const res = await postInteraction(server.url, chatInputInteraction("ping"));
  expect(res.status).toBe(200);
});
```

`postInteraction(url, payload, options)` returns `{ status, body, text }`. Options: `badSignature`, `unsigned`, and `rawBody` (sign and send an exact string, used to prove verification runs on raw bytes).

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

Test a component the same two ways as a command. Call `component.execute(interaction, args)` directly for what it does, and use endpoint tests only for routing. Build the click with `buttonInteraction(customId("<id>", ...args))`. Always build custom_ids with the real `customId()` from `src/interactions/components/custom-id.ts` rather than hand-writing strings, so tests break if the encoding changes.

```ts
const response = await pingAgain.execute(buttonInteraction(customId("ping-again", 1)), ["1"]);
expect(response).toMatchObject({ type: InteractionResponseType.UpdateMessage, data: { content: "Pong! ×2" } });
```

What to cover for a component:

1. **Wiring**: the row/button builder produces a `custom_id` whose id part matches `component.id`, and the component is in `componentList` (`components.get(id)` returns it). A mismatch means clicks hit "This button or menu no longer works."
2. **Response type**: `UpdateMessage` (edits the clicked message) vs. `ChannelMessageWithSource` (posts a new one). Picking the wrong one is a real user-facing bug, so assert it explicitly.
3. **Args from custom_id**: normal values, plus missing, garbled, or hostile ones (`"abc"`, `"-5"`, empty). Anyone can send any custom_id to the endpoint, so a component must not crash or misbehave on bad args.
4. **Follow-on components**: if the response includes new buttons, assert their custom_ids carry the updated state (e.g. `pingAgainRow(2)`).
5. **The command that sends it**: the command's test should assert the component is attached to its reply.

If a component needs a select-menu payload, add a `selectInteraction()` builder next to `buttonInteraction()` in the helpers rather than inlining one.

## External calls (e.g. fetching seedbible.org content)

Tests must never hit the real network. Mock `fetch`:

```ts
vi.spyOn(globalThis, "fetch").mockResolvedValue(
  new Response(JSON.stringify({ title: "John 3:16" }), { status: 200 }),
);
```

`restoreMocks: true` in `vitest.config.ts` undoes spies after each test. Also test the failure path with `mockResolvedValue(new Response("", { status: 500 }))` and `mockRejectedValue(new Error("network"))`.

**Endpoint tests use `fetch` themselves** (`postInteraction` calls it), so a blanket mock would intercept the test's own request. Pass through local calls:

```ts
const realFetch = globalThis.fetch;
vi.spyOn(globalThis, "fetch").mockImplementation((input, init) =>
  String(input).startsWith(server.url) ? realFetch(input, init) : Promise.resolve(new Response("{}")),
);
```

## Deferred responses (slow commands)

A command that can't answer within 3 seconds returns `InteractionResponseType.DeferredChannelMessageWithSource` and later edits the reply via `PATCH /webhooks/{application_id}/{token}/messages/@original`. Test both halves:

- `execute()` returns the deferred type immediately.
- The follow-up sends the right PATCH. Structure the command so the follow-up work is an exported async function you can `await` directly in a test (with `fetch` mocked), then assert on the mock's calls: URL contains the interaction `token`, method is `PATCH`, body has the expected `content`. If the follow-up is fire-and-forget inside `execute`, use `await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())`.

## Make sure the test can fail

A test that passes no matter what protects nothing. For any new safeguard test, briefly break the code it guards (change the reply text, remove `allowed_mentions`, reorder middleware), confirm the test fails, then restore the code. This matters most for router and signature tests. For example, re-serialized JSON happens to match the signed bytes, so only the `rawBody` test catches `express.json()` being moved above `/interactions`.

## Conventions

- One `describe` per command or endpoint, with `it` names that read as behavior ("replies privately when a command throws"), not implementation.
- When a test triggers an expected `console.warn`/`console.error`, silence it with `vi.spyOn(console, "error").mockImplementation(() => {})` so test output stays readable.
- Use enums from `discord-api-types/v10` (`InteractionResponseType.ChannelMessageWithSource`), not magic numbers like `4`.
