import { beforeEach } from "vitest";
import { useDatabase } from "../src/storage/database.js";
import { createTestDatabase } from "./helpers/database.js";

// Every test starts with an empty database, set up from migrations/ like the real D1 database.
beforeEach(() => {
  useDatabase(createTestDatabase());
});
