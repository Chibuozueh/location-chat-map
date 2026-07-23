# Native CSV folder

Drop one or more `.csv` (or `.tsv`) files in this folder and the atlas will
auto-load them on mount. Files in `public/` are served from the project root
at build time.

## Canonical name

The app probes these filenames in order; the first one that returns 200 OK
wins:

  1. `/data/atlas.csv`
  2. `/data/assets.csv`

If you want a different filename, edit `NATIVE_CSV_PATHS` in
`src/state/imported-data.tsx`.

## Behavior

- A successful load **replaces** the 12 curated default Atlanta assets
  (`mergeAssets({ replace: true })`).
- The parsed snapshot is cached in `localStorage` under
  `atlas.nativeCsv.v1` so subsequent loads are instant.
- Pressing the chat's **× Clear import** chip wipes the cache and reverts to
  the seed defaults.
