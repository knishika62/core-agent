#!/usr/bin/env bash
# Builds all four distributable binaries (TUI + GUI, macOS + Windows) and
# assembles dist-bin/ into a self-contained folder someone can hand to a
# tester: skills copied in (with the node_modules/.bin symlinks that break a
# plain copy onto Windows stripped out — see docs/binary-build.md), plus a
# .env template. See docs/binary-build.md for the full rationale.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Only remove what this script itself (re)generates — dist-bin/ can also
# hold hand-maintained files (e.g. dist-bin/README.md) that nothing else
# regenerates; a blanket `rm -rf dist-bin` deletes those permanently, since
# dist-bin/ is gitignored and unrecoverable via git. Learned the hard way.
echo "==> Cleaning previous binaries/skills/env.example (leaving anything else in dist-bin/ alone)"
rm -rf dist-bin/macos-arm64 dist-bin/windows-x64 dist-bin/skills dist-bin/env.example
mkdir -p dist-bin

echo "==> Building TUI + GUI binaries (macOS + Windows)"
npm run package

echo "==> Copying skills/ into dist-bin/skills"
mkdir -p dist-bin/skills
# Allowlist, not a blocklist: only these two generic skills are meant for
# public distribution. Anything else under skills/ (environment-specific —
# hardcoded local server IPs, personal setup) is skipped by default, so a
# script meant for a public repo never has to name what it's excluding.
DISTRIBUTABLE_SKILLS="mail_send pdf_export"
for name in $DISTRIBUTABLE_SKILLS; do
  skill_dir="skills/$name/"
  if [ ! -d "$skill_dir" ]; then
    continue
  fi
  cp -R "$skill_dir" "dist-bin/skills/$name"
  # A plain copy of node_modules/.bin's symlinks (npm's CLI shortcuts, e.g.
  # `marked`, `browsers`) fails on Windows — nothing in these skills
  # actually invokes them (they import the packages directly), so the
  # simplest fix is to not ship them at all.
  if [ -d "dist-bin/skills/$name/node_modules/.bin" ]; then
    rm -rf "dist-bin/skills/$name/node_modules/.bin"
  fi
done

echo "==> Copying .env.example -> dist-bin/env.example"
cp .env.example dist-bin/env.example

echo
echo "==> Done. Contents of dist-bin/:"
find dist-bin -type f -exec ls -lh {} \; | awk '{printf "  %-8s %s\n", $5, $NF}'
