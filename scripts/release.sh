#!/bin/sh
# Publish a release to the release repository (github.com/vit-games/horazon): one commit
# with this checkout's files on top of the previous release, so the development history
# never goes there, then the tag vX.Y.Z (desktop/package.json "version"),
# which builds the installers into a draft release (.github/workflows/release.yml).
#
#   scripts/release.sh            (remote "github", or set RELEASE_REMOTE)
set -eu
cd "$(dirname "$0")/.."
remote=${RELEASE_REMOTE:-github}
version=$(node -p "require('./desktop/package.json').version")
tag="v$version"

[ -z "$(git status --porcelain)" ] || { echo "commit or stash your changes first: the release is HEAD's files" >&2; exit 1; }
# The release page is built from the version's CHANGELOG.md section.
node scripts/release-notes.mjs "$version" --check || exit 1
git fetch --quiet "$remote" main
if git ls-remote --exit-code --tags "$remote" "refs/tags/$tag" >/dev/null; then
  echo "$tag is already released" >&2
  exit 1
fi
parent=$(git rev-parse "$remote/main")
# Design and product notes (PRODUCT.md, DESIGN.md, Impeccable files and image sidecars) stay in the work repo.
private='(^|/)(PRODUCT|DESIGN)\.(md|json)$|\.webp\.json$|(^|/)\.impeccable/'
GIT_INDEX_FILE="$(git rev-parse --git-dir)/release-index"
export GIT_INDEX_FILE
rm -f "$GIT_INDEX_FILE"
git read-tree HEAD
git ls-files | grep -E "$private" | git update-index --force-remove --stdin
tree=$(git write-tree)
rm -f "$GIT_INDEX_FILE"
unset GIT_INDEX_FILE
if git ls-tree -r --name-only "$tree" | grep -E "$private"; then
  echo "these would be published: stopping" >&2
  exit 1
fi
if [ "$tree" = "$(git rev-parse "$parent^{tree}")" ]; then
  echo "nothing changed since the last release" >&2
  exit 1
fi
commit=$(git commit-tree "$tree" -p "$parent" -m "Horazon $version")
echo "release $tag: $commit (on top of $(git log -1 --format=%s "$parent"))"
git push "$remote" "$commit:refs/heads/main"
git push "$remote" "$commit:refs/tags/$tag"
