#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

found=0
for dir in extensions/*/; do
  [ -f "$dir/package.json" ] || continue
  # check if package.json has a "sync" script
  node -e "
    const pkg = require('./$dir/package.json');
    process.exit(pkg.scripts?.sync ? 0 : 1);
  " 2>/dev/null || continue
  found=1
  echo "==> syncing $(basename "$dir")"
  npm run --silent --prefix "$dir" sync
done

if [ "$found" -eq 0 ]; then
  echo "No extension sync scripts found."
fi
