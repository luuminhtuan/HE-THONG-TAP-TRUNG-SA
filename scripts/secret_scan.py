"""Mẫu nhận diện khoá lộ + hàm quét một khối chữ — phần lõi của scripts/audit_secrets.py.

Tách khỏi audit_secrets.py (16/11/2026) để file đó còn dưới 300 dòng: ở đây chỉ có MẪU (regex)
và hàm quét thuần, không gọi git, không in gì. audit_secrets.py lo phần duyệt lịch sử git / cây
làm việc và in báo cáo.

File này chứa chính các regex nên tự loại mình khỏi lượt quét (EXCLUDE_FRAGMENTS), như
audit_secrets.py trước đây.
"""
import re

# ── Patterns ──────────────────────────────────────────────────────────────
# Each pattern: (name, severity, regex, min_len_for_match)
# severity: "high" → confident leak, "medium" → likely, "low" → context-dependent
PATTERNS = [
    ("openai-key",      "high",
     re.compile(r"sk-(?:proj-|svcacct-|None-)?[A-Za-z0-9_\-]{32,}"), 36),
    ("anthropic-key",   "high",
     re.compile(r"sk-ant-(?:api|admin)?[A-Za-z0-9_\-]{32,}"), 40),
    ("meta-token",      "high",
     re.compile(r"\bEA[A-Za-z0-9]{180,}"), 180),
    ("github-pat",      "high",
     re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b"), 40),
    ("aws-access-key",  "high",
     re.compile(r"\bAKIA[0-9A-Z]{16}\b"), 20),
    # Poscake / Pancake API keys: 32 hex. False-positive prone, only flag near
    # variable names that imply secret context.
    ("poscake-key-ctx", "high",
     re.compile(
         r"(?i)(?:POSCAKE|PANCAKE|API[_-]?KEY|SECRET)[A-Za-z0-9_]*\s*[:=]\s*['\"]?([a-f0-9]{32})['\"]?"
     ), 32),
    # euShipments / InOut BG tokens: 56-80 char alnum, again only with context.
    ("ffm-token-ctx",   "high",
     re.compile(
         r"(?i)(?:FFM|EUSHIPMENT|INOUT|TOKEN|API[_-]?TOKEN)[A-Za-z0-9_]*\s*[:=]\s*['\"]?([A-Za-z0-9]{56,80})['\"]?"
     ), 56),
    # Hardcoded password assignments (PASS/PASSWORD/PWD = "...").
    ("password-asgn",   "medium",
     re.compile(
         r"(?i)\b(?:password|passwd|pwd|pass)\s*=\s*['\"]([^'\"\s]{8,})['\"]"
     ), 8),
    # Generic high-entropy SECRET/TOKEN/KEY assignment with long quoted value.
    ("generic-secret",  "medium",
     re.compile(
         r"(?i)\b(?:SECRET|TOKEN|API[_-]?KEY|ACCESS[_-]?KEY)[A-Za-z0-9_]*\s*=\s*['\"]([A-Za-z0-9_\-]{24,})['\"]"
     ), 24),
]

# Files to scan (git history scan filters by these patterns)
INCLUDE_GLOBS = [
    "*.py", "*.js", "*.mjs", "*.cjs", "*.ts", "*.tsx", "*.jsx",
    "*.json", "*.yaml", "*.yml", "*.toml", "*.ini", "*.cfg",
    "*.md", "*.txt",
    "*.sh", "*.bash", "*.zsh", "*.bat", "*.ps1",
    "*.env*",
    "Dockerfile*", "*.Dockerfile",
]

# Skip these path fragments (lockfiles, generated, vendored)
EXCLUDE_FRAGMENTS = [
    "node_modules/", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
    ".next/", "dist/", "build/", "__pycache__/",
    ".secrets.baseline",          # detect-secrets's own baseline (intentional)
    ".env.example",               # placeholder file
    "scripts/audit_secrets.py",   # this file (regex literals)
    "scripts/secret_scan.py",     # regex literals dời sang đây (16/11/2026)
    "memory-bank/", ".auto-memory/",
]


def mask(value: str) -> str:
    """Mask middle of a secret for display."""
    if len(value) <= 8:
        return "*" * len(value)
    keep = 4
    return f"{value[:keep]}…{value[-keep:]} ({len(value)} chars)"


def is_excluded(path: str) -> bool:
    return any(frag in path for frag in EXCLUDE_FRAGMENTS)


def scan_text(text: str) -> list:
    """Apply all patterns to a blob of text. Return list of (pattern_name, severity, match_str)."""
    hits = []
    for name, severity, rx, min_len in PATTERNS:
        for m in rx.finditer(text):
            # If pattern has a capture group, prefer it (the secret itself).
            value = m.group(1) if m.groups() else m.group(0)
            if len(value) < min_len:
                continue
            hits.append((name, severity, value, m.start()))
    return hits
