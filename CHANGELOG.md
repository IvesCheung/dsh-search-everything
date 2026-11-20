# Changelog

## 0.1.0

First public release.

- Ctrl K global search palette with four tabs: All / Sessions / My messages / Assistant replies.
- Indexes every session of every workspace under `~/.dsh/sessions` (titles, user messages, assistant replies).
- Queries run as an in-memory linear scan: 10–90 ms over ~30 MB of text.
- Clicking a result switches workspace, switches session, scrolls back to the message and highlights it for 2.6 s.
- Archived sessions are unarchived before opening.
- Incremental scan: every 5 s only files whose mtime/size changed are re-read.
