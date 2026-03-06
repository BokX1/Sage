const { runHook } = require("./lib.cjs");

runHook("pre-push").catch((error) => {
  process.stderr.write(`[hooks] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
