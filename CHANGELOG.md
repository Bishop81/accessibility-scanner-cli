# Changelog

## 0.2.0

### Scans now load the whole page before testing

Previously the scan ran as soon as the network went quiet, which meant it only ever saw
what was above the fold. Anything behind `loading="lazy"`, an `IntersectionObserver`, or a
scroll-triggered animation never rendered, so its problems were never reported.

The scan now scrolls the document to force that content in, waits for images, fonts and
entrance transitions, then runs axe.

**This will find more issues on the same page, and it may fail builds that passed on
0.1.0.** On one real site the count went from 3 colour-contrast violations to 12 —
identical colours throughout, the other nine simply had not loaded. Those nine were always
broken; the previous version could not see them.

If a pipeline starts failing after upgrading, the new findings are real. Raise
`--fail-on`, or pin `accessibility-scanner-cli@0.1.0` while you work through them.

Also fixed: text was sometimes measured part-way through a fade-in, reporting a colour at
an opacity no visitor ever sees.

### Slower, deliberately

Expect roughly 4s → 9s per page. The scroll pass is bounded at 12s and degrades to the old
behaviour on a page it cannot scroll, so a hostile or infinite-scroll page cannot hang a
build. Raise `--timeout` if you scan very large pages.
