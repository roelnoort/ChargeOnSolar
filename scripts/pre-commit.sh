#!/bin/sh
# Factory agents commit through this same hook in GitHub Actions.
# Both checks read the working tree, so a partially staged file is checked as
# it is on disk, not as it will be committed.
# Tests stay in `pnpm check`: the suite will outgrow a commit-time budget.

logs=$(mktemp -d)
trap 'rm -rf "$logs"' EXIT

# Without a global pnpm, put corepack's copy (pinned by `packageManager`) on
# the PATH, so scripts that call pnpm themselves find it too.
if ! command -v pnpm >/dev/null 2>&1; then
  mkdir "$logs/bin"
  printf '#!/bin/sh\nexec corepack pnpm "$@"\n' >"$logs/bin/pnpm"
  chmod +x "$logs/bin/pnpm"
  PATH="$logs/bin:$PATH"
fi

run() {
  name=$1
  shift
  ("$@" >"$logs/$name.log" 2>&1 || touch "$logs/$name.failed") &
}

run biome pnpm exec biome check --staged --no-errors-on-unmatched
run typecheck pnpm typecheck:all
wait

status=0
for failed in "$logs"/*.failed; do
  [ -e "$failed" ] || continue
  name=$(basename "$failed" .failed)
  echo "✖ $name failed:"
  cat "$logs/$name.log"
  echo
  status=1
done
exit $status
