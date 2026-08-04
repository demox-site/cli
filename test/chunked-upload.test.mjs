import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { uploadFileInChunks } from "../dist/utils/chunked-upload.js";

const tempDir = await mkdtemp(path.join(tmpdir(), "demox-chunk-test-"));
after(() => rm(tempDir, { recursive: true, force: true }));

test("uploads a file larger than 8 MiB without a large request body", async () => {
  const source = Buffer.alloc(9 * 1024 * 1024 + 17, 0x5a);
  const filePath = path.join(tempDir, "large.zip");
  await writeFile(filePath, source);

  const chunks = [];
  let largestRequest = 0;
  const result = await uploadFileInChunks({
    filePath,
    fileName: "large.zip",
    websiteId: "HF4ODMTF",
    callApi: async (payload) => {
      largestRequest = Math.max(largestRequest, Buffer.byteLength(JSON.stringify(payload)));
      if (payload.action === "init_deploy_upload") {
        return { success: true, uploadId: "upload-1", chunkSize: 2 * 1024 * 1024, totalChunks: 5 };
      }
      if (payload.action === "upload_deploy_chunk") {
        const chunk = Buffer.from(payload.chunkBase64, "base64");
        assert.equal(createHash("sha256").update(chunk).digest("hex"), payload.chunkSha256);
        chunks[payload.chunkIndex] = chunk;
        return { success: true };
      }
      if (payload.action === "complete_deploy_upload") {
        assert.deepEqual(Buffer.concat(chunks), source);
        return { success: true, url: "https://hf4odmtf.demox.site/" };
      }
      throw new Error(`unexpected action: ${payload.action}`);
    }
  });

  assert.equal(result.success, true);
  assert.ok(largestRequest < 4 * 1024 * 1024);
});
