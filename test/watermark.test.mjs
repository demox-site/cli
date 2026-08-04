import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";

import { DemoxClient } from "../dist/api/client.js";

const execFileAsync = promisify(execFile);

test("watermark API sends the site setting to website-api", async () => {
  const client = new DemoxClient();
  const calls = [];
  client.callApi = async (...args) => {
    calls.push(args);
    return { success: true, hideWatermark: args[1].hideWatermark };
  };

  const hidden = await client.setWatermark("SITE1234", true, "test-token");
  const shown = await client.setWatermark("SITE1234", false, "test-token");

  assert.equal(hidden.hideWatermark, true);
  assert.equal(shown.hideWatermark, false);
  assert.deepEqual(calls.map(([path, body, token]) => ({ path, body, token })), [
    {
      path: "/website/update-watermark",
      body: { action: "update_watermark", websiteId: "SITE1234", hideWatermark: true },
      token: "test-token"
    },
    {
      path: "/website/update-watermark",
      body: { action: "update_watermark", websiteId: "SITE1234", hideWatermark: false },
      token: "test-token"
    }
  ]);
});

test("website list maps the persisted watermark setting", async () => {
  const client = new DemoxClient();
  client.callApi = async () => ({
    websites: [
      { website_id: "HIDDEN1", hide_watermark: 1 },
      { website_id: "VISIBLE1", hide_watermark: 0 }
    ]
  });

  const websites = await client.listWebsites("test-token");
  assert.equal(websites[0].hideWatermark, true);
  assert.equal(websites[1].hideWatermark, false);
});

test("watermark help exposes explicit hide and show commands", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["dist/cli.js", "watermark", "--help"], {
    cwd: process.cwd()
  });

  assert.match(stdout, /hide <websiteId>/);
  assert.match(stdout, /show <websiteId>/);
  assert.match(stdout, /pro\/admin/);
});
