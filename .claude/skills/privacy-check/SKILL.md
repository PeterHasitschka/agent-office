---
name: privacy-check
description: Scan the agent-office working tree, staged changes and full git history for private or employer-specific terms, personal paths and real agent names before a commit, push, release or publishing. Use before committing or pushing, when asked "is this safe to publish", or after adding fixtures, screenshots, demo data or docs.
---

# Privacy check

agent-office is developed against real Claude Code sessions, so real project names, paths and agent names can slip into fixtures, docs, screenshots or commit messages. This check finds them. The list of private terms is personal and lives **outside git**.

## The term list

`.superpowers/private-names.txt` (git-ignored): one case-insensitive term per line, `#` for comments. If it does not exist, ask the user which names must never appear (employer, clients, internal project and agent names, ticket numbers) and create it there. Never commit it, never quote its contents in commits, docs or code.

Always also check generic leaks, independent of the list:

- home paths: `/Users/<name>/`, `/home/<name>/`, `C:\\Users\\<name>\\`
- e-mail addresses other than `@example.com` and git author lines
- `docs/superpowers/` (planning notes; git-ignored on purpose)

## Run it

```sh
L=.superpowers/private-names.txt
P=$(grep -vE '^\s*(#|$)' "$L" | paste -sd'|' -)

# 1. working tree + staged (tracked files and new files not ignored)
git grep -nIiE "$P" -- . ; git diff --cached | grep -inE "$P"
git ls-files -co --exclude-standard | xargs grep -lIiE "$P" 2>/dev/null

# 2. full history: file contents and commit messages
git log -p --all -i -G"$P" --format='@@ %h %s' | grep -iE "^@@|^[+-].*($P)"
git log --all --format='%h %s%n%b' | grep -iE "$P"

# 3. generic leaks
git grep -nIE '/Users/[a-z]|/home/[a-z]|C:\\\\Users' -- ':!*.test.ts'
git ls-files docs/superpowers
```

Short terms produce false positives (e.g. a substring inside a longer word); judge each hit. Binary files (PNG) are not grepped: look at every new screenshot yourself and make sure it shows demo data only.

## If something is found

- **Only in the working tree / staged:** replace with an invented name and re-run.
- **Already committed but not pushed:** rewrite history. Make a backup first (`git bundle create ../backup.bundle --all`), then:

  ```sh
  git filter-repo --force --invert-paths --path <file-or-dir>     # drop a file everywhere
  git filter-repo --force --replace-text replacements.txt          # 'old==>new' per line
  ```

  Keep `replacements.txt` outside the repo. Re-run all checks afterwards, including `git cat-file --batch-all-objects --batch | grep -aiE "$P"`, which should only hit author lines.
- **Already pushed:** stop and tell the user. Rewriting public history needs a force push and the data may already be cached or forked; that is their call.

Report the result plainly: what was scanned, which hits, what was changed.
