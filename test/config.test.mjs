import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { loadConfig } from "../dist/utils/config.js";

const ENV_NAMES = [
  "DEMOX_CLIENT_ID",
  "DEMOX_SITE_URL",
  "DEMOX_AUTH_URL",
  "DEMOX_API_BASE",
  "DEMOX_API_URL",
  "DEMOX_CLOUD_FUNCTION_URL",
  "DEMOX_WEBSITE_API_URL",
];
const originalEnv = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));

function clearConfigEnv() {
  for (const name of ENV_NAMES) delete process.env[name];
}

afterEach(() => {
  for (const name of ENV_NAMES) {
    const value = originalEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("uses public Demox defaults without environment variables", () => {
  clearConfigEnv();

  assert.deepEqual(loadConfig(), {
    clientId: "demox-mcp-client",
    siteUrl: "https://www.demox.site",
    authUrl: "https://www.demox.site/mcp-authorize",
    apiBase: "https://www.demox.site",
    cloudFunctionUrl: "https://api.demox.site",
    websiteApiUrl: "https://api.demox.site",
  });
});

test("keeps self-hosted overrides", () => {
  clearConfigEnv();
  process.env.DEMOX_CLIENT_ID = "custom-client";
  process.env.DEMOX_SITE_URL = "https://demox.example/";
  process.env.DEMOX_API_URL = "https://api.demox.example/";

  assert.deepEqual(loadConfig(), {
    clientId: "custom-client",
    siteUrl: "https://demox.example",
    authUrl: "https://demox.example/mcp-authorize",
    apiBase: "https://demox.example",
    cloudFunctionUrl: "https://api.demox.example",
    websiteApiUrl: "https://api.demox.example",
  });
});
