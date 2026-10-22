import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

import {
  parseEnvAssignments,
  resolveFunctionSource,
  scopedFunctionsPath,
} from "../dist/api/functions.js";

const execFileAsync = promisify(execFile);

test("functions help exposes list push invoke alias", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["dist/cli.js", "functions", "--help"], {
    cwd: process.cwd(),
  });
  assert.match(stdout, /list/);
  assert.match(stdout, /push/);
  assert.match(stdout, /invoke/);
  assert.match(stdout, /alias/);
});

test("env help exposes list set unset", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["dist/cli.js", "env", "--help"], {
    cwd: process.cwd(),
  });
  assert.match(stdout, /list/);
  assert.match(stdout, /set/);
  assert.match(stdout, /unset/);
});

test("parseEnvAssignments and resolveFunctionSource", async () => {
  assert.deepEqual(parseEnvAssignments(["FOO=bar", "export BAZ=qux"]), {
    FOO: "bar",
    BAZ: "qux",
  });
  assert.equal(scopedFunctionsPath("SITE1", "develop"), "/SITE1/develop/functions");

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "demox-fn-"));
  const file = path.join(dir, "index.js");
  await fs.writeFile(file, "module.exports = async () => ({ status: 200 });\n");
  const source = await resolveFunctionSource(dir);
  assert.equal(source.entrypoint, "index.js");
  assert.match(source.source, /module\.exports/);
  await fs.rm(dir, { recursive: true, force: true });
});
