const path = require("node:path");
const { spawn } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function resolveCommand(command) {
  if (process.platform !== "win32") {
    return command;
  }

  if (command === "npm" || command === "npx") {
    return `${command}.cmd`;
  }

  return command;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const resolvedCommand = resolveCommand(command);
    const isWindowsCmd = process.platform === "win32" && resolvedCommand.endsWith(".cmd");
    const child = spawn(
      isWindowsCmd ? process.env.ComSpec || "cmd.exe" : resolvedCommand,
      isWindowsCmd ? ["/d", "/s", "/c", resolvedCommand, ...args] : args,
      {
      cwd: options.cwd ?? REPO_ROOT,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: options.capture === false ? "inherit" : ["ignore", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";

    if (options.capture !== false) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

async function runSpec(spec) {
  const [command, ...args] = spec;
  const result = await runCommand(command, args, { capture: false });
  if (result.code !== 0) {
    throw new Error(`${command} exited with code ${result.code}`);
  }
}

async function getStagedFiles() {
  const result = await runCommand("git", [
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=ACMR",
  ]);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "Unable to inspect staged files.");
  }
  return result.stdout
    .split(/\r?\n/u)
    .map((line) => toPosixPath(line.trim()))
    .filter(Boolean);
}

function isMarkdownFile(file) {
  return file.endsWith(".md");
}

function selectSpecs(mode, changedFiles = []) {
  if (mode === "pre-commit") {
    const docsFiles = changedFiles.filter(isMarkdownFile);
    if (docsFiles.length === 0) {
      return [];
    }
    return [
      ["npm", "run", "docs:lint", "--", ...docsFiles],
      ["npm", "run", "docs:links", "--", ...docsFiles],
    ];
  }
  return [["npm", "run", "check"]];
}

async function runHook(mode) {
  if (mode !== "pre-commit" && mode !== "pre-push") {
    throw new Error("Expected hook mode to be pre-commit or pre-push.");
  }

  const changedFiles = mode === "pre-commit" ? await getStagedFiles() : [];
  const specs = selectSpecs(mode, changedFiles);

  if (specs.length === 0) {
    process.stdout.write(`[hooks] No matching repo commands for ${mode}. Skipping.\n`);
  } else {
    process.stdout.write(
      `[hooks] ${mode} repo commands: ${JSON.stringify(specs)} for files ${JSON.stringify(changedFiles)}\n`
    );
    for (const spec of specs) {
      await runSpec(spec);
    }
  }
}

module.exports = {
  REPO_ROOT,
  getStagedFiles,
  isMarkdownFile,
  resolveCommand,
  runCommand,
  runHook,
  selectSpecs,
  toPosixPath,
};
