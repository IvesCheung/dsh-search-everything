# Changelog

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
