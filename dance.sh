#!/bin/bash
# dance.sh - The Release Dance

echo "💃 Commencing the Release Dance for v9.0.1 💃"

# 1. Stage all changes
git add .

# 2. Commit
git commit -m "chore(release): v9.0.1 - Manifest-Driven Core & Legacy Doc Migration"

# 3. Tag (optional, but good practice)
# git tag v9.0.1

# 4. Status check
echo "✨ Status Check ✨"
git status

echo "🕺 Dance Complete! Ready to push. 🕺"
