import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A disabled trader must idle, not exit: the container runs under
// `restart: unless-stopped`, so any exit becomes a restart loop. Validation
// used to run at module top level, below the idle path, and exited 1 for
// missing Alpaca keys — which is what looped on the droplet for days.
test("validation is gated on enabled, so a disabled trader stays idle", () => {
  const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  const idle = src.indexOf("setInterval");
  const validate = src.indexOf("validateConfig(config)");
  assert.ok(idle > 0, "the idle path exists");
  assert.ok(validate > idle, "validation comes after the idle path");
  const between = src.slice(idle, validate);
  assert.match(between, /if\s*\(config\.enabled\)/, "validation sits inside an enabled guard");
});
