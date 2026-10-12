import { beforeEach } from "vitest";
import { useGateway } from "../src/gateway/control.js";
import { useDatabase } from "../src/storage/database.js";
import { createTestDatabase } from "./helpers/database.js";

// Every test starts with an empty database, set up from migrations/ like the real D1 database,
// and no Gateway binding (tests that need one set a fake with useGateway()).
beforeEach(() => {
  useDatabase(createTestDatabase());
  useGateway(undefined);
});
