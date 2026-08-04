import assert from "node:assert/strict";
import { test } from "node:test";

import { compareVersions, updateCli } from "../dist/utils/updater.js";

test("compares stable and prerelease semantic versions", () => {
  assert.equal(compareVersions("1.2.0", "1.1.9"), 1);
  assert.equal(compareVersions("1.2.0-beta.2", "1.2.0-beta.10"), -1);
  assert.equal(compareVersions("1.2.0", "1.2.0-beta.10"), 1);
  assert.equal(compareVersions("v1.2.0", "1.2.0"), 0);
});

test("does not install when the current version is latest", async () => {
  const calls = [];
  const result = await updateCli({
    currentVersion: "1.2.0",
    runCommand: async (command, args) => {
      calls.push([command, args]);
      return { stdout: '"1.2.0"' };
    }
  });
  assert.equal(result.updated, false);
  assert.equal(result.updateAvailable, false);
  assert.equal(calls.length, 1);
});

test("check mode reports an update without installing it", async () => {
  const calls = [];
  const result = await updateCli({
    currentVersion: "1.2.0",
    checkOnly: true,
    runCommand: async (command, args) => {
      calls.push([command, args]);
      return { stdout: '"1.3.0"' };
    }
  });
  assert.equal(result.updateAvailable, true);
  assert.equal(result.updated, false);
  assert.equal(calls.length, 1);
});

test("force never downgrades a local version newer than npm latest", async () => {
  const calls = [];
  const result = await updateCli({
    currentVersion: "1.3.0",
    force: true,
    runCommand: async (command, args) => {
      calls.push([command, args]);
      return { stdout: '"1.2.0"' };
    }
  });
  assert.equal(result.currentAhead, true);
  assert.equal(result.updated, false);
  assert.equal(calls.length, 1);
});

test("installs the latest package globally when an update exists", async () => {
  const calls = [];
  const result = await updateCli({
    currentVersion: "1.2.0",
    runCommand: async (command, args) => {
      calls.push([command, args]);
      return calls.length === 1 ? { stdout: '"1.3.0"' } : { stdout: "installed" };
    }
  });
  assert.equal(result.updated, true);
  assert.deepEqual(calls[1][1], ["install", "--global", "@demox-site/cli@latest"]);
});

test("surfaces npm install failures", async () => {
  let call = 0;
  await assert.rejects(
    updateCli({
      currentVersion: "1.2.0",
      runCommand: async () => {
        call += 1;
        if (call === 1) return { stdout: '"1.3.0"' };
        throw Object.assign(new Error("permission denied"), { stderr: "EACCES" });
      }
    }),
    /CLI 更新失败: EACCES/
  );
});
