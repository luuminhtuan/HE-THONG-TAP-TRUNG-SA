#!/usr/bin/env python3
"""Audit git history for leaked secrets — project-specific patterns.

Complements the existing detect-secrets baseline (.secrets.baseline) by scanning
git history (not just working tree) for credential shapes that have actually
leaked from this repo before:

  - OpenAI keys (sk-proj-*, sk-svcacct-*, sk-...)
  - Anthropic keys (sk-ant-*)
  - Meta long-lived access tokens (EAFw...)
  - Poscake / Pancake API keys (32 hex)
  - euShipments (InOut BG) tokens (56-80 alnum)
  - VPS root password style assignments
  - Generic high-confidence assignments: PASSWORD/SECRET/TOKEN = "<long_value>"

Usage:
  python scripts/audit_secrets.py                  # scan ALL history
  python scripts/audit_secrets.py --since HEAD~50  # last 50 commits only
  python scripts/audit_secrets.py --working-tree   # current files only (no git)
  python scripts/audit_secrets.py --json           # machine-readable output

Exit code:
  0 — clean (no findings)
  1 — secrets found
  2 — invocation error
"""
import argparse
import io
import json
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

# Force UTF-8 stdout/stderr (Windows console defaults to cp1252).
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "buffer"):
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

REPO = Path(__file__).resolve().parent.parent

# Mẫu nhận diện + hàm quét thuần nằm ở secret_scan.py cạnh file này (tách 16/11/2026) — file này
# lo duyệt git / cây làm việc và in báo cáo. Nhập lại tên cũ để audit_secrets.PATTERNS… vẫn chạy.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from secret_scan import (  # noqa: E402,F401
    EXCLUDE_FRAGMENTS, INCLUDE_GLOBS, PATTERNS, is_excluded, mask, scan_text,
)


def scan_working_tree() -> dict:
    """Scan current working-tree files only (no git history)."""
    findings = defaultdict(list)
    seen = set()  # (path, line, value) to dedupe across overlapping patterns
    cmd = ["git", "ls-files"]
    try:
        files = subprocess.check_output(cmd, cwd=REPO, text=True).splitlines()
    except subprocess.CalledProcessError as e:
        sys.exit(f"git ls-files failed: {e}")

    for rel in files:
        if is_excluded(rel):
            continue
        if not any(Path(rel).match(g) for g in INCLUDE_GLOBS):
            continue
        full = REPO / rel
        try:
            text = full.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for name, severity, value, offset in scan_text(text):
            line_no = text.count("\n", 0, offset) + 1
            key = (rel, line_no, value)
            if key in seen:
                continue
            seen.add(key)
            findings[rel].append({
                "commit": "WORKING_TREE",
                "line": line_no,
                "pattern": name,
                "severity": severity,
                "preview": mask(value),
            })
    return findings


def list_commits(since: str | None) -> list:
    """Return list of commit SHAs to scan, oldest first."""
    rev = ["git", "rev-list", "--reverse"]
    rev.append(f"{since}..HEAD" if since else "--all")
    try:
        return subprocess.check_output(rev, cwd=REPO, text=True).split()
    except subprocess.CalledProcessError as e:
        sys.exit(f"git rev-list failed: {e}")


def files_in_commit(commit: str) -> list:
    """Return files added/modified in a commit, filtered by include globs."""
    try:
        out = subprocess.check_output(
            ["git", "show", "--name-only", "--pretty=format:", commit],
            cwd=REPO, text=True, errors="replace",
        )
    except subprocess.CalledProcessError:
        return []
    files = [f for f in out.splitlines() if f.strip()]
    keep = []
    for f in files:
        if is_excluded(f):
            continue
        if any(Path(f).match(g) for g in INCLUDE_GLOBS):
            keep.append(f)
    return keep


def file_at_commit(commit: str, path: str) -> str | None:
    """Return file contents at a specific commit, or None if not found."""
    try:
        return subprocess.check_output(
            ["git", "show", f"{commit}:{path}"],
            cwd=REPO, text=True, errors="replace",
            stderr=subprocess.DEVNULL,
        )
    except subprocess.CalledProcessError:
        return None


def commit_meta(commit: str) -> tuple:
    """Return (short_sha, author, date, subject)."""
    try:
        out = subprocess.check_output(
            ["git", "log", "-1", "--format=%h%x09%an%x09%ad%x09%s",
             "--date=short", commit],
            cwd=REPO, text=True, errors="replace",
        ).strip()
        parts = out.split("\t", 3)
        if len(parts) == 4:
            return tuple(parts)
    except subprocess.CalledProcessError:
        pass
    return (commit[:7], "?", "?", "?")


def scan_history(since: str | None) -> dict:
    """Walk git history, scan each touched file at the commit it was touched."""
    findings = defaultdict(list)
    seen = set()  # (commit, path, pattern, value) to dedupe
    commits = list_commits(since)
    if not commits:
        return findings

    print(f"  scanning {len(commits)} commits...", file=sys.stderr)
    for i, commit in enumerate(commits, 1):
        if i % 25 == 0:
            print(f"    {i}/{len(commits)}", file=sys.stderr)
        for rel in files_in_commit(commit):
            text = file_at_commit(commit, rel)
            if text is None:
                continue
            for name, severity, value, offset in scan_text(text):
                key = (rel, name, value)
                if key in seen:
                    continue
                seen.add(key)
                line_no = text.count("\n", 0, offset) + 1
                short, author, date, subject = commit_meta(commit)
                findings[rel].append({
                    "commit": short,
                    "author": author,
                    "date": date,
                    "subject": subject,
                    "line": line_no,
                    "pattern": name,
                    "severity": severity,
                    "preview": mask(value),
                })
    return findings


def print_report(findings: dict) -> None:
    if not findings:
        print("✓ No secrets found.")
        return
    total = sum(len(v) for v in findings.values())
    print(f"\n⚠ Found {total} potential secret(s) across {len(findings)} file(s):\n")
    for path in sorted(findings.keys()):
        print(f"  {path}")
        for hit in findings[path]:
            sev = hit["severity"].upper()
            ctx = (
                f"{hit['commit']} ({hit['date']} by {hit['author']})"
                if hit["commit"] != "WORKING_TREE" else "WORKING TREE"
            )
            print(f"    [{sev:6}] line {hit['line']:>4}  {hit['pattern']:20} → {hit['preview']}")
            print(f"             at {ctx}")
            if hit["commit"] != "WORKING_TREE":
                print(f"             subject: {hit.get('subject', '')[:80]}")
        print()


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Scan git history for leaked secrets (project-specific patterns)."
    )
    ap.add_argument("--since", metavar="REF",
                    help="Only scan commits after this ref (e.g. HEAD~50, v1.0). Default: all history.")
    ap.add_argument("--working-tree", action="store_true",
                    help="Scan only the current working tree, not git history.")
    ap.add_argument("--json", action="store_true",
                    help="Machine-readable JSON output.")
    args = ap.parse_args()

    if args.working_tree:
        print("Scanning working tree...", file=sys.stderr)
        findings = scan_working_tree()
    else:
        scope = f"history since {args.since}" if args.since else "ENTIRE git history"
        print(f"Scanning {scope}...", file=sys.stderr)
        findings = scan_history(args.since)

    if args.json:
        print(json.dumps(findings, indent=2, ensure_ascii=False))
    else:
        print_report(findings)

    return 1 if findings else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(2)
