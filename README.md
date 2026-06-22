# accessibility-scanner-cli

Run real **axe-core WCAG** accessibility checks on any URL — from your terminal or CI.
Fails the build on new violations, so accessibility can't silently regress.
Uses your **system Chrome** (via `playwright-core`, no bundled-browser download).

It also resolves color-contrast that axe leaves as "needs review" when text sits on a
**CSS gradient**: a gradient is defined by its stops, so the worst-case contrast is at one
of them — the CLI measures there and returns a real pass/fail.

By [accessibilityscanner.app](https://accessibilityscanner.app) — save history & monitor
sites for regressions in the cloud.

## Install

```bash
npm i -g accessibility-scanner-cli      # or: npx accessibility-scanner-cli <url>
```

## Use

```bash
a11y-scan https://example.com
a11y-scan https://example.com https://example.com/pricing --fail-on critical
a11y-scan https://example.com --json > report.json
```

Exit code is **non-zero** when a violation at or above `--fail-on` is found (default
`serious`) — perfect as a CI gate.

| Option | Default | |
|---|---|---|
| `--fail-on <level>` | `serious` | `minor` · `moderate` · `serious` · `critical` · `none` |
| `--json` | off | machine-readable output |
| `--chrome <path>` | `chrome` channel | or set `CHROME_PATH` |
| `--timeout <secs>` | `30` | per-page navigation timeout |

## GitHub Action

```yaml
# .github/workflows/accessibility.yml
name: Accessibility
on: [pull_request]
jobs:
  a11y:
    runs-on: ubuntu-latest   # ships Google Chrome
    steps:
      - uses: Bishop81/accessibility-scanner-cli@v0.1.0
        with:
          urls: https://staging.example.com
          fail-on: serious
```

Prefer plain `npx`? `- run: npx --yes accessibility-scanner-cli <url> --fail-on serious`.

## Why
Overlay widgets fake compliance; this tells the truth. Automated checks cover the
machine-testable subset of WCAG — the rest still needs a human, and we never claim
otherwise. For multi-page audits, scheduled monitoring, regression alerts, and shareable
reports, see [accessibilityscanner.app](https://accessibilityscanner.app).

## License
MIT
