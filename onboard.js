import "./compat.js?v=11";

/* OneBrain onboarding.
 *
 * A four-step machine over the same /v1 endpoints the dashboard uses. No
 * framework, no build step, and nothing loaded from any external host: Google
 * consent is a plain navigation through Supabase's own /authorize endpoint, and
 * Trello consent happens on Trello's own page in a new tab.
 *
 * The rule this file follows everywhere: nothing claims success it has not
 * measured. Every state a source can be in comes from a real API response, and
 * "verified" is only ever printed after a live call returned.
 */

'use strict';

document.documentElement.classList.add('js');

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const announce = (m) => { $('live').textContent = m; };

async function api(path, opts = {}) {
  return await window.OB.api(path, opts);
}
const post = (path, body) => api(path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body || {}),
});

const SOURCES = [
  { id: 'gmail', label: 'Gmail', pck: 'google-mail',
    what: 'Recent mail, minus promotions and social.' },
  { id: 'google_meet', label: 'Google Meet', pck: 'google-drive',
    what: 'Gemini meeting notes and transcripts from Drive.' },
  { id: 'trello', label: 'Trello', pck: 'trello',
    what: 'Card comments and descriptions across open boards.' },
  { id: 'google_calendar', label: 'Google Calendar', pck: 'google-calendar',
    what: 'Events, attendees and dates.' },
];

/* Brand marks, inline.
 *
 * Inline rather than linked because this page loads nothing from an external
 * host — a CDN logo would be a third-party request on a screen where someone is
 * about to authorize their email. Drawn simply and in each brand's own colours:
 * these are recognisable marks for an integration list, NOT the official brand
 * assets, which every one of these companies distributes under its own brand
 * guidelines. Swap in the official SVGs before this is a public signup page.
 */
const ICON = {
  gmail: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#fff" d="M2 6.5h20v12H2z"/>
    <path fill="#EA4335" d="M2 6.5 12 14 22 6.5v-1A1.5 1.5 0 0 0 20.5 4h-17A1.5 1.5 0 0 0 2 5.5z"/>
    <path fill="#34A853" d="M2 18.5V8l4 3v7.5z"/>
    <path fill="#4285F4" d="M22 18.5V8l-4 3v7.5z"/>
    <path fill="#FBBC04" d="M6 11 12 15.5 18 11v7.5H6z"/></svg>`,
  google_meet: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#00832D" d="M14 8v3l4-2.6v7.2L14 13v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1z"/>
    <path fill="#1A73E8" d="M3 8a1 1 0 0 1 1-1h6v10H4a1 1 0 0 1-1-1z"/>
    <path fill="#FFBA00" d="M18 8.4 20.4 6.9A1 1 0 0 1 22 7.7v8.6a1 1 0 0 1-1.6.8L18 15.6z"/></svg>`,
  trello: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <rect width="20" height="20" x="2" y="2" rx="4" fill="#0079BF"/>
    <rect width="5.5" height="12" x="5" y="5" rx="1.4" fill="#fff"/>
    <rect width="5.5" height="7.5" x="13.5" y="5" rx="1.4" fill="#fff"/></svg>`,
  google_calendar: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <rect width="18" height="18" x="3" y="3" rx="2.5" fill="#fff" stroke="#DADCE0"/>
    <path fill="#1A73E8" d="M3 5.5A2.5 2.5 0 0 1 5.5 3H8v4H3z"/>
    <path fill="#EA4335" d="M16 3h2.5A2.5 2.5 0 0 1 21 5.5V7h-5z"/>
    <text x="12" y="16.6" text-anchor="middle" font-size="8.5"
          font-family="Inter, system-ui, sans-serif" fill="#1A73E8">31</text></svg>`,
};

let state = { step: 0, ob: null, conns: [] };

// ------------------------------------------------------------- step machine

const steps = [...document.querySelectorAll('.step')];

function paintRail() {
  document.querySelectorAll('#obrail li').forEach((li) => {
    const i = Number(li.dataset.step);
    li.toggleAttribute('data-on', i === state.step);
    li.toggleAttribute('data-done', i < state.step);
  });
}

/* Swaps panels with an out/in pair rather than a cross-fade: two headlines
 * visible at once, at this size, reads as a glitch. */
function show(next, { back = false } = {}) {
  const cur = steps[state.step];
  const to = steps[next];
  if (cur === to) return;
  const swap = () => {
    cur.hidden = true; cur.removeAttribute('data-anim');
    to.hidden = false;
    to.setAttribute('data-anim', 'in');
    state.step = next;
    paintRail();
    // Focus the new heading so a screen reader and the keyboard both land in
    // the step that just appeared, not back at the top of the document.
    const h = to.querySelector('h1');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    window.scrollTo({ top: 0, behavior: reduced.matches ? 'auto' : 'smooth' });
    announce(h ? h.textContent : '');
    onEnter(next, { back });
  };
  if (reduced.matches) return swap();
  cur.setAttribute('data-anim', 'out');
  setTimeout(swap, 160);
}

function onEnter(i) {
  if (i === 1) renderSources();
  if (i === 2) renderPlans();
  if (i === 3) { runChecks(); }
  if (i === 4) renderDone();
}

// ------------------------------------------------------------------ step 1

async function saveOrg() {
  await post('/v1/onboarding', {
    display_name: $('ob-name').value,
    steps: { team: $('ob-team').value, goal: $('ob-goal').value.trim() },
  });
}

// ------------------------------------------------------------------ step 2

const STATE_LABEL = {
  ok: 'Verified', pending: 'Saved, not yet verified', error: 'Needs attention',
};

/* The integrations catalog.
 *
 * One grid, one vocabulary. The four built-in sources and the ~1,200 servers
 * synced from the public registry are presented the same way — a mark, a
 * name, one line on what gets remembered, and a state — because to the person
 * connecting them the transport is irrelevant. Pages of twelve, so the list is
 * browsable rather than a search box with nothing behind it; search and the
 * filters narrow the same list rather than opening a different one. */

const PAGE = 12;
const cat = { q: '', filter: 'all', page: 0, seq: 0 };

/* Brand colour for the monogram tile, keyed by a token of the slug or title.
 * These are colours, not logos: a coloured square with an initial reads as
 * "a product" at a glance without shipping (or hot-linking) anyone's mark. */
const BRAND = {
  github: '#24292f', gitlab: '#fc6d26', notion: '#1f1f1f', linear: '#5e6ad2',
  asana: '#f06a6a', atlassian: '#0052cc', jira: '#0052cc', confluence: '#0052cc',
  bitbucket: '#0052cc', hubspot: '#ff7a59', intercom: '#1f8ded', sentry: '#362d59',
  slack: '#4a154b', stripe: '#635bff', figma: '#a259ff', zendesk: '#03363d',
  salesforce: '#00a1e0', airtable: '#fcb400', supabase: '#3ecf8e', vercel: '#171717',
  cloudflare: '#f38020', postgres: '#336791', postgresql: '#336791', mongodb: '#00684a',
  shopify: '#5e8e3e', zapier: '#ff4f00', discord: '#5865f2', dropbox: '#0061ff',
  box: '#0061d5', monday: '#ff3d57', clickup: '#7b68ee', todoist: '#e44332',
  google: '#4285f4', microsoft: '#0078d4', teams: '#5059c9', outlook: '#0078d4',
  onedrive: '#0078d4', sharepoint: '#038387', aws: '#ff9900', azure: '#0078d4',
  gcp: '#4285f4', datadog: '#632ca6', pagerduty: '#06ac38', twilio: '#f22f46',
  sendgrid: '#1a82e2', mailchimp: '#ffe01b', canva: '#00c4cc', miro: '#ffd02f',
  loom: '#625df5', calendly: '#006bff', docusign: '#ffc820', paypal: '#003087',
  square: '#1f1f1f', quickbooks: '#2ca01c', xero: '#13b5ea', workday: '#f38b00',
  greenhouse: '#3ab549', lever: '#4f2f86', pipedrive: '#1a1a1a', close: '#1f1f1f',
  freshdesk: '#25c16f', front: '#a02c76', trello: '#0079bf', youtube: '#ff0000',
  x: '#1f1f1f', twitter: '#1da1f2', linkedin: '#0a66c2', reddit: '#ff4500',
  spotify: '#1db954', apple: '#1f1f1f', openai: '#1f1f1f', anthropic: '#d97757',
  huggingface: '#ff9d00', vercel_: '#171717', netlify: '#00c7b7', heroku: '#430098',
  railway: '#7b3fe4', render: '#46e3b7', snowflake: '#29b5e8', databricks: '#ff3621',
  bigquery: '#4285f4', tableau: '#e97627', looker: '#4285f4', grafana: '#f46800',
  elastic: '#fec514', redis: '#dc382d', mysql: '#00758f', neon: '#00e599',
  planetscale: '#1f1f1f', firebase: '#ffca28', okta: '#007dc1', auth0: '#eb5424',
  '1password': '#1a8cff', bitwarden: '#175ddc', gong: '#8039df', fireflies: '#ff6b6b',
  wispr: '#1f1f1f', otter: '#3d7cf5', zoom: '#0b5cff', webex: '#00bceb',
};

const hue = (str) => {
  let h = 0;
  for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
};
function tileColor(slug, title) {
  const toks = `${slug} ${title}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (const t of toks) if (BRAND[t]) return BRAND[t];
  return `hsl(${hue(slug)} 34% 46%)`;
}
const monogram = (slug, title) =>
  `<span class="srcicon tile" style="--tile:${tileColor(slug, title)}" aria-hidden="true">${
    esc((String(title || slug).trim()[0] || '?').toUpperCase())}</span>`;

const catShort = (slug) => (String(slug).split('/').pop() || 'server')
  .toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'server';

function nativeCard(s, c) {
  const on = !c ? '0' : c.status === 'ok' ? '1' : c.status === 'error' ? 'err' : 'p';
  const label = !c ? 'Not connected' : (STATE_LABEL[c.status] || 'Connected');
  return `<button class="srccard" data-src="${esc(s.id)}" data-pck="${esc(s.pck)}"
            data-on="${on}" aria-label="${esc(c ? `Reconnect ${s.label}` : `Connect ${s.label}`)}">
      <span class="srcname"><span class="srcicon" aria-hidden="true">${ICON[s.id] || ''}</span>${esc(s.label)}<span class="sd" aria-hidden="true"></span></span>
      <span class="srcwhat">${esc(s.what)}</span>
      <span class="srcstate">${esc(label)}</span>
    </button>`;
}

function catalogCard(r, c) {
  const on = !c ? '0' : c.status === 'ok' ? '1' : c.status === 'error' ? 'err' : 'p';
  const label = !c ? 'Not connected' : (STATE_LABEL[c.status] || 'Connected');
  const what = (r.description || '').replace(/\s+/g, ' ').trim();
  return `<button class="srccard" data-mslug="${esc(r.slug)}" data-on="${on}"
            aria-label="${esc(c ? `Reconnect ${r.title}` : `Connect ${r.title}`)}">
      <span class="srcname">${monogram(r.slug, r.title)}${esc(r.title)}<span class="sd" aria-hidden="true"></span></span>
      <span class="srcwhat" title="${esc(what)}">${esc(what || 'Remote source')}</span>
      <span class="srcstate">${esc(label)}</span>
    </button>`;
}

const skeletons = (n) => Array.from({ length: Math.max(0, n) }, () =>
  '<div class="srccard skel" aria-hidden="true"><span class="srcname"><span class="srcicon"></span><span class="sk sk-t"></span></span><span class="sk sk-w"></span><span class="sk sk-s"></span></div>').join('');

async function fetchCatalog(from, to) {
  let sel = window.OB.sb.from('mcp_catalog')
    .select('slug,title,description,auth,featured', { count: 'exact' });
  if (cat.q) {
    const safe = cat.q.replace(/[%,()]/g, ' ');
    sel = sel.or(`title.ilike.%${safe}%,description.ilike.%${safe}%,slug.ilike.%${safe}%`);
  }
  if (cat.filter === 'featured') sel = sel.eq('featured', true);
  const { data, count, error } = await sel
    .order('featured', { ascending: false }).order('title').range(from, to);
  if (error) throw new Error(error.message || 'catalog unavailable');
  return { rows: data || [], count: count || 0 };
}

function wireCards() {
  const grid = $('srcgrid');
  grid.querySelectorAll('[data-src]').forEach((b) =>
    b.addEventListener('click', () => connect(b)));
  grid.querySelectorAll('[data-mslug]').forEach((b) =>
    b.addEventListener('click', () => {
      b.querySelector('.srcstate').textContent = 'Checking\u2026';
      mcpStart({ slug: b.dataset.mslug });
    }));
}

function paintPager(total, shown, note) {
  const nav = $('catpage');
  const pages = Math.max(1, Math.ceil(total / PAGE));
  if (cat.page > pages - 1) cat.page = pages - 1;
  const first = total ? cat.page * PAGE + 1 : 0;
  const last = Math.min(total, cat.page * PAGE + shown);
  const fmt = (n) => n.toLocaleString('en-US');
  /* Page numbers: first, last, and the current page's neighbours — enough to
     jump, not a hundred buttons. */
  const want = new Set([0, pages - 1, cat.page - 1, cat.page, cat.page + 1]
    .filter((i) => i >= 0 && i < pages));
  const nums = []; let prev = -1;
  [...want].sort((x, y) => x - y).forEach((i) => {
    if (prev >= 0 && i - prev > 1) nums.push('<span class="pgap" aria-hidden="true">&middot;&middot;&middot;</span>');
    nums.push(`<button type="button" class="pnum" data-pg="${i}"
      aria-label="Page ${i + 1}" ${i === cat.page ? 'aria-current="page"' : ''}>${i + 1}</button>`);
    prev = i;
  });
  nav.innerHTML = `
    <span class="pcount">${note ? esc(note)
      : total ? `${fmt(first)}&ndash;${fmt(last)} of ${fmt(total)}` : 'No matches'}</span>
    <span class="pnav">
      <button type="button" class="parrow" data-pg="prev" aria-label="Previous page"
        ${cat.page === 0 ? 'disabled' : ''}>&larr;</button>
      ${pages > 1 ? nums.join('') : ''}
      <button type="button" class="parrow" data-pg="next" aria-label="Next page"
        ${cat.page >= pages - 1 ? 'disabled' : ''}>&rarr;</button>
    </span>`;
  nav.hidden = !total && !note;
  nav.querySelectorAll('[data-pg]').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.pg;
    const next = v === 'prev' ? cat.page - 1 : v === 'next' ? cat.page + 1 : Number(v);
    if (next === cat.page || next < 0 || next >= pages) return;
    cat.page = next;
    renderSources();
    $('catalog').scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth', block: 'start' });
  }));
}

/* Paints one page of the merged list. Built-in sources come first in the
 * virtual order (they are the ones with a verified, first-party path), then
 * the catalog in featured-then-alphabetical order; a page is a window over
 * that combined sequence, so the offset into the catalog shifts by however
 * many built-ins precede it. Built-ins paint at once; catalog rows fill in
 * behind skeletons so the grid never jumps. A stale fetch (typing fast, or
 * paging twice) is dropped by sequence number. */
async function renderSources() {
  const seq = ++cat.seq;
  const grid = $('srcgrid');
  const by = Object.fromEntries(state.conns.map((c) => [c.provider, c]));
  const q = cat.q.toLowerCase();
  let natives = SOURCES.filter((s) => !q
    || s.label.toLowerCase().includes(q) || s.what.toLowerCase().includes(q));
  if (cat.filter === 'connected') natives = natives.filter((s) => by[s.id]);
  const N = natives.length;
  const start = cat.page * PAGE;
  const nat = natives.slice(start, start + PAGE);

  if (cat.filter === 'connected') {
    /* Connected is a view over what this org actually has, not the catalog. */
    const mcp = state.conns.filter((c) => String(c.provider).startsWith('mcp:'))
      .filter((c) => !q || c.provider.toLowerCase().includes(q));
    const all = nat.map((s) => nativeCard(s, by[s.id])).concat(mcp.map((c) =>
      catalogCard({ slug: c.provider.slice(4), title: c.provider.slice(4),
                    description: 'Remote source, polled every sweep.' }, c)));
    grid.innerHTML = all.length ? all.join('')
      : '<p class="catempty">Nothing is connected yet. Pick anything from All to start.</p>';
    wireCards();
    paintPager(N + mcp.length, all.length);
    return;
  }

  const catFrom = Math.max(0, start - N);
  const catTo = start + PAGE - 1 - N;
  grid.innerHTML = nat.map((s) => nativeCard(s, by[s.id])).join('')
    + (catTo >= 0 ? skeletons(PAGE - nat.length) : '');
  wireCards();
  if (catTo < 0) { paintPager(N, nat.length); return; }

  let rows = [], count = 0, note = '';
  try { ({ rows, count } = await fetchCatalog(catFrom, catTo)); }
  catch (e) { note = `Catalog unavailable \u2014 ${String(e.message || e).slice(0, 60)}`; }
  if (seq !== cat.seq) return;
  const cards = nat.map((s) => nativeCard(s, by[s.id]))
    .concat(rows.map((r) => catalogCard(r, by[`mcp:${catShort(r.slug)}`])));
  grid.innerHTML = cards.length ? cards.join('')
    : `<p class="catempty">Nothing matches &ldquo;${esc(cat.q)}&rdquo;. Try another
        name, or add it by server address below.</p>`;
  wireCards();
  paintPager(N + count, cards.length, note);
}

/* Connecting a Google source is a plain navigation through Supabase Auth's own
 * /authorize endpoint — the identical GoTrue flow the login page uses, with two
 * additions Google requires for a refresh token (access_type=offline,
 * prompt=consent) and the one read-only scope this source needs. No SDK, no
 * widget, no third-party script: the browser leaves, consents, and comes back
 * to this page with the grant in the URL fragment.
 *
 * Scopes are requested at CONNECT time, never at sign-in — folding
 * gmail.readonly into login would show every colleague a Gmail consent screen
 * just to open the dashboard.
 */
async function connectGoogle(btn) {
  const provider = btn.dataset.src;
  const st = btn.querySelector('.srcstate');
  st.textContent = 'Redirecting to Google…';
  try {
    const cfg = await api('/v1/connect/config');
    if (!cfg.google_ready) {
      st.textContent = 'Google connect is not configured on this server';
      return;
    }
    sessionStorage.setItem('ob_connect_provider', provider);
    const u = new URL(`${cfg.supabase_url}/auth/v1/authorize`);
    u.searchParams.set('provider', 'google');
    u.searchParams.set('redirect_to', `${location.origin}${location.pathname}`);
    u.searchParams.set('scopes', cfg.google_scopes[provider]);
    u.searchParams.set('access_type', 'offline');
    u.searchParams.set('prompt', 'consent');
    /* include_granted_scopes is deliberately ABSENT: with it, Google's Allow
     * click 500s ("Something went wrong") whenever the user already granted
     * another scope — reproduced 2026-08-31. Each source keeps its own
     * refresh token, so merged grants buy nothing anyway. */
    location.href = u.toString();
  } catch (e) {
    st.textContent = String(e.message || e).slice(0, 80);
  }
}

/* Trello, one hop: its /1/authorize page bounces the token straight back in
 * the URL fragment (return_url + callback_method=fragment) — the same return
 * shape as Google, so the wizard catches it and verifies with a live call.
 * No copy-paste. The org's (free) app key is the only one-time ask. */
function trelloAuthorize(cfg) {
  sessionStorage.setItem('ob_connect_provider', 'trello');
  const u = new URL(cfg.trello_authorize_url);
  u.searchParams.set('return_url', location.origin + location.pathname);
  u.searchParams.set('callback_method', 'fragment');
  location.href = u.toString();
}

async function connectTrello(btn) {
  const st = btn.querySelector('.srcstate');
  try {
    const cfg = await api('/v1/connect/config');
    state.cfg = cfg;
    if (cfg.trello_authorize_url) {
      st.textContent = 'Heading to Trello\u2026';
      trelloAuthorize(cfg);
      return;
    }
    const box = $('trello-attach');
    box.hidden = false;
    st.textContent = 'One-time setup \u2014 your organization\u2019s API key';
    box.focus({ preventScroll: true });
    box.scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth',
                         block: 'nearest' });
  } catch (e) {
    st.textContent = String(e.message || e).slice(0, 80);
  }
}

async function connect(btn) {
  if (btn.dataset.src === 'trello') return connectTrello(btn);
  return connectGoogle(btn);
}

// ---------------------------------------------------------------- step 3
// The plan is not optional: Continue stays disabled until a tier is chosen.
// Choosing writes the subscription immediately (no payment yet — Stripe
// activates it later), so a refresh or a return visit remembers it.

async function renderPlans() {
  const grid = $('plangrid'); const out = $('plan-out');
  try {
    const b = await api('/v1/billing');
    const chosen = b.subscription?.plan_code || '';
    grid.innerHTML = b.plans.map((pl) => `
      <button class="srccard" role="radio" data-plan="${esc(pl.code)}"
              aria-checked="${pl.code === chosen}" data-on="${pl.code === chosen ? '1' : '0'}">
        <span class="srcname">${esc(pl.name)}<span class="sd" aria-hidden="true"></span></span>
        <span class="srcwhat">$${Number(pl.usd_month)}/month &mdash; ${esc(pl.display_tokens)} included, rolls over</span>
        <span class="srcstate">${pl.code === chosen ? 'Selected' : 'Choose'}</span>
      </button>`).join('');
    out.textContent = `Balance: $${Number(b.balance_usd).toFixed(2)} — this month’s use: `
      + `${(b.month_tokens / 1e6).toFixed(2)}M tokens ($${Number(b.month_spend_usd).toFixed(4)})`;
    $('plan-next').disabled = !chosen;
    grid.querySelectorAll('[data-plan]').forEach((card) => {
      card.addEventListener('click', async () => {
        card.querySelector('.srcstate').textContent = 'Saving…';
        try {
          await post('/v1/billing/plan', { plan: card.dataset.plan });
          await renderPlans();
        } catch (e) {
          card.querySelector('.srcstate').textContent = String(e.message || e).slice(0, 60);
        }
      });
    });
  } catch (e) {
    out.textContent = String(e.message || e).slice(0, 120);
  }
}

/* Returning from Google: Supabase puts the grant in the URL fragment. The
 * fragment is scrubbed from the URL and history BEFORE any network call, so
 * tokens never survive in the address bar, a bookmark, or a shared screen. */
async function handleConnectReturn() {
  // The inline stash in onboard.html wins over location.hash: by module
  // time another consumer may already have scrubbed the URL.
  const rawHash = window.__ob_hash || location.hash;
  window.__ob_hash = '';
  const frag = new URLSearchParams(rawHash.slice(1));
  const prt = frag.get('provider_refresh_token');
  const trelloToken = frag.get('token');
  const hadTokens = frag.has('access_token') || frag.has('provider_token')
    || frag.has('token');
  const provider = sessionStorage.getItem('ob_connect_provider');
  if (!hadTokens || !provider) return false;
  history.replaceState(null, '', location.pathname);
  sessionStorage.removeItem('ob_connect_provider');
  state.step = 1;                       // land back on the sources step
  steps.forEach((el, i) => { el.hidden = i !== 1; });
  paintRail();
  if (provider === 'trello') {
    try {
      const res = await post('/v1/connections/trello', { token: trelloToken || '' });
      announce(res.boards > 0
        ? `Trello connected as ${res.account || 'your account'} \u2014 `
          + `${res.boards} open board${res.boards === 1 ? '' : 's'} visible`
        : `Trello verified as ${res.account || 'your account'} \u2014 `
          + 'no open boards visible yet');
    } catch (e) {
      announce('Connecting Trello failed');
      try { await refresh(); } catch { /* render what we have */ }
      renderSources();
      const card = document.querySelector('[data-src="trello"] .srcstate');
      if (card) card.textContent = String(e.message || e).slice(0, 120);
      return true;
    }
    try { await refresh(); } catch { /* render what we have */ }
    renderSources();
    return true;
  }
  if (!prt) {
    announce('Google did not return offline access');
    try { await refresh(); } catch { /* render what we have */ }
    renderSources();
    const card = document.querySelector(`[data-src="${provider}"] .srcstate`);
    if (card) {
      card.textContent = 'Google returned no offline grant — press Connect and '
        + 'approve again';
    }
    return true;
  }
  try {
    await post('/v1/connections/google', {
      provider, provider_refresh_token: prt,
    });
    announce('Source connected and verified');
  } catch (e) {
    announce('Connecting failed');
    try { await refresh(); } catch { /* fall through to render */ }
    renderSources();
    const card = document.querySelector(`[data-src="${provider}"] .srcstate`);
    if (card) card.textContent = String(e.message || e).slice(0, 120);
    return true;
  }
  try { await refresh(); } catch { /* render what we have */ }
  renderSources();
  return true;
}

// ------------------------------------------------------------------ step 3

const ROW = (ok, name, detail, fix, pending, steps) => `
  <div class="vrow">
    ${pending ? '<span class="spinner" aria-hidden="true"></span>'
              : `<span class="sd" aria-hidden="true" style="margin-top:6px;background:${
                  ok ? 'var(--color-deep-verdant)' : 'var(--color-coral)'}"></span>`}
    <div>
      <b>${esc(name)}</b> <span class="vdetail">${esc(detail || '')}</span>
      ${!ok && fix ? `<p class="vfix">${esc(fix)}</p>` : ''}
      ${!ok && (steps || []).length ? `<ol class="vsteps">
        ${steps.map((st) => `<li>${esc(st)}</li>`).join('')}</ol>` : ''}
    </div>
  </div>`;

/* Failed platform KEY rows get a paste field — for the operating org only.
 * The key is verified with a real provider call server-side before it is
 * stored (in Vault) and applied live, so no redeploy and no "saved but
 * broken" state. Other tenants keep the read-only hand-off view. */
const KEY_FIELDS = {
  'Anthropic API key': 'anthropic_api_key',
  'Voyage API key': 'voyage_api_key',
};

function keyForm(c) {
  const field = KEY_FIELDS[c.name];
  if (!field) return '';
  /* Keys are PER-ORG: every organization pastes its own and pays its own
   * bills, so there is no admin gate — you can only ever set yours. The ask is
   * ALWAYS present: a missing key asks plainly, a set one offers replacement
   * (self-serve rotation). Only a key entered HERE (provenance "org") counts
   * as set — the deployment's env keys are a bootstrap fallback, and a fresh
   * onboarding must not silently ride on them. Verify-before-store means a bad
   * paste can never displace a working key. */
  const replacing = c.ok && c.provenance === 'org';
  return `<div class="mrow keyform" data-field="${esc(field)}">
      <input class="fi" type="password"
             placeholder="${replacing ? 'paste a new key to replace the current one'
                                      : 'paste the key here'}"
             spellcheck="false" autocomplete="off"
             aria-label="${esc(c.name)}" />
      <button class="ghostpill" data-keysave>${replacing
        ? 'Verify &amp; replace' : 'Verify &amp; apply'}</button>
      <p class="fh" role="status"></p>
    </div>`;
}

function wireKeyForms() {
  document.querySelectorAll('.keyform').forEach((f) => {
    const btn = f.querySelector('[data-keysave]');
    const input = f.querySelector('input');
    const out = f.querySelector('[role="status"]');
    btn.addEventListener('click', async () => {
      const val = input.value.trim();
      if (!val) { out.textContent = 'Paste the key first.'; return; }
      btn.disabled = true; out.textContent = 'Verifying with the provider…';
      try {
        await post('/v1/org/keys', { [f.dataset.field]: val });
        input.value = '';
        out.textContent = 'Verified and applied — re-running the checks…';
        await runChecks();
      } catch (e) {
        out.textContent = String(e.message || e).slice(0, 180);
        btn.disabled = false;
      }
    });
  });
}

async function runChecks() {
  const box = $('vrows');
  $('vtitle').textContent = 'Checking…';
  box.innerHTML = ROW(true, 'Contacting your sources', '', '', true);
  try {
    const res = await api('/v1/preflight');
    /* Both audiences, clearly separated. Your sources first — the rows this org
     * can act on. Then the platform group: the keys and storage the deployment
     * runs on, live-verified here too, because during first setup the person
     * onboarding usually IS the person running the deployment. The label tells
     * everyone else who to hand a red row to, and each failure carries its own
     * numbered walkthrough. */
    const checks = res.checks || [];
    const mine = checks.filter((c) => c.scope === 'org' && c.name !== 'Sources');
    /* Platform = failing infrastructure only. The keys are the ORG's now — they
     * live in the group above with everything else this org sets up. Green
     * infra (sign-in, Vault, database) is noise here and stays in Operations;
     * a FAILING piece always surfaces, because "everything answered" over a
     * dead database would be a lie. */
    const platform = checks.filter((c) => c.scope !== 'org').filter((c) => !c.ok);
    /* A key row is only "done" when this ORG set its own key; the deployment's
     * env keys keep things RUNNING (fallback) but keep the ask OPEN. */
    const keyDone = (c) => KEY_FIELDS[c.name] === undefined
      ? c.ok : (c.ok && c.provenance === 'org');
    const okMine = mine.every((c) => keyDone(c) || !c.required);
    const okPlat = platform.length === 0;
    const onlyEnvKeys = !okMine
      && mine.every((c) => c.ok || !c.required);
    $('vtitle').textContent = !okPlat ? 'The platform needs attention'
      : !okMine ? (onlyEnvKeys ? 'Set your organization\u2019s keys'
                               : 'Some sources need attention')
      : mine.length ? 'Everything answered' : 'Nothing connected yet';
    box.innerHTML = (mine.length
        ? mine.map((c) => {
            const done = keyDone(c);
            const detail = done ? (KEY_FIELDS[c.name] !== undefined
                                     ? (c.detail || 'ok') : 'verified')
              : (c.ok ? 'not set for your organization — running on the '
                        + 'deployment\u2019s fallback key for now'
                      : c.detail);
            return ROW(done, c.name, detail, done ? '' : c.fix, false,
                       done ? [] : c.steps) + keyForm(c);
          }).join('')
        : ROW(true, 'Nothing connected',
              'Connect any source above whenever you want it ingested.', '', false))
      + (platform.length
        ? '<div class="vsub">Platform — what this deployment runs on. Fixed by '
          + 'whoever operates it, not per organization.</div>'
          + platform.map((c) => ROW(false, c.name, c.detail, c.fix, false,
                                    c.steps)).join('')
        : '');
    wireKeyForms();
    announce($('vtitle').textContent);
  } catch (e) {
    $('vtitle').textContent = 'Could not run the checks';
    box.innerHTML = ROW(false, 'Check failed', String(e.message || e).slice(0, 160),
      'Reload the page; if it persists the server may be down.');
  }
}

// ------------------------------------------------------------------ step 4

function renderDone() {
  const live = state.conns.filter((c) => c.status === 'ok').length;
  const name = ($('ob-name').value || '').trim() || (state.ob && state.ob.org) || '';
  $('donesum').textContent = live
    ? `${name} is connected to ${live} source${live === 1 ? '' : 's'}, and OneBrain `
      + 'starts collecting within the minute.'
    : `${name} is ready. Nothing is ingesting automatically yet — connect a source `
      + 'from Settings whenever you want it filled for you.';
  /* The team invite: sign-in is genuinely all a colleague needs, and /welcome
   * walks them through the two optional minutes (their own mailbox, Claude). */
  const invite = $('done-invite');
  if (invite) invite.textContent = `${location.origin}${location.pathname.replace(/onboard\.html$/, "")}index.html`;
  post('/v1/onboarding', { complete: true }).catch(() => {});
}

// ------------------------------------------------------------------- boot

async function refresh() {
  const [ob, conns, cfg] = await Promise.all([
    api('/v1/onboarding'),
    api('/v1/connections').catch(() => ({ connections: [] })),
    api('/v1/connect/config').catch(() => null),
  ]);
  state.ob = ob;
  state.conns = conns.connections || [];
  if (cfg) state.cfg = cfg;
  return ob;
}

/* Controls are wired BEFORE any await. Attaching them after the first fetch
 * meant the page painted a Continue button that silently did nothing until the
 * API came back — the click was simply dropped, which reads as a broken page. */
function wire() {
  document.querySelectorAll('[data-next]').forEach((b) => b.addEventListener('click', async () => {
    if (state.step === 0) {
      b.disabled = true;
      try { await saveOrg(); } catch { /* naming is not worth blocking setup */ }
      b.disabled = false;
    }
    if (state.step === 1) { try { await refresh(); } catch { /* keep going */ } }
    if (state.step === 2 && $('plan-next').disabled) return;
    show(Math.min(state.step + 1, steps.length - 1));
  }));
  document.querySelectorAll('[data-back]').forEach((b) =>
    b.addEventListener('click', () => show(Math.max(state.step - 1, 0), { back: true })));

  $('vrun').addEventListener('click', runChecks);

  if ($('tr-origin')) $('tr-origin').firstChild.textContent = location.origin + ' ';
  $('tr-origin')?.addEventListener('click', async () => {
    const b = $('tr-origin');
    try {
      await navigator.clipboard.writeText(location.origin);
      const was = b.innerHTML;
      b.textContent = 'Copied \u2713';
      setTimeout(() => { b.innerHTML = was; }, 1600);
    } catch { /* clipboard blocked: the text is still selectable */ }
  });

  $('tr-key-save').addEventListener('click', async () => {
    const out = $('tr-key-out'); const btn = $('tr-key-save');
    const key = $('tr-key').value.trim();
    if (!key) { out.textContent = 'Paste the API key first.'; return; }
    btn.disabled = true; out.textContent = 'Saving\u2026';
    try {
      await post('/v1/org/keys', { trello_api_key: key });
      $('tr-key').value = '';
      const cfg = await api('/v1/connect/config');
      state.cfg = cfg;
      out.textContent = 'Saved \u2014 heading to Trello to approve\u2026';
      trelloAuthorize(cfg);
    } catch (e) {
      out.textContent = `Failed: ${String(e.message || e).slice(0, 140)}`;
      btn.disabled = false;
    }
  });
}

// ------------------------------------------------- remote (MCP) sources

const mcpShort = (s) => (String(s).split('/').pop() || 'server')
  .toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'server';

function mcpToolPick(tools, onPick) {
  const box = $('mcp-tools');
  if (!tools.length) {
    $('mcp-out').textContent += ' — the server lists no tools.';
    return;
  }
  box.innerHTML = tools.map((t) =>
    `<button type="button" class="ghostpill" data-mtool="${esc(t.name)}"
       title="${esc(t.description || '')}">${esc(t.name)}</button>`).join('');
  $('mcp-toolpick').hidden = false;
  box.querySelectorAll('[data-mtool]').forEach((b) =>
    b.addEventListener('click', () => onPick(b.dataset.mtool)));
}

async function mcpStart({ slug, url }) {
  const out = $('mcp-out');
  $('mcp-toolpick').hidden = true;
  out.textContent = 'Checking the server…';
  const short = mcpShort(slug ||
    new URL(url).hostname.replace(/^mcp\./, '').split('.')[0]);
  try {
    const res = await post('/v1/connections/mcp/start', {
      slug: slug || '', url: url || '',
      return_to: `${location.origin}${location.pathname}?mcp=${encodeURIComponent(short)}`,
    });
    if (res.auth === 'oauth') {
      out.textContent = 'Handing you to the provider for consent…';
      location.href = res.authorize_url;
      return;
    }
    out.textContent = `${res.server?.name || 'Server'} is reachable — choose what to ingest.`;
    mcpToolPick(res.tools || [], async (tool) => {
      try {
        const r = await post('/v1/connections/mcp', { slug: short, url: res.url, tool });
        out.textContent = `Connected ${r.connected} — the backend polls it from the next sweep.`;
        $('mcp-toolpick').hidden = true;
        announce(`Connected ${r.connected}.`);
      } catch (e) { out.textContent = `Failed: ${e.message || e}`; }
    });
  } catch (e) { out.textContent = `Failed: ${e.message || e}`; }
}

function wireCatalog() {
  let t;
  $('cat-q').addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const q = $('cat-q').value.trim();
      if (q === cat.q) return;
      cat.q = q; cat.page = 0;
      renderSources();
    }, 220);
  });
  document.querySelectorAll('.catfilter').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.filter === cat.filter) return;
    cat.filter = b.dataset.filter; cat.page = 0;
    document.querySelectorAll('.catfilter').forEach((x) =>
      x.setAttribute('aria-pressed', String(x === b)));
    renderSources();
  }));
  $('mcp-url-go').addEventListener('click', () => {
    const u = $('mcp-url').value.trim();
    if (u.startsWith('https://')) mcpStart({ url: u });
    else $('mcp-out').textContent = 'Paste an https:// server address.';
  });
}

async function handleMcpReturn() {
  // The OAuth callback bounces here with ?mcp=<short-slug>; the connection
  // already exists — what's left is choosing the ingestion tool.
  const short = new URLSearchParams(location.search).get('mcp');
  if (!short) return false;
  history.replaceState(null, '', location.pathname);
  state.step = 1;
  steps.forEach((el, i) => { el.hidden = i !== 1; });
  paintRail();
  const provider = `mcp:${mcpShort(short)}`;
  const out = $('mcp-out');
  out.textContent = `${provider} connected — fetching its tools…`;
  try {
    const res = await post('/v1/connections/mcp/tools', { provider });
    out.textContent = `${provider} connected — choose what to ingest.`;
    mcpToolPick(res.tools || [], async (tool) => {
      try {
        const r = await post('/v1/connections/mcp/tool', { provider, tool });
        out.textContent = `${provider} ingests via ${r.tool} — first sweep within a minute.`;
        $('mcp-toolpick').hidden = true;
        announce('Source connected.');
      } catch (e) { out.textContent = `Failed: ${e.message || e}`; }
    });
  } catch (e) { out.textContent = `${provider}: ${e.message || e}`; }
  return true;
}

async function boot() {
  wire();
  paintRail();
  wireCatalog();
  const returned = (await handleConnectReturn()) || (await handleMcpReturn());
  let ob;
  try { ob = await refresh(); } catch { return; }   // 401 already redirected
  $('ob-domain').textContent = ob.org || '';
  if (ob.display_name) $('ob-name').value = ob.display_name;
  $('ob-name').placeholder = ob.org || 'Acme Inc.';
  if (ob.steps) {
    if (ob.steps.team) $('ob-team').value = ob.steps.team;
    if (ob.steps.goal) $('ob-goal').value = ob.steps.goal;
  }
  document.querySelectorAll('.reveal, [data-words]').forEach((el) => el.classList.add('in'));
  if (returned) renderSources();

  // Already finished? Say so rather than walking them through it again.
  if (ob.completed_at) $('exit').textContent = 'Back to dashboard';
}

boot();
