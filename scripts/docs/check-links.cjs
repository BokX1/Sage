const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CONFIG_PATH = path.join(REPO_ROOT, "config", "tooling", "docs-links.json");

function pathExists(targetPath) {
  return fs.existsSync(targetPath);
}

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function unique(items) {
  return [...new Set(items)];
}

function parseArgs(argv) {
  const options = {};
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) {
      positionals.push(current);
      continue;
    }

    const eqIndex = current.indexOf("=");
    if (eqIndex !== -1) {
      options[current.slice(2, eqIndex)] = current.slice(eqIndex + 1);
      continue;
    }

    const key = current.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return { options, positionals };
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

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

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function stripCodeFences(content) {
  const lines = content.split(/\r?\n/u);
  const kept = [];
  let inFence = false;

  for (const line of lines) {
    if (/^\s*```/u.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) {
      kept.push(line);
    }
  }

  return kept.join("\n");
}

function githubSlug(input) {
  return input
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/gu, "")
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .trim()
    .replace(/\s+/gu, "-")
    .replace(/-+/gu, "-");
}

function extractAnchors(content) {
  const headings = stripCodeFences(content).split(/\r?\n/u);
  const anchors = new Set();
  const duplicateCounts = new Map();

  for (const line of headings) {
    const headingMatch = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/u);
    if (headingMatch) {
      const baseSlug = githubSlug(headingMatch[1]);
      if (baseSlug) {
        const seen = duplicateCounts.get(baseSlug) ?? 0;
        duplicateCounts.set(baseSlug, seen + 1);
        anchors.add(seen === 0 ? baseSlug : `${baseSlug}-${seen}`);
      }
    }

    for (const htmlMatch of line.matchAll(
      /<a\s+[^>]*?(?:id|name)=["']([^"']+)["'][^>]*>/giu
    )) {
      anchors.add(htmlMatch[1]);
    }
  }

  return anchors;
}

function parseLinkTarget(rawTarget) {
  let target = rawTarget.trim();
  if (target.startsWith("<") && target.endsWith(">")) {
    return target.slice(1, -1).trim();
  }

  const titleSplit = target.match(/^(\S+)(?:\s+["'][^"']*["'])?$/u);
  if (titleSplit) {
    target = titleSplit[1];
  }

  return target.trim();
}

function extractMarkdownTargets(content) {
  const stripped = stripCodeFences(content);
  const targets = [];

  for (const match of stripped.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) {
    targets.push(parseLinkTarget(match[1]));
  }

  for (const match of stripped.matchAll(/<[^>]+\b(?:href|src)=["']([^"']+)["'][^>]*>/giu)) {
    targets.push(match[1].trim());
  }

  for (const match of stripped.matchAll(/\bhttps?:\/\/[^\s<>"')\]]+/gu)) {
    targets.push(match[0].trim().replace(/[`.,;:]+$/u, ""));
  }

  return unique(targets.filter(Boolean));
}

function normalizeAnchorValue(value) {
  return String(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/^#+/u, "")
    .replace(/\uFE0F/gu, "")
    .replace(/^[^a-z0-9]+/gu, "")
    .replace(/[^\p{Letter}\p{Number}-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function hasAnchor(anchors, targetAnchor) {
  if (targetAnchor === "top") {
    return true;
  }

  if (anchors.has(targetAnchor)) {
    return true;
  }

  const normalizedTarget = normalizeAnchorValue(targetAnchor);
  if (!normalizedTarget) {
    return false;
  }

  for (const anchor of anchors) {
    if (normalizeAnchorValue(anchor) === normalizedTarget) {
      return true;
    }
  }

  return false;
}

async function listMarkdownFiles(config) {
  const files = [];

  for (const args of [
    ["ls-files", "--", "*.md"],
    ["ls-files", "--others", "--exclude-standard", "--", "*.md"],
  ]) {
    const result = await runCommand("git", args);
    if (result.code !== 0) {
      continue;
    }
    for (const line of result.stdout.split(/\r?\n/u)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const asPosix = toPosixPath(trimmed);
      if (config.ignore_path_prefixes.some((prefix) => asPosix.startsWith(prefix))) {
        continue;
      }
      files.push(path.resolve(REPO_ROOT, trimmed));
    }
  }

  return unique(files).filter((filePath) => pathExists(filePath));
}

function isExternal(target) {
  return /^https?:\/\//iu.test(target);
}

function isSkippedExternal(target, config) {
  let url;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  if (config.skip_local_hosts.includes(url.hostname)) {
    return true;
  }

  return config.skip_external_patterns.some((pattern) => new RegExp(pattern, "u").test(target));
}

function splitTarget(target) {
  const hashIndex = target.indexOf("#");
  if (hashIndex === -1) {
    return { pathPart: target, anchor: "" };
  }
  return {
    pathPart: target.slice(0, hashIndex),
    anchor: target.slice(hashIndex + 1),
  };
}

async function checkExternal(target, config) {
  try {
    new URL(target);
  } catch {
    return { ok: false, skipped: false, status: "invalid-url" };
  }

  if (isSkippedExternal(target, config)) {
    return { ok: true, skipped: true, status: "skipped" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeout_ms);

  try {
    const headResponse = await fetch(target, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
    });

    if (headResponse.status >= 200 && headResponse.status < 400) {
      return { ok: true, skipped: false, status: headResponse.status };
    }

    const getResponse = await fetch(target, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
    });

    return {
      ok: getResponse.status >= 200 && getResponse.status < 400,
      skipped: false,
      status: getResponse.status,
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      status: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveRelativeTarget(sourceFile, target, anchorCache) {
  const { pathPart, anchor } = splitTarget(target);

  if (!pathPart) {
    return {
      exists: true,
      anchorPath: sourceFile,
      anchor,
      anchorExists: anchor ? hasAnchor(anchorCache.get(sourceFile), anchor) : true,
    };
  }

  const candidatePath = pathPart.startsWith("/")
    ? path.resolve(REPO_ROOT, pathPart.slice(1))
    : path.resolve(path.dirname(sourceFile), pathPart);

  if (!pathExists(candidatePath)) {
    return {
      exists: false,
      path: candidatePath,
      anchor,
    };
  }

  if (anchor) {
    if (!anchorCache.has(candidatePath) && candidatePath.endsWith(".md")) {
      const content = await fsp.readFile(candidatePath, "utf8");
      anchorCache.set(candidatePath, extractAnchors(content));
    }

    return {
      exists: true,
      path: candidatePath,
      anchorPath: candidatePath,
      anchor,
      anchorExists:
        !candidatePath.endsWith(".md") || !anchor
          ? true
          : hasAnchor(anchorCache.get(candidatePath), anchor),
    };
  }

  return {
    exists: true,
    path: candidatePath,
    anchor,
    anchorExists: true,
  };
}

async function writeReport(reportPath, report) {
  await fsp.mkdir(path.dirname(reportPath), { recursive: true });
  await fsp.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function main() {
  const { options, positionals } = parseArgs(process.argv.slice(2));
  const config = readConfig();
  const files =
    positionals.length > 0
      ? positionals
          .map((file) => path.resolve(REPO_ROOT, file))
          .filter((filePath) => pathExists(filePath) && filePath.endsWith(".md"))
      : await listMarkdownFiles(config);

  const report = {
    generated_utc: new Date().toISOString(),
    checked_files: [],
    relative_links_checked: 0,
    external_urls_checked: 0,
    skipped_external_urls: [],
    failures: [],
  };

  if (files.length === 0) {
    if (options.report) {
      await writeReport(path.resolve(REPO_ROOT, options.report), report);
    }
    process.stdout.write("No markdown files selected. Skipping docs link check.\n");
    return;
  }

  const anchorCache = new Map();
  const externalTargets = new Set();

  for (const filePath of files) {
    const content = await fsp.readFile(filePath, "utf8");
    anchorCache.set(filePath, extractAnchors(content));
  }

  for (const filePath of files) {
    const content = await fsp.readFile(filePath, "utf8");
    const targets = extractMarkdownTargets(content);
    report.checked_files.push(toPosixPath(path.relative(REPO_ROOT, filePath)));

    for (const target of targets) {
      if (!target || target.startsWith("mailto:") || target.startsWith("data:")) {
        continue;
      }

      if (isExternal(target)) {
        externalTargets.add(target);
        continue;
      }

      const resolved = await resolveRelativeTarget(filePath, target, anchorCache);
      report.relative_links_checked += 1;

      if (!resolved.exists) {
        report.failures.push({
          file: toPosixPath(path.relative(REPO_ROOT, filePath)),
          target,
          reason: "missing-relative-target",
        });
        continue;
      }

      if (resolved.anchor && resolved.anchorExists === false) {
        report.failures.push({
          file: toPosixPath(path.relative(REPO_ROOT, filePath)),
          target,
          reason: "missing-anchor",
        });
      }
    }
  }

  for (const target of [...externalTargets].sort((left, right) => left.localeCompare(right))) {
    const result = await checkExternal(target, config);
    if (result.skipped) {
      report.skipped_external_urls.push(target);
      process.stdout.write(`SKIP ${target}\n`);
      continue;
    }

    report.external_urls_checked += 1;
    if (result.ok) {
      process.stdout.write(`OK   ${result.status} ${target}\n`);
      continue;
    }

    report.failures.push({
      file: "<external>",
      target,
      reason: `external-check-failed:${result.status}`,
    });
    process.stdout.write(`FAIL ${result.status} ${target}\n`);
  }

  if (options.report) {
    await writeReport(path.resolve(REPO_ROOT, options.report), report);
  }

  if (report.failures.length > 0) {
    process.stderr.write(`Docs link check failed with ${report.failures.length} issue(s).\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write("All link checks passed.\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
