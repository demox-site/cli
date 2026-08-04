#!/usr/bin/env node

import("../dist/cli.js").catch((error) => {
  console.error("Failed to start CLI:", error.message);
  process.exit(1);
});
