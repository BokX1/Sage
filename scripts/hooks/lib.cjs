const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const POLICY_PATH = path.join(REPO_ROOT, "config", "tooling", "hook-gates.json");
const LOCAL_EXTENSION_PATH = path.join(REPO_ROOT, ".agent", "workflows", "hook-gate.cjs");

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function uniqueSpecs(specs) {
  const seen = new Set();
  const unique = [];
  for (const spec of specs) {
    const key = JSON.stringify(spec);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(spec);
  }
  return unique;
}

function pathExists(targetPath) {
  return fs.existsSync(targetPath);
}

function readPolicy() {
  return JSON.parse(fs.readFileSync(POLICY_PATH, "utf8"));
}

function matchesExact(file, values) {
  return values.includes(file);
}

function matchesPrefix(file, prefixes) {
  return prefixes.some((prefix) => file.startsWith(prefix));
}

function matchesExtension(file, extensions) {
  return extensions.some((extension) => file.endsWith(extension));
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

async function getChangedFiles(mode) {
  if (mode === "pre-commit") {
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

  let diffArgs = ["show", "--pretty=", "--name-only", "HEAD"];
  const upstream = await runCommand("git", [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}",
  ]);

  if (upstream.code === 0) {
    diffArgs = ["diff", "--name-only", `${upstream.stdout.trim()}...HEAD`];
  }

  const result = await runCommand("git", diffArgs);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "Unable to inspect pushed files.");
  }

  return result.stdout
    .split(/\r?\n/u)
    .map((line) => toPosixPath(line.trim()))
    .filter(Boolean);
}

function withFiles(specs, files) {
  return specs.map((spec) => [...spec, ...files]);
}

function selectSpecs(mode, changedFiles, policy) {
  const specs = [];

  const hasLintScope = changedFiles.some(
    (file) => matchesPrefix(file, policy.lint_prefixes) || matchesExact(file, policy.lint_exact)
  );
  const hasBuildScope = changedFiles.some(
    (file) => matchesPrefix(file, policy.build_prefixes) || matchesExact(file, policy.build_exact)
  );
  const hasTrustScope = changedFiles.some(
    (file) => matchesPrefix(file, policy.trust_prefixes) || matchesExact(file, policy.trust_exact)
  );
  const hasWebsiteScope = changedFiles.some(
    (file) =>
      matchesPrefix(file, policy.website_prefixes) || matchesExact(file, policy.website_exact)
  );
  const docsFiles = changedFiles.filter(
    (file) => matchesExtension(file, policy.docs_extensions) || matchesExact(file, policy.docs_exact)
  );

  if (mode === "pre-commit") {
    if (hasLintScope) {
      specs.push(...policy.commands.pre_commit_lint);
    }
    if (docsFiles.length > 0) {
      specs.push(...withFiles(policy.commands.docs_lint, docsFiles));
    }
    return uniqueSpecs(specs);
  }

  if (hasTrustScope) {
    specs.push(...policy.commands.pre_push_trust);
  } else if (hasBuildScope) {
    specs.push(...policy.commands.pre_push_check);
    specs.push(...policy.commands.pre_push_build);
  } else if (hasLintScope) {
    specs.push(...policy.commands.pre_push_check);
  }

  if (hasWebsiteScope) {
    specs.push(...policy.commands.website_check);
  }

  if (docsFiles.length > 0) {
    specs.push(...withFiles(policy.commands.docs_lint, docsFiles));
    specs.push(...withFiles(policy.commands.docs_links, docsFiles));
  }

  return uniqueSpecs(specs);
}

async function runHook(mode) {
  if (mode !== "pre-commit" && mode !== "pre-push") {
    throw new Error("Expected hook mode to be pre-commit or pre-push.");
  }

  const changedFiles = await getChangedFiles(mode);
  const policy = readPolicy();
  const specs = selectSpecs(mode, changedFiles, policy);

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

  if (pathExists(LOCAL_EXTENSION_PATH)) {
    await runSpec(["node", ".agent/workflows/hook-gate.cjs", mode]);
  }
}

module.exports = {
  LOCAL_EXTENSION_PATH,
  POLICY_PATH,
  REPO_ROOT,
  getChangedFiles,
  pathExists,
  readPolicy,
  resolveCommand,
  runCommand,
  runHook,
  selectSpecs,
  toPosixPath,
};
