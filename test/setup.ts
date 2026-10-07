import { testPublicKeyHex } from "./helpers/keys.js";

// src/utils/config.ts validates these at import time and exits if any are missing,
// so they must be set before any test imports app code.
process.env.DISCORD_TOKEN = "test-token";
process.env.DISCORD_CLIENT_ID = "123456789012345678";
process.env.DISCORD_PUBLIC_KEY = testPublicKeyHex;
// Each test file gets its own empty database that disappears when the file finishes.
process.env.DATABASE_PATH = ":memory:";
