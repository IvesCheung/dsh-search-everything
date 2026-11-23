---
name: Bug report
about: Something in the palette or the index behaves differently from what the README says
title: ''
labels: bug
assignees: ''
---

**What happened**
A clear description of the wrong behaviour.

**What you expected**
What the README led you to expect.

**How to reproduce**
1. Open the palette with ...
2. Type the query `...`
3. Click the result for ...

**Query and scope**
- Query typed: `...`
- Scope: all workspaces / <which workspace>

**For a jump problem**
- [ ] The palette did not switch session at all
- [ ] It switched session but did not scroll to the hit
- [ ] It scrolled, but the highlight landed on the wrong message

**Environment**
- DSH version (`dsh --version`):
- OS:
- Install method (`dsh plugin --profile web add github:IvesCheung/dsh-search-everything`, a local path, ...):
- Plugin version (from `package.json`):

**Console and logs**
Paste anything red from the browser console, and the host side of `/dsh-search-everything-api/stats`
if you can reach it.

**Screenshots**
Optional. Please crop out anything private from your own sessions.
