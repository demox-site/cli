import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";

import { DemoxClient } from "../dist/api/client.js";

const execFileAsync = promisify(execFile);

test("subdomain API requests do not send a configurable suffix", async () => {
  const client = new DemoxClient();
  const calls = [];
  client.callApi = async (...args) => {
    calls.push(args);
    return args[1].action === "check_subdomain"
      ? { success: true, available: true }
      : { success: true, url: "https://example.demox.site/" };
  };

  await client.checkSubdomain("example", "test-token", "SITE1234");
  await client.setSubdomain("SITE1234", "example", "test-token");

  assert.deepEqual(calls.map(([path, body, token]) => ({ path, body, token })), [
    {
      path: "/website/check-subdomain",
      body: { action: "check_subdomain", subdomain: "example", websiteId: "SITE1234" },
      token: "test-token"
    },
    {
      path: "/website/set-subdomain",
      body: { action: "set_subdomain", websiteId: "SITE1234", subdomain: "example" },
      token: "test-token"
    }
  ]);
});

test("domain command help only documents demox.site subdomains", async () => {
  for (const command of [null, "check", "set"]) {
    const args = ["dist/cli.js", "domain"];
    if (command) args.push(command);
    args.push("--help");
    const { stdout } = await execFileAsync(
      process.execPath,
      args,
      { cwd: process.cwd() }
    );
    assert.doesNotMatch(stdout, /--domain/);
    assert.doesNotMatch(stdout, /vibeme\.cn/);
    assert.doesNotMatch(stdout, /<domain>/);
  }

  const { stdout } = await execFileAsync(
    process.execPath,
    ["dist/cli.js", "domain", "--help"],
    { cwd: process.cwd() }
  );
  assert.match(stdout, /<subdomain>\.demox\.site/);
});
