// WOW-024: admin navigation registry and menu bar. Offline; reads src files only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  ADMIN_NAV, HIDDEN_REASONS, SECTION_ORDER, visibleEntries, shouldShowAdminNav, renderAdminNavBar,
} from '../src/lib/admin-nav-registry';
import { SECTIONS } from '../src/components/admin/SystemNav';

const ROOT = join(import.meta.dirname, '..');
const PAGES = join(ROOT, 'src', 'pages');
const ADMIN_DIR = join(PAGES, 'admin');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.astro') ? [p] : [];
  });
}
/** src/pages/admin/**.astro → route ('/admin/x'; index becomes its parent path). */
const routeFiles = walk(ADMIN_DIR).map((f) => '/' + relative(PAGES, f).replace(/\\/g, '/').replace(/\.astro$/, '').replace(/\/index$/, ''));
const routeSet = new Set(routeFiles);

const hrefsIn = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
/** Hub links: literal hrefs plus `route: '/admin/...'` literals (its Start-here row). */
const hubLinks = (src: string) => [...hrefsIn(src), ...[...src.matchAll(/route: '([^']+)'/g)].map((m) => m[1])];
// Hub source (slice B). Before slice B exists this is the login-only page.
const HUB_FILE = join(ADMIN_DIR, 'index.astro');
const HUB_COMPONENT = join(ROOT, 'src', 'components', 'admin', 'AdminHub.astro');

// The 8 order-path and candidate-write routes, fixed here (held-back list, N4).
const MUST_HIDE = [
  '/admin/demo-execution', '/admin/execution-control', '/admin/live-execution', '/admin/live-readiness',
  '/admin/execution-candidates', '/admin/signals', '/admin/portfolio', '/admin/kalshi-lab',
];

test('N1: every admin page file has exactly one registry entry, and nothing else does', () => {
  const regRoutes = ADMIN_NAV.map((x) => x.route);
  assert.equal(new Set(regRoutes).size, regRoutes.length, 'duplicate registry route');
  assert.deepEqual([...regRoutes].sort(), [...routeSet].sort());
  const count = (s: string) => ADMIN_NAV.filter((x) => x.section === s).length;
  const visible = ['today', 'markets', 'grading', 'risk', 'odds', 'weather', 'system', 'team'].reduce((a, s) => a + count(s), 0);
  assert.equal(ADMIN_NAV.length, 115);
  assert.equal(visible, 47);
  assert.equal(count('research'), 31);
  assert.equal(count('external'), 4);
  assert.equal(count('hidden'), 33);
});

test('N2: every href rendered by the bar, the Hub and SECTIONS is a real route', () => {
  const bar = renderAdminNavBar('/admin/wagers');
  const hub = existsSync(HUB_COMPONENT) ? readFileSync(HUB_COMPONENT, 'utf8') : '';
  const hrefs = [
    ...hrefsIn(bar).filter((h) => h.startsWith('/admin')),
    ...SECTIONS.flatMap((s) => s.items.map((i) => i.href)),
    ...hubLinks(hub).filter((h) => h.startsWith('/admin')),
  ];
  assert.ok(hrefs.length > 50);
  for (const h of hrefs) assert.ok(routeSet.has(h.split('?')[0]), `no route file for ${h}`);
  // the bar's search form posts to a real route
  assert.ok(bar.includes('action="/admin/search"'));
});

test('N3: no hidden route appears in the bar, the Hub, SECTIONS or the search data', () => {
  const hidden = ADMIN_NAV.filter((x) => x.section === 'hidden').map((x) => x.route);
  const bar = renderAdminNavBar('/admin/system/alert-log');
  const shown = new Set([
    ...hrefsIn(bar),
    ...SECTIONS.flatMap((s) => s.items.map((i) => i.href)),
    ...(existsSync(HUB_COMPONENT) ? hubLinks(readFileSync(HUB_COMPONENT, 'utf8')) : []),
  ]);
  for (const h of hidden) assert.ok(!shown.has(h), `hidden route rendered: ${h}`);
  // AdminSearch searches SECTIONS (checked above) and nothing else.
  const searchSrc = readFileSync(join(ROOT, 'src', 'components', 'admin', 'AdminSearch.tsx'), 'utf8');
  assert.ok(/from '\.\/SystemNav'/.test(searchSrc));
  for (const h of hidden) assert.ok(!searchSrc.includes(`'${h}'`), `hidden route in search source: ${h}`);
  // The Hub's section cards come only from entriesFor (never the whole registry, which holds hidden pages).
  if (existsSync(HUB_COMPONENT)) {
    const hub = readFileSync(HUB_COMPONENT, 'utf8');
    assert.ok(hub.includes('entriesFor('), 'Hub cards use entriesFor');
    assert.ok(!/ADMIN_NAV/.test(hub), 'Hub must not read ADMIN_NAV directly');
    assert.ok(hubLinks(hub).filter((h) => h.startsWith('/admin')).length >= 4, 'Start-here links found');
  }
});

test('N4: the 8 order-path and candidate-write routes are hidden (fixed list)', () => {
  for (const r of MUST_HIDE) {
    const x = ADMIN_NAV.find((y) => y.route === r);
    assert.ok(x, `missing ${r}`);
    assert.equal(x!.section, 'hidden', `${r} must be hidden`);
    assert.ok(x!.hiddenReason === 'order-path' || x!.hiddenReason === 'candidate-write', `${r} reason`);
  }
  const bar = renderAdminNavBar('/admin');
  for (const r of MUST_HIDE) assert.ok(!hrefsIn(bar).includes(r));
});

test('N5: the bar shows only on admin paths and only with a session', () => {
  for (const p of ['/', '/venues', '/wagers', '/weatherboard', '/administrator', '/admins', '/what-is-wes', '/api/admin/x']) {
    assert.equal(shouldShowAdminNav(p, true), false, p);
    assert.equal(shouldShowAdminNav(p, false), false, p);
  }
  assert.equal(shouldShowAdminNav('/admin', false), false);
  assert.equal(shouldShowAdminNav('/admin/', false), false);
  assert.equal(shouldShowAdminNav('/admin', true), true);
  assert.equal(shouldShowAdminNav('/admin/system/alert-log', true), true);
  // BaseLayout must use the helper rather than its own path test.
  const layout = readFileSync(join(ROOT, 'src', 'components', 'layout', 'BaseLayout.astro'), 'utf8');
  assert.ok(layout.includes('shouldShowAdminNav('), 'BaseLayout gates the bar with shouldShowAdminNav');
});

test('N6: every hidden entry has a reason from the six codes; visible ones have none', () => {
  for (const x of ADMIN_NAV) {
    if (x.section === 'hidden') assert.ok(x.hiddenReason && HIDDEN_REASONS.includes(x.hiddenReason), `${x.route} reason`);
    else assert.equal(x.hiddenReason, undefined, `${x.route} has a reason but is visible`);
  }
});

test('N7: the Hub makes no fetch and imports no Redis beyond requireAdmin', () => {
  for (const f of [HUB_FILE, HUB_COMPONENT].filter(existsSync)) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!src.includes('fetch('), `${f} contains fetch(`);
    assert.ok(!/from ['"][^'"]*\/redis['"]/.test(src), `${f} imports redis`);
    assert.ok(!/getRedis\(/.test(src), `${f} calls getRedis`);
    for (const m of [...src.matchAll(/from ['"]([^'"]+)['"]/g)].map((x) => x[1])) {
      assert.ok(/admin-auth|BaseLayout|AdminLogin|AdminHub|admin-nav-registry/.test(m), `${f} unexpected import ${m}`);
    }
  }
});

test('sections: every section in SECTION_ORDER has entries; SECTIONS mirrors the visible registry', () => {
  for (const s of SECTION_ORDER) assert.ok(ADMIN_NAV.some((x) => x.section === s.id), s.id);
  const visibleRoutes = visibleEntries().map((x) => x.route).filter((r) => r !== '/admin').sort();
  assert.deepEqual(SECTIONS.flatMap((s) => s.items.map((i) => i.href)).sort(), visibleRoutes);
});
