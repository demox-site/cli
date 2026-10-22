import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";

import { DemoxClient } from "../dist/api/client.js";

const execFileAsync = promisify(execFile);

test("project db API methods call website-api actions", async () => {
  const client = new DemoxClient();
  const calls = [];
  client.callApi = async (...args) => {
    calls.push(args);
    return { ok: true };
  };

  await client.listProjectTables("PROJ1", "tok");
  await client.createProjectTable(
    "PROJ1",
    "notes",
    [{ name: "id", type: "text", primary: true }],
    "tok"
  );
  await client.getProjectTable("PROJ1", "notes", "tok");
  await client.listProjectRows("PROJ1", "notes", "tok", { limit: 10, after: "a" });
  await client.putProjectRow("PROJ1", "notes", { id: "1", title: "hi" }, "tok");
  await client.deleteProjectRow("PROJ1", "notes", "1", "tok");
  await client.deleteProjectTable("PROJ1", "notes", "tok");
  await client.getProjectDbUsage("PROJ1", "tok");
  await client.createProject({ name: "Demo", slug: "demo" }, "tok");

  assert.deepEqual(
    calls.map(([path, body]) => ({ path, action: body.action, projectId: body.projectId })),
    [
      { path: "/website/list-project-tables", action: "list_project_tables", projectId: "PROJ1" },
      { path: "/website/create-project-table", action: "create_project_table", projectId: "PROJ1" },
      { path: "/website/get-project-table", action: "get_project_table", projectId: "PROJ1" },
      { path: "/website/list-project-rows", action: "list_project_rows", projectId: "PROJ1" },
      { path: "/website/put-project-row", action: "put_project_row", projectId: "PROJ1" },
      { path: "/website/delete-project-row", action: "delete_project_row", projectId: "PROJ1" },
      { path: "/website/delete-project-table", action: "delete_project_table", projectId: "PROJ1" },
      { path: "/website/get-project-db-usage", action: "get_project_db_usage", projectId: "PROJ1" },
      { path: "/website/create-project", action: "create_project", projectId: undefined },
    ]
  );
});

test("db help exposes table and row commands", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["dist/cli.js", "db", "--help"], {
    cwd: process.cwd(),
  });

  assert.match(stdout, /tables/);
  assert.match(stdout, /create-table/);
  assert.match(stdout, /describe/);
  assert.match(stdout, /drop-table/);
  assert.match(stdout, /rows/);
  assert.match(stdout, /put/);
  assert.match(stdout, /delete-row/);
  assert.match(stdout, /usage/);
  assert.match(stdout, /100MB/);
});

test("projects help exposes create", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["dist/cli.js", "projects", "--help"], {
    cwd: process.cwd(),
  });

  assert.match(stdout, /create/);
  assert.match(stdout, /最多 3/);
});
