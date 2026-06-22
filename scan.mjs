#!/usr/bin/env node
// accessibility-scanner-cli — run axe-core against URLs from the terminal / CI.
// Exits non-zero when violations at/above the --fail-on threshold are found, so
// it works as a CI gate. Uses playwright-core + your system Chrome (no bundled
// browser download). By accessibilityscanner.app.

import { chromium } from 'playwright-core';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const axePath = require.resolve('axe-core');

const SEVERITY = ['minor', 'moderate', 'serious', 'critical'];
const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', yellow: '\x1b[33m', blue: '\x1b[34m', gray: '\x1b[90m',
  green: '\x1b[32m', magenta: '\x1b[35m',
};
const impactColor = { critical: C.red, serious: C.yellow, moderate: C.blue, minor: C.gray };

function parseArgs(argv) {
  const opts = { urls: [], failOn: 'serious', json: false, chromePath: process.env.CHROME_PATH || '', timeout: 30000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fail-on') opts.failOn = argv[++i];
    else if (a === '--json') opts.json = true;
    else if (a === '--chrome') opts.chromePath = argv[++i];
    else if (a === '--timeout') opts.timeout = parseInt(argv[++i], 10) * 1000;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a.startsWith('-')) { console.error(`Unknown option: ${a}`); process.exit(2); }
    else opts.urls.push(a);
  }
  return opts;
}

function help() {
  console.log(`
${C.bold}a11y-scan${C.reset} — WCAG accessibility checks for the command line / CI

${C.bold}Usage${C.reset}
  a11y-scan <url> [url...] [options]

${C.bold}Options${C.reset}
  --fail-on <level>   Exit non-zero if a violation at/above this level is found.
                      one of: minor | moderate | serious | critical | none   (default: serious)
  --json              Output machine-readable JSON instead of a report.
  --chrome <path>     Path to Chrome/Chromium (or set CHROME_PATH). Defaults to the 'chrome' channel.
  --timeout <secs>    Per-page navigation timeout (default: 30).
  -h, --help          Show this help.

${C.bold}Examples${C.reset}
  a11y-scan https://example.com
  a11y-scan https://example.com https://example.com/pricing --fail-on critical
  CHROME_PATH=/usr/bin/google-chrome a11y-scan https://example.com --json

  ${C.dim}Save history & monitor regressions at https://accessibilityscanner.app${C.reset}
`);
}

async function scanUrl(browserCtx, url, timeout) {
  const page = await browserCtx.newPage();
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch { /* chatty page */ }
    await page.addScriptTag({ path: axePath });
    const out = await page.evaluate(async () => {
      const r = await window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
        resultTypes: ['violations', 'incomplete', 'passes'],
      });

      // Resolve color-contrast axe punted on over a CSS gradient (worst-case at a
      // stop → real pass/fail). Mirrors scripts/scan.mjs — keep in sync.
      try {
        const ci = r.incomplete.findIndex((x) => x.id === 'color-contrast');
        if (ci !== -1) {
          const entry = r.incomplete[ci];
          const parseRgb = (s) => { const m = (s || '').match(/rgba?\(([^)]+)\)/i); if (!m) return null; const p = m[1].split(',').map((x) => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
          const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
          const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
          const contrast = (a, b) => { const hi = Math.max(lum(a), lum(b)), lo = Math.min(lum(a), lum(b)); return (hi + 0.05) / (lo + 0.05); };
          const keep = [], failed = [];
          for (const node of entry.nodes) {
            try {
              const sel = Array.isArray(node.target) ? node.target[node.target.length - 1] : node.target;
              const el = document.querySelector(sel);
              if (!el) { keep.push(node); continue; }
              const cs = getComputedStyle(el);
              const fg = parseRgb(cs.color);
              if (!fg) { keep.push(node); continue; }
              const fontPx = parseFloat(cs.fontSize) || 16, weight = parseInt(cs.fontWeight, 10) || 400;
              const required = (fontPx >= 24 || (fontPx >= 18.66 && weight >= 700)) ? 3 : 4.5;
              let bg = null;
              for (let hop = el; hop; hop = hop.parentElement) { const bi = getComputedStyle(hop).backgroundImage; if (bi && bi.indexOf('gradient(') !== -1) { bg = bi; break; } }
              if (!bg || bg.indexOf('url(') !== -1) { keep.push(node); continue; }
              const stops = (bg.match(/rgba?\([^)]+\)/gi) || []).map(parseRgb).filter(Boolean);
              if (!stops.length || stops.some((s) => s.a < 1)) { keep.push(node); continue; }
              let worst = Infinity; for (const s of stops) worst = Math.min(worst, contrast(fg, s));
              if (worst < required) { failed.push(node); }
            } catch (e) { keep.push(node); }
          }
          if (keep.length) { entry.nodes = keep; } else { r.incomplete.splice(ci, 1); }
          if (failed.length) {
            let v = r.violations.find((x) => x.id === 'color-contrast');
            if (!v) { v = { id: entry.id, impact: entry.impact || 'serious', help: entry.help, helpUrl: entry.helpUrl, nodes: [] }; r.violations.push(v); }
            for (const n of failed) v.nodes.push(n);
          }
        }
      } catch (e) { /* never break the scan */ }

      return {
        violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, nodes: v.nodes.length })),
        incomplete: r.incomplete.length,
        passes: r.passes.length,
      };
    });
    return { url, httpStatus: res ? res.status() : null, ...out };
  } catch (e) {
    return { url, error: e?.message || 'scan failed', violations: [], incomplete: 0, passes: 0 };
  } finally {
    await page.close();
  }
}

function printReport(results, failOn) {
  for (const r of results) {
    console.log(`\n${C.bold}${r.url}${C.reset} ${C.gray}${r.httpStatus ? `(HTTP ${r.httpStatus})` : ''}${C.reset}`);
    if (r.error) { console.log(`  ${C.red}error: ${r.error}${C.reset}`); continue; }
    const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
    r.violations.forEach((v) => { counts[v.impact] = (counts[v.impact] || 0) + 1; });
    console.log(`  ${C.red}${counts.critical} critical${C.reset}  ${C.yellow}${counts.serious} serious${C.reset}  ${C.blue}${counts.moderate} moderate${C.reset}  ${C.gray}${counts.minor} minor${C.reset}  ${C.magenta}${r.incomplete} review${C.reset}  ${C.green}${r.passes} passed${C.reset}`);
    for (const v of r.violations) {
      const col = impactColor[v.impact] || C.gray;
      console.log(`    ${col}●${C.reset} ${col}${(v.impact || 'minor').padEnd(8)}${C.reset} ${v.id} ${C.gray}(${v.nodes})${C.reset} — ${v.help}`);
    }
  }
}

function worstViolation(results) {
  let worst = -1;
  for (const r of results) for (const v of r.violations) worst = Math.max(worst, SEVERITY.indexOf(v.impact));
  return worst; // -1 = none
}

(async () => {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || opts.urls.length === 0) { help(); process.exit(opts.help ? 0 : 2); }

  let browser;
  try {
    browser = await chromium.launch({
      executablePath: opts.chromePath || undefined,
      channel: opts.chromePath ? undefined : 'chrome',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
  } catch (e) {
    console.error(`${C.red}Could not launch Chrome.${C.reset} Set --chrome <path> or CHROME_PATH. (${e?.message || e})`);
    process.exit(2);
  }

  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (compatible; A11yScanBot/0.1; +accessibilityscanner.app)' });
  const results = [];
  for (const url of opts.urls) results.push(await scanUrl(ctx, url, opts.timeout));
  await browser.close();

  if (opts.json) {
    process.stdout.write(JSON.stringify({ results }, null, 2) + '\n');
  } else {
    printReport(results, opts.failOn);
  }

  // CI gate: exit non-zero if anything at/above the threshold was found.
  if (opts.failOn !== 'none') {
    const threshold = SEVERITY.indexOf(opts.failOn);
    const worst = worstViolation(results);
    if (worst >= threshold) {
      if (!opts.json) console.log(`\n${C.red}${C.bold}✗ Failing:${C.reset} found violations at or above "${opts.failOn}".`);
      process.exit(1);
    }
  }
  if (!opts.json) console.log(`\n${C.green}✓ Passed the "${opts.failOn}" threshold.${C.reset}`);
  process.exit(0);
})();
