import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import { test } from "node:test";

import {
  buildAuthorizeUrl,
  OAuthManager,
  OAUTH_DEFAULT_SCOPES,
  OAUTH_REDIRECT_URI,
} from "../dist/auth/oauth.js";
import {
  createPkceChallenge,
  createPkcePair,
  isValidPkceChallenge,
  isValidPkceVerifier,
} from "../dist/auth/pkce.js";

test("createPkcePair yields RFC 7636 S256 verifier and challenge", () => {
  const { verifier, challenge } = createPkcePair();
  assert.equal(verifier.length, 43);
  assert.equal(challenge.length, 43);
  assert.equal(isValidPkceVerifier(verifier), true);
  assert.equal(isValidPkceChallenge(challenge), true);
  assert.equal(createPkceChallenge(verifier), challenge);
  assert.equal(
    createHash("sha256").update(verifier, "ascii").digest("base64url"),
    challenge
  );
});

test("buildAuthorizeUrl includes PKCE S256 and code response_type", () => {
  const { challenge } = createPkcePair();
  const url = new URL(
    buildAuthorizeUrl({
      clientId: "demox-mcp-client",
      authUrl: "https://www.demox.site/mcp-authorize",
      state: "state-with-at-least-16",
      codeChallenge: challenge,
    })
  );

  assert.equal(url.origin + url.pathname, "https://www.demox.site/mcp-authorize");
  assert.equal(url.searchParams.get("client_id"), "demox-mcp-client");
  assert.equal(url.searchParams.get("redirect_uri"), OAUTH_REDIRECT_URI);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), "state-with-at-least-16");
  assert.equal(url.searchParams.get("code_challenge"), challenge);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(
    url.searchParams.get("scope"),
    OAUTH_DEFAULT_SCOPES.join(" ")
  );
  assert.equal(url.searchParams.get("access_token"), null);
});

test("exchangeAuthorizationCode posts code_verifier to /oauth/token", async () => {
  const { verifier } = createPkcePair();
  let seenBody = null;
  const server = http.createServer((req, res) => {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/oauth/token");
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      seenBody = JSON.parse(raw);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          access_token: "access-from-exchange",
          refresh_token: "refresh-from-exchange",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "website:list website:deploy",
          user_id: "user-xyz",
        })
      );
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const previous = process.env.DEMOX_API_URL;
  process.env.DEMOX_API_URL = `http://127.0.0.1:${port}`;

  try {
    const oauth = new OAuthManager();
    const before = Date.now();
    const token = await oauth.exchangeAuthorizationCode("auth-code-1", verifier);
    assert.deepEqual(seenBody, {
      grant_type: "authorization_code",
      client_id: "demox-mcp-client",
      redirect_uri: OAUTH_REDIRECT_URI,
      code: "auth-code-1",
      code_verifier: verifier,
    });
    assert.equal(token.accessToken, "access-from-exchange");
    assert.equal(token.refreshToken, "refresh-from-exchange");
    assert.equal(token.userId, "user-xyz");
    assert.deepEqual(token.scopes, ["website:list", "website:deploy"]);
    assert.ok(token.expiresAt >= before + 3600 * 1000 - 1000);
    assert.ok(token.expiresAt <= before + 3600 * 1000 + 5000);
  } finally {
    if (previous === undefined) delete process.env.DEMOX_API_URL;
    else process.env.DEMOX_API_URL = previous;
    await new Promise((resolve) => server.close(resolve));
  }
});

test("exchangeAuthorizationCode surfaces oauth error_description", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "invalid_grant",
        error_description: "PKCE 校验失败",
      })
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const previous = process.env.DEMOX_API_URL;
  process.env.DEMOX_API_URL = `http://127.0.0.1:${port}`;
  try {
    const oauth = new OAuthManager();
    await assert.rejects(
      () => oauth.exchangeAuthorizationCode("bad", createPkcePair().verifier),
      /PKCE 校验失败/
    );
  } finally {
    if (previous === undefined) delete process.env.DEMOX_API_URL;
    else process.env.DEMOX_API_URL = previous;
    await new Promise((resolve) => server.close(resolve));
  }
});
