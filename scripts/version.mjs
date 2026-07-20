#!/usr/bin/env node
// One version for the whole repo: `[workspace.package].version` in the root
// Cargo.toml. Everything else either derives it natively — the seven crates via
// `version.workspace`, the Python wheel via maturin, the Gradle subprojects via
// gradle.properties — or is mirrored here.
//
//   node scripts/version.mjs --check       verify nothing has drifted (CI gate)
//   node scripts/version.mjs --current     print the version the repo declares
//   node scripts/version.mjs --set 0.21.0  bump the source and every mirror
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = new URL("../", import.meta.url);
const abs = (relative) => fileURLToPath(new URL(relative, repoRoot));
const read = (relative) => readFileSync(abs(relative), "utf8");

const SEMVER = /^\d+\.\d+\.\d+[\w.-]*$/;

// The canonical declaration. Every mirror below is rewritten to match it.
const SOURCE = {
  file: "Cargo.toml",
  pattern: /^version = "(.+?)"$/m,
  label: "workspace.package",
};

// Manifests with no way to reference the Cargo version natively.
const MIRRORS = [
  {
    file: "sdks/node/package.json",
    pattern: /^(  "version": ")(.+?)(",)$/m,
    label: "npm package",
  },
  {
    file: "sdks/java/gradle.properties",
    pattern: /^(version=)(.+)()$/m,
    label: "Gradle projects",
  },
  {
    file: "sdks/python/taskito/__init__.py",
    pattern: /^(    __version__ = ")(.+?)(")$/m,
    label: "Python source-tree fallback",
  },
];

// Checked, never written: release notes are authored by hand, but shipping a
// version with no section of its own is a mistake worth failing CI over.
const CHANGELOG = {
  file: "CHANGELOG.md",
  pattern: /^## (\d+\.\d+\.\d+[\w.-]*)$/m,
  label: "latest CHANGELOG section",
};

// Files that must keep deriving the version instead of restating it — a
// hardcoded literal here would silently win over the source.
function guards() {
  const crates = readdirSync(abs("crates")).map((crate) => ({
    file: `crates/${crate}/Cargo.toml`,
    pattern: /^version = "/m,
    hint: "use `version.workspace = true`",
  }));
  return [
    ...crates,
    {
      file: "sdks/python/pyproject.toml",
      pattern: /^version = "/m,
      hint: 'use `dynamic = ["version"]` so maturin reads Cargo.toml',
    },
    ...["", "spring/", "processor/", "test-support/", "graalvm-smoke/"].map(
      (project) => ({
        file: `sdks/java/${project}build.gradle.kts`,
        pattern: /^version = "/m,
        hint: "set `version` in sdks/java/gradle.properties",
      }),
    ),
  ];
}

// Reads the single capture the pattern is expected to find, or explains where
// the file stopped matching — a silent miss would let drift through the gate.
function extract({ file, pattern, label }, group = 1) {
  const found = read(file).match(pattern);
  if (!found) {
    throw new Error(`${file}: no ${label} version found (pattern drifted?)`);
  }
  return found[group];
}

function sourceVersion() {
  const version = extract(SOURCE);
  if (!SEMVER.test(version)) {
    throw new Error(`${SOURCE.file}: "${version}" is not a semantic version`);
  }
  return version;
}

function check() {
  const expected = sourceVersion();
  const problems = [];

  for (const mirror of [...MIRRORS, CHANGELOG]) {
    const actual = extract(mirror, mirror === CHANGELOG ? 1 : 2);
    const status = actual === expected ? "ok" : `MISMATCH (${actual})`;
    console.log(`  ${actual === expected ? "✓" : "✗"} ${mirror.file} — ${status}`);
    if (actual !== expected) {
      problems.push(`${mirror.file} declares ${actual}, expected ${expected}`);
    }
  }

  for (const { file, pattern, hint } of guards()) {
    if (pattern.test(read(file))) {
      problems.push(`${file} hardcodes a version — ${hint}`);
    }
  }

  if (problems.length > 0) {
    console.error(`\nVersion drift (source of truth: ${expected}):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error("\nRun `node scripts/version.mjs --set <version>` to resync.");
    process.exit(1);
  }
  console.log(`\nAll manifests agree on ${expected}.`);
}

function set(next) {
  if (!SEMVER.test(next)) {
    throw new Error(`"${next}" is not a semantic version`);
  }
  const previous = sourceVersion();

  writeFileSync(
    abs(SOURCE.file),
    read(SOURCE.file).replace(SOURCE.pattern, `version = "${next}"`),
  );
  for (const { file, pattern } of MIRRORS) {
    writeFileSync(
      abs(file),
      read(file).replace(pattern, (_, before, __, after) => `${before}${next}${after}`),
    );
  }

  console.log(`${previous} -> ${next}`);
  console.log(`  ${[SOURCE.file, ...MIRRORS.map((m) => m.file)].join("\n  ")}`);
  console.log(`\nAdd a \`## ${next}\` section to CHANGELOG.md to complete the bump.`);
}

const [command, argument] = process.argv.slice(2);
try {
  if (command === "--check") check();
  else if (command === "--current") console.log(sourceVersion());
  else if (command === "--set" && argument) set(argument);
  else {
    console.error("usage: version.mjs --check | --current | --set <version>");
    process.exit(2);
  }
} catch (error) {
  console.error(`version: ${error.message}`);
  process.exit(1);
}
