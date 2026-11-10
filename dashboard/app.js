// The dashboard page. It fetches the state of a folder of rounds and draws it. Live, it fetches again
// whenever the server says a file changed. In replay it plays a recorded series back on its own clock,
// using the real time of every step, with long quiet gaps shortened.

const params = new URLSearchParams(location.search);
const REPLAY = params.has('replay');
const GAP = 6000; // longest quiet gap kept in a replay, in ms

const COLORS = { tom: 'var(--tom)', joel: 'var(--joel)', maya: 'var(--maya)', ines: 'var(--ines)', kofi: 'var(--kofi)' };
const STAGES = ['Shop', 'Product', 'Cart', 'Confirmed'];
const ICON = {
  good: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  bad: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  walk: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-dasharray="20 12"/></svg>',
  idle: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
};

let data = null;
let series = [];
const sel = { round: null, shopper: null, step: null, fix: null };
const play = { pos: 0, playing: params.get('autoplay') !== '0', speed: Number(params.get('speed') ?? 8), last: performance.now() };
let line = null; // replay timeline
const announced = new Set();

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dirParam = () => params.get('dir') ?? '';

// ---------- data ----------

async function load() {
  const q = dirParam() ? `?dir=${encodeURIComponent(dirParam())}` : '';
  const r = await fetch(`/api/state${q}`);
  if (!r.ok) throw new Error(await r.text());
  data = await r.json();
  if (REPLAY) line = timeline(data);
  render();
}

async function loadSeries() {
  const r = await fetch('/api/series');
  const j = await r.json();
  series = j.series;
}

function listen() {
  const q = dirParam() ? `?dir=${encodeURIComponent(dirParam())}` : '';
  const es = new EventSource(`/api/events${q}`);
  let pending = null;
  es.addEventListener('changed', () => {
    clearTimeout(pending);
    pending = setTimeout(() => load().catch(console.error), 150);
  });
}

// ---------- replay clock ----------

const fixAt = (r) => {
  const l = r.spend.filter((x) => x.purpose === 'fix').map((x) => x.at).sort();
  return l.length ? Date.parse(l[l.length - 1]) : r.finishedAt ? Date.parse(r.finishedAt) + 20000 : null;
};
const outcomeAt = (r, s) => {
  const last = s.steps[s.steps.length - 1];
  return last ? Date.parse(last.at) + 1500 : r.finishedAt ? Date.parse(r.finishedAt) : Infinity;
};

function timeline(d) {
  const ts = [];
  for (const r of d.rounds) {
    if (r.startedAt) ts.push(Date.parse(r.startedAt));
    if (r.finishedAt) ts.push(Date.parse(r.finishedAt));
    if (r.scan) ts.push(Date.parse(r.scan.at));
    for (const s of r.shoppers) {
      for (const x of s.steps) ts.push(Date.parse(x.at));
      if (s.outcome) ts.push(outcomeAt(r, s));
    }
    for (const x of r.spend) ts.push(Date.parse(x.at));
    if (r.fix) {
      const f = fixAt(r);
      ts.push(f, f + r.fix.buildSeconds * 1000);
    }
  }
  const t = [...new Set(ts.filter(Number.isFinite))].sort((a, b) => a - b);
  const c = [0];
  for (let k = 1; k < t.length; k++) c.push(c[k - 1] + Math.min(t[k] - t[k - 1], GAP));
  return { t, c, total: c[c.length - 1] ?? 0 };
}

function comp(ms) {
  const { t, c } = line;
  if (!t.length || ms < t[0]) return -Infinity;
  let lo = 0, hi = t.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t[mid] <= ms) lo = mid;
    else hi = mid - 1;
  }
  return c[lo] + Math.min(ms - t[lo], GAP);
}

function realAt(pos) {
  const { t, c } = line;
  let k = 0;
  while (k + 1 < c.length && c[k + 1] <= pos) k++;
  return t[k] + Math.min(pos - c[k], GAP);
}

const shown = (ms) => !REPLAY || comp(ms) <= play.pos;
const shownIso = (iso) => !!iso && shown(Date.parse(iso));

// ---------- the view of the data at this moment ----------

function level(label) {
  if (label === 'before') return 0;
  const m = /^after(\d*)/.exec(label);
  return m ? Number(m[1] || 1) : 0;
}
function roundName(r) {
  if (r.label === 'before') return 'Released shop';
  const m = /^after(\d*)(?:-(.*))?$/.exec(r.label);
  if (m) return `After fix ${m[1] || 1}${m[2] ? ` (${m[2]})` : ''}`;
  return r.label;
}
const fixName = (r) => `Fix ${level(r.label) + 1}`;

function pageOf(url) {
  try {
    const p = new URL(url).pathname;
    if (p.startsWith('/cart/checkout/')) return 3;
    if (p.startsWith('/cart')) return 2;
    if (p.startsWith('/product/')) return 1;
    return 0;
  } catch {
    return 0;
  }
}
const PAGE_NAMES = ['Home page', 'Product page', 'Cart and checkout', 'Order confirmed'];

function view() {
  const rounds = data.rounds
    .filter((r) => !r.startedAt || shownIso(r.startedAt))
    .map((r) => {
      const finished = !!r.finishedAt && shownIso(r.finishedAt);
      const shoppers = r.shoppers.map((s) => {
        const steps = s.steps.filter((x) => shownIso(x.at));
        const outcome = s.outcome && (!REPLAY || shown(outcomeAt(r, s))) ? s.outcome : null;
        const status = outcome ? (outcome.outcome === 'bought' ? 'good' : 'bad') : steps.length ? 'walk' : finished ? 'idle' : 'wait';
        return { ...s, steps, outcome, status };
      });
      let fixState = null;
      if (REPLAY) {
        if (r.fix && finished) {
          const f = fixAt(r);
          fixState = !shown(f) ? 'writing' : !shown(f + r.fix.buildSeconds * 1000) ? 'building' : r.fix.built ? 'built' : 'failed';
        }
      } else if (r.fix) fixState = r.fix.built ? 'built' : 'failed';
      else if (r.fixStatus) fixState = r.fixStatus.state;
      const spend = r.spend.filter((x) => shownIso(x.at));
      return {
        ...r,
        name: roundName(r),
        finished,
        shoppers,
        bought: shoppers.filter((s) => s.status === 'good').length,
        walking: shoppers.filter((s) => s.status === 'walk' || s.status === 'wait').length,
        scan: r.scan && shownIso(r.scan.at) ? r.scan : null,
        fixState,
        spend,
      };
    });
  return { rounds };
}

// ---------- drawing ----------

function setHTML(el, html) {
  if (el._html === html) return;
  const active = document.activeElement;
  const keep = active && el.contains(active) ? active.id : null;
  const scrollers = [...el.querySelectorAll('[data-keep-scroll]')].map((n) => [n.dataset.keepScroll, n.scrollTop]);
  el.innerHTML = html;
  el._html = html;
  for (const [k, top] of scrollers) {
    const n = el.querySelector(`[data-keep-scroll="${k}"]`);
    if (n) n.scrollTop = top;
  }
  if (keep) document.getElementById(keep)?.focus({ preventScroll: true });
}

function say(text) {
  const p = document.createElement('p');
  p.textContent = text;
  $('announce').append(p);
  setTimeout(() => p.remove(), 8000);
}

const meta = (id) => data.shoppers.find((s) => s.id === id) ?? { id, name: id, need: '', perceives: '', maxSteps: 30 };
const usd = (n) => `$${n.toFixed(2)}`;

function pill(status, outcome) {
  const pop = ' pop';
  if (status === 'good') return `<span class="pill good${pop}">${ICON.good}Got in</span>`;
  if (status === 'bad') return `<span class="pill bad${pop}">${ICON.bad}${outcome?.outcome === 'error' ? 'Error' : 'Locked out'}</span>`;
  if (status === 'walk') return `<span class="pill walk">${ICON.walk}Shopping</span>`;
  if (status === 'idle') return `<span class="pill idle">${ICON.idle}Not in this round</span>`;
  return `<span class="pill idle">${ICON.idle}Getting ready</span>`;
}

function reasonText(o) {
  if (!o) return '';
  if (o.outcome === 'bought') return `Order confirmed after ${o.steps} steps`;
  if (o.outcome === 'step_limit') return `Still trying after ${o.steps} steps`;
  if (o.outcome === 'gave_up') return `Gave up: ${o.reason}`;
  return o.reason;
}

function actionText(x) {
  const t = x.text, l = x.targetLabel || x.text;
  switch (x.action) {
    case 'press': return `Pressed ${t}${x.times > 1 ? ` ×${x.times}` : ''}`;
    case 'click': return `Clicked “${l}”`;
    case 'click_text': return `Clicked “${t}”`;
    case 'type': return `Typed “${t}”`;
    case 'select': return `Chose “${t}”`;
    case 'activate': return `Activated “${l}”`;
    case 'scroll_down': return 'Scrolled down';
    case 'scroll_up': return 'Scrolled up';
    case 'back': return 'Went back';
    case 'wait': return 'Waited';
    case 'give_up': return 'Gave up';
    case 'done': return 'Said done';
    default: return x.action;
  }
}

function renderMode(v) {
  const live = v.rounds.some((r) => !r.finished);
  if (REPLAY) {
    const first = data.rounds[0]?.startedAt;
    const day = first ? new Date(first).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';
    setHTML($('mode'), `<span class="badge replay"><span class="dot"></span>REPLAY</span><span>Recorded run from ${esc(day)}, played back at ${play.speed}x</span>`);
  } else {
    setHTML(
      $('mode'),
      `<span class="badge live"><span class="dot"></span>LIVE</span><span>${live ? 'A round is running now' : v.rounds.length ? 'Waiting for the next round' : 'Waiting for the first round'}</span>`,
    );
  }
}

function renderControls() {
  const opts = [`<option value="live"${!REPLAY ? ' selected' : ''}>Live: new rounds in runs</option>`]
    .concat(series.filter((s) => s.dir !== 'runs').map((s) => `<option value="${esc(s.dir)}"${REPLAY && dirParam() === s.dir ? ' selected' : ''}>Replay: ${esc(s.dir)} (${s.rounds} rounds)</option>`))
    .join('');
  let html = `<label class="sr-only" for="series">Show</label><select id="series" class="btn">${opts}</select>`;
  if (REPLAY && line) {
    const now = new Date(realAt(play.pos)).toISOString().slice(11, 19);
    html += `<button id="playbtn" class="btn" data-act="play" aria-pressed="${play.playing}">${play.playing ? 'Pause' : 'Play'}</button>
      <div class="speed" role="group" aria-label="Replay speed">${[1, 4, 8, 16, 32]
        .map((s) => `<button id="sp${s}" class="btn" data-act="speed" data-v="${s}" aria-pressed="${play.speed === s}">${s}x</button>`)
        .join('')}</div>
      <label class="sr-only" for="scrub">Replay position</label>
      <input id="scrub" class="scrub" type="range" min="0" max="${Math.round(line.total)}" step="500" value="${Math.round(play.pos)}" aria-valuetext="${now} UTC">
      <span class="clock" aria-hidden="true">${now} UTC</span>
      <button id="restart" class="btn" data-act="restart">Restart</button>`;
  }
  if (sel.round !== null) html += `<button id="follow" class="btn" data-act="follow">${REPLAY ? 'Follow playback' : 'Follow live'}</button>`;
  const el = $('controls');
  // the range input is updated in place so dragging it is not interrupted
  const scrub = $('scrub');
  if (scrub && document.activeElement === scrub) return;
  setHTML(el, html);
}

function current(v) {
  if (!v.rounds.length) return null;
  const i = sel.round !== null ? v.rounds.findIndex((r) => r.id === sel.round) : -1;
  return i >= 0 ? v.rounds[i] : v.rounds[v.rounds.length - 1];
}

function renderHeadline(v, r) {
  if (!r) {
    setHTML($('headline'), `<p class="big">0 <small>rounds yet</small></p><p class="what">Nothing has run in this folder yet.</p>`);
    return;
  }
  const n = r.shoppers.length;
  const first = v.rounds[0];
  const idx = v.rounds.indexOf(r);
  const locked = r.shoppers.filter((s) => s.status === 'bad');
  const delta = idx > 0 && r.walking === 0 ? r.bought - first.bought : 0;
  let why;
  if (r.walking) why = `${r.walking} still shopping. ${locked.length ? `Locked out so far: ${locked.map((s) => meta(s.id).name).join(', ')}.` : ''}`;
  else if (locked.length) why = `Locked out: ${locked.map((s) => `${meta(s.id).name} (${meta(s.id).need.toLowerCase()})`).join(', ')}.`;
  else why = idx > 0 ? 'Every shopper got their order confirmed.' : 'Every shopper got in on the released shop.';
  setHTML(
    $('headline'),
    `<p class="big">${r.bought}<small> of ${n} got in</small></p>
     <p class="what">${esc(r.name)}${r.walking ? ' · running' : ''}</p>
     <p class="why">${esc(why)}</p>
     ${delta > 0 ? `<span class="delta">+${delta} since the released shop</span>` : ''}`,
  );
}

function renderRail(v, r) {
  const items = [];
  v.rounds.forEach((x, i) => {
    const people = x.shoppers
      .map((s) => `<span class="person ${s.status === 'wait' ? '' : s.status}" title="${esc(meta(s.id).name)}">${esc(meta(s.id).name[0])}</span>`)
      .join('');
    const status = x.finished ? `${x.bought} of ${x.shoppers.length} got in` : `running, ${x.bought} in so far`;
    items.push(`<li class="round"><button id="round-${x.id}" class="round-btn" data-act="round" data-id="${x.id}" aria-pressed="${x === r}">
      ${!x.finished ? '<span class="now-tag">Now</span>' : ''}
      <span class="r-name">${esc(x.name)}</span>
      <span class="r-score">${x.bought}<small> / ${x.shoppers.length} got in</small></span>
      <span class="people" aria-hidden="true">${people}</span>${!x.finished ? `<span class="sr-only">, ${status}</span>` : ''}
    </button></li>`);
    if (x.fixState) {
      const next = v.rounds[i + 1];
      const label = { writing: 'The AI is writing a patch', building: 'Rebuilding the shop', built: `${x.fix.edits.length} edit${x.fix.edits.length === 1 ? '' : 's'}, built`, failed: 'Build failed' }[x.fixState] ?? x.fixState;
      const working = x.fixState === 'writing' || x.fixState === 'building';
      items.push(`<li class="connector ${working ? 'working' : next ? '' : 'idle'}"><button id="fixbtn-${x.id}" class="fix-btn" data-act="fix" data-id="${x.id}" aria-pressed="${sel.fix === x.id}">
        <span class="f-name">${fixName(x)}</span>
        <span class="f-state">${working ? '<span class="spinner" style="width:12px;height:12px;border-width:2px" aria-hidden="true"></span>' : x.fixState === 'built' ? ICON.good.replace('<svg', '<svg width="13" height="13"') : ''}${esc(label)}</span>
      </button><span class="arrow" aria-hidden="true"></span></li>`);
    }
  });
  if (!items.length) items.push('<li class="waiting">No rounds yet.</li>');
  setHTML($('rail'), items.join(''));
}

function renderTiles(v) {
  const spend = v.rounds.flatMap((r) => r.spend);
  const total = spend.reduce((a, x) => a + x.usd, 0);
  const fixes = spend.filter((x) => x.purpose === 'fix').reduce((a, x) => a + x.usd, 0);
  const steps = v.rounds.reduce((a, r) => a + r.shoppers.reduce((b, s) => b + s.steps.length, 0), 0);
  const visits = v.rounds.reduce((a, r) => a + r.shoppers.filter((s) => s.status !== 'idle').length, 0);
  setHTML(
    $('tiles'),
    `<div class="panel tile"><p class="t-label">AI cost of these rounds</p><p class="t-value">${usd(total)}</p>
       <p class="t-sub">Shoppers ${usd(total - fixes)} · fixes ${usd(fixes)}</p></div>
     <div class="tile-row">
       <div class="panel tile"><p class="t-label">Steps taken</p><p class="t-value">${steps}</p></div>
       <div class="panel tile"><p class="t-label">Shop visits</p><p class="t-value">${visits}</p></div>
     </div>`,
  );
}

function stageState(s) {
  const reached = Math.max(0, ...s.steps.map((x) => pageOf(x.url)));
  if (s.status === 'good') return { reached: 3, mark: 3, kind: 'done' };
  const last = s.steps[s.steps.length - 1];
  const here = last ? pageOf(last.url) : -1;
  return { reached, mark: here, kind: s.status === 'bad' ? 'stuck' : 'here' };
}

// how long the visit took, from the start of the round to the last step shown
function took(r, s) {
  const last = s.steps[s.steps.length - 1];
  if (!last || !r.startedAt) return '';
  const sec = Math.max(0, Math.round((Date.parse(last.at) - Date.parse(r.startedAt)) / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} min`;
}

function card(r, s) {
  const m = meta(s.id);
  const last = s.steps[s.steps.length - 1];
  const shot = s.status === 'good' && s.final ? s.final : last?.shot;
  const st = stageState(s);
  const journey = STAGES.map((name, i) => {
    const cls = [i <= st.reached ? 'reached' : '', i === st.mark ? st.kind : ''].join(' ').trim();
    return `<li class="${cls}">${name}</li>`;
  }).join('');
  const stepsLabel =
    s.status === 'good' ? `Got in at step ${s.outcome.steps}` : s.status === 'bad' ? `Stopped at step ${s.outcome.steps}` : last ? `Step ${last.step} of ${m.maxSteps}` : 'Not started';
  const pct = Math.min(100, ((s.outcome?.steps ?? last?.step ?? 0) / m.maxSteps) * 100);
  const words = s.status === 'good' || s.status === 'bad' ? s.outcome.lastSay || last?.say : last?.say;
  const note = s.outcome ? s.note || (s.status === 'bad' ? reasonText(s.outcome) : '') : '';
  const pageName = last ? PAGE_NAMES[pageOf(last.url)] : '';
  return `<article class="card ${s.status === 'good' || s.status === 'bad' ? s.status : ''} ${sel.shopper === s.id ? 'selected' : ''}" style="--c:${COLORS[s.id] ?? 'var(--tom)'}" aria-labelledby="who-${s.id}">
    <div class="card-head">
      <span class="avatar" aria-hidden="true">${esc(m.name[0])}</span>
      <button id="who-${s.id}" class="who" data-act="shopper" data-id="${s.id}" aria-pressed="${sel.shopper === s.id}" >
        <span class="name">${esc(m.name)}</span><span class="need">${esc(m.need)}</span>
      </button>
      ${pill(s.status, s.outcome)}
    </div>
    <div class="screen">
      ${shot ? `<img src="${shot}" alt="${esc(m.name)}'s screen${last ? ` at step ${last.step}, ${esc(pageName)}` : ''}">` : `<div class="empty">${s.status === 'idle' ? 'Not in this round' : 'Opening the shop…'}</div>`}
      ${last && !s.outcome ? `<span class="stepno" aria-hidden="true">Step ${last.step}</span><span class="page" aria-hidden="true">${esc(pageName)}</span>` : ''}
      ${s.status === 'good' ? `<div class="stamp good">${ICON.good}Order confirmed</div>` : s.status === 'bad' ? `<div class="stamp bad">${ICON.bad}Locked out on the ${esc(pageName.toLowerCase())}</div>` : ''}
    </div>
    <div class="say">${words ? `<q>${esc(words)}</q>` : `<span class="muted">${esc(m.perceives)}</span>`}</div>
    <ol class="journey" aria-label="How far ${esc(m.name)} got">${journey}</ol>
    <div class="card-foot">
      <div class="meter" aria-hidden="true"><span style="width:${pct}%"></span></div>
      <div class="foot-row"><span>${esc(stepsLabel)}</span><span>${esc(took(r, s))}</span></div>
      ${note ? `<p class="note">${esc(note)}</p>` : ''}
    </div>
  </article>`;
}

function renderGrid(v, r) {
  const grid = $('grid');
  if (!r) {
    setHTML($('shoppers-title'), 'The shoppers');
    setHTML($('shoppers-sub'), '');
    setHTML(
      grid,
      `<div class="waiting">${REPLAY ? 'The replay starts in a moment.' : 'Start a round and the shoppers show up here as they go: <code>npm run round -- before</code>'}</div>`,
    );
    return;
  }
  setHTML($('shoppers-title'), `The shoppers · ${esc(r.name)}`);
  setHTML($('shoppers-sub'), r.finished ? 'Same job for everyone: buy one thing with your own email at checkout.' : 'Watching them shop now. Each one only gets what their need allows.');
  if (!grid._cards || grid._for !== r.id + r.shoppers.map((s) => s.id).join()) {
    grid.innerHTML = r.shoppers.map((s) => `<div id="slot-${s.id}"></div>`).join('');
    grid._html = null;
    grid._cards = true;
    grid._for = r.id + r.shoppers.map((s) => s.id).join();
  }
  for (const s of r.shoppers) setHTML($(`slot-${s.id}`), card(r, s));
}

function renderDetail(v, r) {
  const el = $('detail');
  if (!r || !r.shoppers.length) {
    setHTML(el, `<h2 id="detail-title" class="panel-title">Step by step</h2><p class="empty-note">Pick a shopper to follow every step.</p>`);
    return;
  }
  const s = r.shoppers.find((x) => x.id === sel.shopper) ?? r.shoppers.find((x) => x.status === 'bad') ?? r.shoppers.find((x) => x.id === 'joel') ?? r.shoppers[0];
  const m = meta(s.id);
  const steps = s.steps;
  const pickStep = sel.step !== null && sel.shopper === s.id ? steps.find((x) => x.step === sel.step) : null;
  const showFinal = !pickStep && s.status === 'good' && s.final;
  const shown = pickStep ?? steps[steps.length - 1];
  const img = showFinal ? s.final : shown?.shot;
  const list = steps
    .slice()
    .reverse()
    .map(
      (x) => `<li><button id="step-${s.id}-${x.step}" data-act="step" data-id="${x.step}" data-shopper="${s.id}" aria-current="${shown === x && !showFinal}">
        <span class="n">${String(x.step).padStart(2, '0')}</span>
        <span class="a">${esc(actionText(x))} <span class="pg">· ${esc(PAGE_NAMES[pageOf(x.url)])}</span></span>
        <span class="t">${esc(x.thought)}</span>
      </button></li>`,
    )
    .join('');
  const final = s.outcome
    ? `<li class="final ${s.status}"><button id="step-${s.id}-final" data-act="step" data-id="final" data-shopper="${s.id}" aria-current="${!!showFinal}">
        <span class="n">${s.status === 'good' ? ICON.good.replace('<svg', '<svg width="16" height="16" style="color:var(--good-ink)"') : ICON.bad.replace('<svg', '<svg width="16" height="16" style="color:var(--bad-ink)"')}</span>
        <span class="a">${s.status === 'good' ? 'Order confirmed by the shop' : 'Locked out'}</span>
        <span class="t">${esc(reasonText(s.outcome))}</span>
      </button></li>`
    : '';
  const callout = s.note && s.outcome
    ? `<p class="callout ${s.status === 'good' ? 'good' : ''}">${esc(s.note)}</p>`
    : s.status === 'bad'
      ? `<p class="callout">${esc(reasonText(s.outcome))}. Last words: “${esc(s.outcome.lastSay)}”</p>`
      : '';
  setHTML(
    el,
    `<div class="detail-head" style="--c:${COLORS[s.id]}">
       <span class="avatar" aria-hidden="true">${esc(m.name[0])}</span>
       <div><h2 id="detail-title">${esc(m.name)}, step by step</h2><p>${esc(m.need)} · ${esc(m.perceives)} · ${esc(r.name)}</p></div>
     </div>
     ${callout}
     <div class="detail-body">
       <figure class="big-screen">
         <div class="frame">${img ? `<img src="${img}" alt="${esc(m.name)}'s screen${shown && !showFinal ? ` at step ${shown.step}` : ' after the last step'}">` : ''}</div>
         <figcaption>
           ${shown && !showFinal ? `<span class="act"><strong>Step ${shown.step}:</strong> ${esc(actionText(shown))}</span><span class="thought">“${esc(shown.thought)}”</span>` : showFinal ? `<span class="act"><strong>After step ${s.outcome.steps}:</strong> the shop's order confirmation page</span>` : `<span class="act">Waiting for the first step</span>`}
         </figcaption>
       </figure>
       <ol class="steps" data-keep-scroll="steps" aria-label="${esc(m.name)}'s steps, newest first">${final}${list}</ol>
     </div>`,
  );
}

function renderMatrix(v) {
  if (!v.rounds.length) {
    setHTML($('matrix'), '<p class="empty-note">No rounds yet.</p>');
    return;
  }
  const ids = [...new Set(v.rounds.flatMap((r) => r.shoppers.map((s) => s.id)))];
  const head = v.rounds.map((r) => `<th scope="col">${esc(r.name)}</th>`).join('');
  const rows = ids
    .map((id) => {
      const m = meta(id);
      const cells = v.rounds
        .map((r) => {
          const s = r.shoppers.find((x) => x.id === id);
          if (!s || s.status === 'idle') return '<td><span class="cell idle">not in round</span></td>';
          if (s.status === 'wait') return '<td><span class="cell idle">getting ready</span></td>';
          if (s.status === 'good') return `<td><span class="cell good">${ICON.good}Got in <small>${s.outcome.steps} steps</small></span></td>`;
          if (s.status === 'bad') return `<td><span class="cell bad">${ICON.bad}Locked out <small>${s.outcome.steps} steps</small></span></td>`;
          return `<td><span class="cell walk">${ICON.walk}Shopping <small>step ${s.steps.length}</small></span></td>`;
        })
        .join('');
      return `<tr><th scope="row"><span class="avatar" style="--c:${COLORS[id]}" aria-hidden="true">${esc(m.name[0])}</span>${esc(m.name)}</th>${cells}</tr>`;
    })
    .join('');
  setHTML($('matrix'), `<table class="matrix"><thead><tr><th scope="col"><span class="sr-only">Shopper</span></th>${head}</tr></thead><tbody>${rows}</tbody></table>`);
}

function diffHtml(diff) {
  return diff
    .split('\n')
    .map((l) => {
      const cls = l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff ') || l.startsWith('index ') ? 'meta' : l.startsWith('@@') ? 'hunk' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : '';
      return cls ? `<span class="${cls}">${esc(l)}</span>` : esc(l) + '\n';
    })
    .join('');
}

let diffOpen = false;
function renderFix(v) {
  const fixes = v.rounds.filter((r) => r.fixState);
  const el = $('fix');
  if (!fixes.length) {
    setHTML(el, `<h2 id="fix-title" class="panel-title">The fix</h2><p class="empty-note">When someone is locked out, the AI reads their steps, the free check and the shop's source, and writes a patch. It shows up here.</p>`);
    return;
  }
  const f = fixes.find((x) => x.id === sel.fix) ?? fixes[fixes.length - 1];
  const tabs =
    fixes.length > 1
      ? `<div class="fix-tabs" role="group" aria-label="Fixes">${fixes.map((x) => `<button id="fixtab-${x.id}" class="btn" data-act="fix" data-id="${x.id}" aria-pressed="${x === f}">${fixName(x)}</button>`).join('')}</div>`
      : '';
  let body;
  if (f.fixState === 'writing' || f.fixState === 'building') {
    const locked = f.shoppers.filter((s) => s.status === 'bad').map((s) => meta(s.id).name);
    body = `<div class="working"><span class="spinner" aria-hidden="true"></span><div><strong>${f.fixState === 'writing' ? 'The AI is writing a patch' : 'Rebuilding the shop with the patch'}</strong><br><span class="hint" style="margin:0">${f.fixState === 'writing' ? `From what stopped ${esc(locked.join(' and ') || 'the shoppers')}, the free check and the shop's source` : "The shop's own Next.js build, type check and lint"}</span></div></div>`;
  } else {
    const edits = f.fix.edits
      .map(
        (e) => `<li><code>${esc(e.file)}</code><span class="chips">${e.helps.map((h) => `<span class="chip" style="--c:${COLORS[h] ?? 'var(--tom)'}">${esc(meta(h).name)}</span>`).join('')}</span><br>${esc(e.why)}</li>`,
      )
      .join('');
    const lines = f.fix.diff.split('\n').filter((l) => /^[+-][^+-]/.test(l)).length;
    body = `<p class="fix-summary">${esc(f.fix.summary)}</p>
      <div class="fix-meta">
        <span class="pill ${f.fix.built ? 'good' : 'bad'}">${f.fix.built ? ICON.good : ICON.bad}${f.fix.built ? `Shop built in ${f.fix.buildSeconds} s${f.fix.attempts === 1 ? ', first try' : ''}` : 'Build failed'}</span>
        <span class="pill idle">${f.fix.edits.length} edit${f.fix.edits.length === 1 ? '' : 's'}</span>
      </div>
      <ul class="edits">${edits}</ul>
      ${f.fix.diff ? `<details class="diff" id="diff-${f.id}"${diffOpen ? ' open' : ''}><summary>See the patch (${lines} changed lines)</summary><pre class="diff-body">${diffHtml(f.fix.diff)}</pre></details>` : ''}`;
  }
  const next = v.rounds[v.rounds.indexOf(f) + 1];
  setHTML(
    el,
    `<h2 id="fix-title" class="panel-title">The fix <span class="hint">${esc(fixName(f))}, written from the ${esc(f.name)} round${next ? ` and used in the ${esc(next.name)} round` : ''}</span></h2>${tabs}${body}`,
  );
}

function renderScan(v, r) {
  const sc = r?.scan;
  if (!sc) {
    setHTML($('scan'), `<p class="empty-note">${r ? 'Running the free check…' : 'Runs at the start of every round.'}</p>`);
    return;
  }
  const yes = (b) => (b ? `<p class="v good">${ICON.good}Yes</p>` : `<p class="v bad">${ICON.bad}No</p>`);
  const card = sc.focusAfterOpeningCard;
  setHTML(
    $('scan'),
    `<div class="scan-grid">
      <div class="scan-item"><p class="k">Rules failed, axe-core</p><p class="v">${sc.failedRules}</p><p class="s">${esc(sc.rules.slice(0, 5).join(', '))}${sc.rules.length > 5 ? ' …' : ''}</p></div>
      <div class="scan-item"><p class="k">Add To Cart shows keyboard focus</p>${yes(sc.addToCartShowsFocus)}<p class="s">Scripted Tab walk on a product page</p></div>
      ${card ? `<div class="scan-item" style="grid-column:1/-1"><p class="k">Open a recommended product by keyboard, focus lands on</p><p class="v ${/^body\b/.test(card.afterEnter) ? 'bad' : 'good'}" style="font-size:15px">${/^body\b/.test(card.afterEnter) ? `${ICON.bad}Nothing, focus stays on the page body` : `${ICON.good}${esc(card.afterEnter.slice(0, 60))}`}</p></div>` : ''}
    </div>`,
  );
}

function announceChanges(v) {
  for (const r of v.rounds) {
    const k0 = `start-${r.id}`;
    if (!announced.has(k0)) {
      announced.add(k0);
      if (data._ready) say(`${r.name}: round started.`);
    }
    for (const s of r.shoppers) {
      if (!s.outcome) continue;
      const k = `${r.id}-${s.id}`;
      if (announced.has(k)) continue;
      announced.add(k);
      if (data._ready) say(`${meta(s.id).name} ${s.status === 'good' ? `got in after ${s.outcome.steps} steps` : `was locked out after ${s.outcome.steps} steps`}.`);
    }
    if (r.fixState === 'built' && !announced.has(`fix-${r.id}`)) {
      announced.add(`fix-${r.id}`);
      if (data._ready) say(`${fixName(r)} is built.`);
    }
  }
  data._ready = true;
}

function render() {
  if (!data) return;
  const v = view();
  const r = current(v);
  if (sel.shopper && r && !r.shoppers.some((s) => s.id === sel.shopper)) sel.shopper = null;
  renderMode(v);
  renderControls();
  renderHeadline(v, r);
  renderRail(v, r);
  renderTiles(v);
  renderGrid(v, r);
  renderDetail(v, r);
  renderMatrix(v);
  renderFix(v);
  renderScan(v, r);
  setHTML(
    $('foot'),
    `Showing <code>${esc(data.dir)}</code>. Every step, screenshot and patch here is read from the files the shoppers and the fix wrote. The shop is the open source OpenTelemetry Demo 3.1.0.`,
  );
  announceChanges(v);
}

// ---------- input ----------

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'round') {
    sel.round = b.dataset.id;
    sel.step = null;
  } else if (act === 'shopper') {
    sel.shopper = sel.shopper === b.dataset.id ? null : b.dataset.id;
    sel.step = null;
    if (sel.shopper) $('detail').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
  } else if (act === 'step') {
    sel.shopper = b.dataset.shopper;
    sel.step = b.dataset.id === 'final' ? null : Number(b.dataset.id);
  } else if (act === 'fix') {
    sel.fix = b.dataset.id;
  } else if (act === 'follow') {
    sel.round = null;
    sel.step = null;
  } else if (act === 'play') {
    play.playing = !play.playing;
    if (line && play.pos >= line.total) restart();
  } else if (act === 'speed') {
    play.speed = Number(b.dataset.v);
  } else if (act === 'restart') {
    restart();
  }
  render();
});

document.addEventListener('toggle', (e) => {
  if (e.target.matches?.('details.diff')) diffOpen = e.target.open;
}, true);

document.addEventListener('input', (e) => {
  if (e.target.id === 'scrub') {
    play.pos = Number(e.target.value);
    resetAnnounced();
    render();
  }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'series') {
    const v = e.target.value;
    location.search = v === 'live' ? '' : `?dir=${encodeURIComponent(v)}&replay=1&speed=${play.speed}`;
  }
});

function resetAnnounced() {
  announced.clear();
  if (data) data._ready = false;
}
function restart() {
  play.pos = 0;
  play.playing = true;
  resetAnnounced();
}

// The video script drives the replay through this.
window.lti = {
  seek: (realIso) => {
    play.pos = Math.max(0, comp(Date.parse(realIso)));
    render();
  },
  pause: () => { play.playing = false; render(); },
  resume: () => { play.playing = true; play.last = performance.now(); render(); },
  speed: (s) => { play.speed = s; render(); },
  state: () => ({ pos: play.pos, total: line?.total ?? 0, at: line ? new Date(realAt(play.pos)).toISOString() : null }),
  select: (o) => { Object.assign(sel, o); render(); },
};

function tick(now) {
  const dt = now - play.last;
  play.last = now;
  if (REPLAY && line && play.playing) {
    play.pos = Math.min(line.total, play.pos + dt * play.speed);
    if (play.pos >= line.total) play.playing = false;
  }
  setTimeout(() => requestAnimationFrame(tick), 120);
  if (REPLAY) render();
}

(async () => {
  await loadSeries().catch(() => {});
  if (REPLAY && params.has('at')) play.pos = 0;
  await load();
  if (REPLAY && params.has('at')) window.lti.seek(params.get('at'));
  if (!REPLAY) listen();
  requestAnimationFrame((t) => { play.last = t; tick(t); });
})().catch((e) => {
  document.getElementById('main').innerHTML = `<p class="waiting">Could not load: ${esc(e.message)}</p>`;
});
