#!/usr/bin/env bash
# ============================================================
# push.sh — push the School Exam Analytics System to GitHub.
#
# Usage:
#   bash push.sh
#
# Prompts for your GitHub repo URL, adds it as 'origin',
# and pushes. See README.md for prerequisites.
# ============================================================
set -e

echo
echo "────────────────────────────────────────────────────────"
echo "  Push School Exam Analytics to GitHub"
echo "────────────────────────────────────────────────────────"
echo

# 1. Ensure a git repo
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "❌ Not inside a git repo. Run this from the project folder."
  exit 1
fi

# Pick the default branch name from the current branch
BRANCH=$(git branch --show-current || echo "main")

# 2. Current repo URL (if already set, reuse it)
REMOTE=$(git config --get remote.origin.url || true)
if [ -n "$REMOTE" ]; then
  echo "ℹ️  A remote is already configured: $REMOTE"
  read -r -p "   Push to this remote? [Y/n]: " reuse
  if [[ "$reuse" =~ ^[Nn]$ ]]; then
    REMOTE=""
  fi
fi

# 3. Ask for the repo URL if we don't have one
if [ -z "$REMOTE" ]; then
  echo
  echo "Paste your GitHub repo URL (ends in .git)."
  echo "Example: https://github.com/yourname/school-exam-analytics.git"
  echo "(If the repo doesn't exist yet, create one at https://github.com/new —"
  echo " leave it empty, no README.)"
  echo
  read -r -p "Repo URL: " REMOTE
  if [ -z "$REMOTE" ]; then
    echo "❌ No URL given. Exiting."
    exit 1
  fi
  git remote add origin "$REMOTE" || git remote set-url origin "$REMOTE"
fi

# 4. Rename current branch to 'main' if needed
if [ "$BRANCH" != "main" ]; then
  git branch -M main
  echo "ℹ️  Branch renamed to 'main'."
fi

# 5. Commit any uncommitted changes (so your push is up to date)
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ℹ️  Committing any uncommitted changes..."
  git add -A
  git commit -m "Update" >/dev/null 2>&1 || echo "   (nothing new to commit)"
fi

# 6. Push
echo
echo "Pushing to: $REMOTE  (branch: main)"
echo
echo "If it asks for a password, DON'T type your account password —"
echo "use a Personal Access Token instead. See the notes below."
echo
if git push -u origin main; then
  echo
  echo "✅  Pushed successfully!"
  echo "    Visit: ${REMOTE%.git}"
  echo "    Next: open it in Codespaces, or deploy to Render/Railway/Fly."
else
  echo
  echo "❌  Push failed. Common fixes:"
  echo "    - repo URL is wrong (must end in .git)"
  echo "    - repo was created non-empty (README/.gitignore checked) -> recreate empty"
  echo "    - auth failed -> use a Personal Access Token (see notes)"
  echo "    - branch name mismatch -> run: git push -u origin main"
fi
echo
