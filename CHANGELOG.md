# Changelog

## 0.3.1

- Scope selection is a real dropdown instead of an always-expanding pill row: the control keeps a single
  capsule width in the tab row, opens a menu listing every workspace with its message count, marks the
  workspace you are currently in, and closes on pick, on outside click or on `Esc`.
- The dropdown is keyboard driven: `Ctrl W` opens it, `↑`/`↓` walk the entries, `Enter` applies, `Esc`
  closes and returns to the input. The chosen entry carries a check mark; hovering and moving are the same
  highlight, so the mouse and the keyboard never disagree about what is selected.
- `screenshots/scope.png` re-shot for the dropdown.

## 0.3.0

- **Search scope.** The palette can be limited to one workspace: a scope pill sits at the right end of the
  tab row and shows the workspace the open conversation belongs to, so results stop at the boundary of the
  work you are doing; "all workspaces" is one click away.
- The scope row lists every workspace with its message count, follows the current workspace, and is
  reachable from the keyboard (`Ctrl W` toggles it, `←`/`→` walk the workspaces) without leaving the input.
- Scoping really narrows the scan instead of filtering afterwards: documents are grouped per workspace and
  only the selected group is read. On a 230-session / 31 MB corpus a query drops from 32 ms to 4 ms
  (`scripts/bench-scope.mjs`).
- New `GET /dsh-search-everything-api/workspaces` returns workspaces aggregated by working directory
  (sessions, messages, characters, last activity); `query` and `sessions` accept `scope=<cwd>`.
- Windows paths are normalised for comparison, so `C:\work\alpha` and `C:/work/alpha` are one workspace.

## 0.2.0

- The index is now persisted to disk (`$DSH_HOME/storages/dsh-search-everything/`), so a restart no
  longer re-decompresses every session log. On a 229-session / 31 MB corpus the first start builds in
  ~4.6 s and writes a 37 MB index; later starts restore it in **~340 ms** and then only re-read files
  whose mtime or size changed.
- Writes are debounced (1.2 s), atomic (temp file + rename) and versioned: a format or root mismatch
  discards the cache instead of serving stale text.
- New `GET /dsh-search-everything-api/flush` writes the index on demand; the plugin also flushes when
  it is disposed.
- New `cacheDir` config (set it to an empty string to turn persistence off).
- `stats` now reports `cache: { enabled, hit, loadMs, bytes, savedAt, path }`.
- `scripts/bench-cache.mjs` measures cold build vs warm restore on the local corpus.

## 0.1.2

- Result list is grouped into one section per session, with a hairline separator between sections and
  between results, and a hit-count pill in each section header.
- Each result is now two rows instead of three: the matched snippet (up to two lines) on top, and a meta
  row with role, time and the tail of the working directory underneath. The session title moved to the
  section header, so nothing is repeated on every row.
- The active row gets a left keyline plus a hairline border, so the focus is obvious at a glance.
- Hover feedback on rows, and long paths are truncated from the head instead of overflowing.

## 0.1.1

- Refreshing is on demand instead of every 5 s: opening the palette triggers one incremental scan
  (`GET /dsh-search-everything-api/refresh`), so an idle host does no disk I/O at all. On a 229-session
  corpus the scan costs ~0.8 s and re-reads only files whose mtime/size changed.
- New `lazyRefreshMs` (default 0 = off) if you would rather have queries rescan when the index is stale.
- Concurrent refresh calls now share one scan.

## 0.1.0

First public release.

- Ctrl K global search palette with four tabs: All / Sessions / My messages / Assistant replies.
- Indexes every session of every workspace under `~/.dsh/sessions` (titles, user messages, assistant replies).
- Queries run as an in-memory linear scan: 10–90 ms over ~30 MB of text.
- Clicking a result switches workspace, switches session, scrolls back to the message and highlights it for 2.6 s.
- Archived sessions are unarchived before opening.
- Refreshing is on demand: the palette triggers one incremental scan when it opens (only files whose
  mtime/size changed are re-read); nothing polls the disk in between. Optional `refreshIntervalMs`
  and `lazyRefreshMs` keep the old timer / lazy behaviour available.
