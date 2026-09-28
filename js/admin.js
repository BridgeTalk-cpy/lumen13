import { getStore } from './store.js';
import { ACT1, ACT2, ACT3, ACT4, DO_CARDS, ADMIN_PIN, MAX_TEAMS, DEFAULT_TIMERS } from './content.js';
import { whyScore, scoreAct4 } from './grader.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const now = () => Date.now();

let store, code, session = null, teams = {};
let tab = 'status', gradeTeam = null, showAct = 'board', reveal = false;
let unS = null, unT = null, pending = false;

const STAGES = ['act1', 'pickup2', 'act2', 'pickup3', 'act3', 'pickup4', 'act4', 'done'];
const STAGE_LABEL = { act1: 'ACT 1 진행 중', pickup2: 'ACT 2 카드 받으러 오는 중', act2: 'ACT 2 진행 중', pickup3: 'DO카드 받으러 오는 중', act3: 'ACT 3 진행 중', pickup4: 'ACT 4 카드 받으러 오는 중', act4: 'ACT 4 진행 중', done: '모든 미션 완료' };
const PICK_LABEL = { pickup2: 'ACT 2 카드(질문·단서·추가 조사카드)', pickup3: 'DO카드 8장', pickup4: 'ACT 4 미션카드·증거카드' };

// ── 점수 ────────────────────────────────
function scoreOf(t) {
  const ad = t.admin || {};
  const checks = ad.act1Checks || [];
  const a1 = checks.filter(Boolean).length * ACT1.pointsPerGap;
  const a1Pending = !!t.act1?.submittedAt && !ad.act1Done;
  let a2 = 0, a2Pending = false;
  for (const w of ACT2.whys) {
    const r = whyScore(t.act2?.[w.key], ad.manual?.[w.key], ACT2);
    a2 += r.score; if (r.pending) a2Pending = true;
  }
  const a3 = t.act3?.score || 0;
  const auto4 = t.act4?.auto?.total ?? 0;
  const a4 = typeof ad.act4Override === 'number' ? ad.act4Override : auto4;
  return { a1, a2, a3, a4, total: a1 + a2 + a3 + a4, a1Pending, a2Pending };
}
const teamList = () => Object.values(teams).filter((t) => +t.id <= (session?.teamCount || MAX_TEAMS)).sort((a, b) => +a.id - +b.id);
const tname = (t) => t.name || `${t.id}팀`;
const fmtMin = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, '0')}초`; };

// ── 시작 ────────────────────────────────
async function boot() {
  const pinOk = () => { try { return sessionStorage.getItem('l13admin') === '1'; } catch { return false; } };
  if (!pinOk()) {
    const go = () => {
      if ($('#pin').value.trim() === ADMIN_PIN) { try { sessionStorage.setItem('l13admin', '1'); } catch {} start(); }
      else $('#pinMsg').textContent = '비밀번호가 맞지 않습니다.';
    };
    $('#pinGo').addEventListener('click', go);
    $('#pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    return;
  }
  start();
}
async function start() {
  $('#gate').classList.add('hidden'); $('#shell').classList.remove('hidden');
  store = await getStore();
  if (store.mode === 'demo') $('#demo').classList.remove('hidden');
  const p = new URLSearchParams(location.search);
  code = (p.get('s') || localStorage.getItem('l13code') || 'CINOS').toUpperCase();
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (!b) return; tab = b.dataset.tab; $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b)); render(true); });
  $('#view').addEventListener('focusout', () => { if (pending) setTimeout(() => { if (!isEditing()) render(true); }, 150); });
  connect();
  setInterval(() => { if (tab === 'status') render(); }, 5000);
}
function connect() {
  try { localStorage.setItem('l13code', code); } catch {}
  $('#codeLabel').textContent = code;
  unS?.(); unT?.();
  unS = store.watchSession(code, (s) => { session = s; if (!s) store.setSession(code, { createdAt: now(), teamCount: 3, timers: DEFAULT_TIMERS }); render(); });
  unT = store.watchTeams(code, (t) => { teams = t; render(); });
}
const isEditing = () => { const a = document.activeElement; return a && $('#view').contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.type !== 'checkbox'; };
function render(force = false) {
  if (!force && isEditing()) { pending = true; return; }
  pending = false;
  const y = window.scrollY;
  ({ status: renderStatus, grade: renderGrade, show: renderShow, setup: renderSetup })[tab]();
  if (!force) window.scrollTo(0, y);
}
const upd = (id, patch) => store.updateTeam(code, id, patch);

// ── 현황 ────────────────────────────────
function renderStatus() {
  const list = teamList();
  const alerts = [];
  for (const t of list) {
    if (PICK_LABEL[t.stage]) alerts.push(`<div class="alert"><span><span class="who">${esc(tname(t))}</span>${PICK_LABEL[t.stage]} 전달 필요</span><span class="meta">${t.stage === 'pickup2' ? 'ACT 1' : t.stage === 'pickup3' ? 'ACT 2' : 'ACT 3'} 제출 완료</span></div>`);
    if (t.act2?.hintCard === 'need') alerts.push(`<div class="alert"><span><span class="who">${esc(tname(t))}</span>WHY 3 힌트카드 ① 전달 필요</span><button class="btn small" data-hint="${t.id}">전달함</button></div>`);
    const s = scoreOf(t);
    if (s.a1Pending) alerts.push(`<div class="alert blue"><span><span class="who">${esc(tname(t))}</span>ACT 1 채점 대기</span><button class="btn small" data-goto="${t.id}">채점하기</button></div>`);
    if (s.a2Pending) alerts.push(`<div class="alert blue"><span><span class="who">${esc(tname(t))}</span>ACT 2 강사 채점 대기 (3회 오답)</span><button class="btn small" data-goto="${t.id}">채점하기</button></div>`);
  }
  const cards = list.map((t) => {
    const s = scoreOf(t);
    const idx = STAGES.indexOf(t.stage);
    const started = t.stageStartedAt?.[t.stage];
    const mins = session?.timers?.[t.stage] ?? DEFAULT_TIMERS[t.stage];
    const el = started ? now() - started : 0;
    const over = started && mins && el > mins * 60000;
    const whys = ACT2.whys.map((w) => {
      const d = t.act2?.[w.key];
      const cls = d?.status === 'passed' ? 'ok' : d?.status === 'manual' ? 'manual' : d?.wrong || d?.attempts ? 'open' : '';
      return `<span class="chip ${cls}">${w.label}${d?.wrong ? ` ✕${d.wrong}` : ''}${d?.status === 'passed' ? ' ✓' : ''}</span>`;
    }).join('');
    return `<div class="tcard">
      <div class="row"><h3>${esc(tname(t))}</h3><div class="total">${s.total}<small> 점</small></div></div>
      <div class="stage">${STAGE_LABEL[t.stage] || ''}</div>
      <div class="steps">${[0, 2, 4, 6].map((i) => `<span class="${idx >= i ? 'on' : ''}"></span>`).join('')}</div>
      ${started && /^act/.test(t.stage) ? `<div class="meta" style="${over ? 'color:var(--bad)' : ''}">진행 ${fmtMin(el)}${mins ? ` / 제한 ${mins}분` : ''}</div>` : ''}
      <div class="whys">${whys}</div>
      <div class="meta" style="margin-top:8px">ACT1 ${s.a1}${s.a1Pending ? '(대기)' : ''} · ACT2 ${s.a2}${s.a2Pending ? '(대기)' : ''} · ACT3 ${s.a3} · ACT4 ${s.a4}</div>
    </div>`;
  }).join('');
  $('#view').innerHTML = `
    <h2>알림</h2>
    <div class="alerts">${alerts.join('') || '<div class="empty">지금은 처리할 알림이 없습니다.</div>'}</div>
    <h2>팀별 진행</h2>
    ${list.length ? `<div class="grid">${cards}</div>` : '<div class="empty">아직 입장한 팀이 없습니다. ‘설정’ 탭의 QR을 보여 주세요.</div>'}`;
  $$('[data-hint]').forEach((b) => b.addEventListener('click', () => upd(b.dataset.hint, { 'act2.hintCard': 'given' })));
  $$('[data-goto]').forEach((b) => b.addEventListener('click', () => { gradeTeam = b.dataset.goto; tab = 'grade'; $$('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === 'grade')); render(true); window.scrollTo(0, 0); }));
}

// ── 채점 ────────────────────────────────
function renderGrade() {
  const list = teamList();
  if (!list.length) { $('#view').innerHTML = '<div class="empty">아직 입장한 팀이 없습니다.</div>'; return; }
  if (!gradeTeam || !teams[gradeTeam]) gradeTeam = list[0].id;
  const t = teams[gradeTeam];
  const ad = t.admin || {};
  const s = scoreOf(t);
  const checks = ad.act1Checks || [];
  const act1 = `<div class="gsec"><h3>ACT 1 · 찾아라 <span class="pts">${s.a1} / 20${s.a1Pending ? ' · 채점 대기' : ''}</span></h3>
    ${t.act1?.submittedAt ? '' : '<p class="muted">아직 제출 전입니다. 작성 중인 내용이 보입니다.</p>'}
    <div class="ans"><span class="k">AS-IS</span>${esc(t.act1?.asis) || '—'}</div>
    <div class="ans"><span class="k">GAP</span>${esc(t.act1?.gap) || '—'}</div>
    <div class="checks">${ACT1.gapItems.map((g, i) => `<label><input type="checkbox" data-chk="${i}" ${checks[i] ? 'checked' : ''}> ${'①②③④'[i]} ${esc(g)}</label>`).join('')}</div>
    <div style="height:10px"></div>
    <button class="btn small ${ad.act1Done ? '' : 'primary'}" id="a1done">${ad.act1Done ? '채점 완료됨 ✓' : '채점 완료로 표시'}</button></div>`;
  const whys = ACT2.whys.map((w) => {
    const d = t.act2?.[w.key] || {};
    const r = whyScore(d, ad.manual?.[w.key], ACT2);
    const st = d.status === 'passed' ? `통과 · 오답 ${d.wrong || 0}회` : d.status === 'manual' ? '강사 채점' : d.attempts?.length ? `진행 중 · 오답 ${d.wrong || 0}회` : '미시작';
    const atts = (d.attempts || []).map((a) => `<li><span class="${a.ok ? 'o' : a.soft ? 's' : 'x'}">${a.ok ? '통과' : a.soft ? '보완' : '오답'}</span> ${esc(a.a)}${a.n ? ` <span>→ ${esc(a.n)}</span>` : ''}</li>`).join('');
    return `<div class="why">
      <div class="row"><b>${w.label} · ${esc(w.question)}</b><span class="chip ${d.status === 'passed' ? 'ok' : d.status === 'manual' ? 'manual' : ''}">${st} · ${r.score}점${r.pending ? '(대기)' : ''}</span></div>
      ${atts ? `<ol class="attempts">${atts}</ol>` : ''}
      ${d.status === 'manual' ? `<div class="inline" style="margin-top:6px"><span>강사 점수</span><input type="number" min="0" max="10" data-manual="${w.key}" value="${typeof ad.manual?.[w.key] === 'number' ? ad.manual[w.key] : ''}" placeholder="0~10"><span class="muted">/ 10</span></div>` : ''}
      <div class="model">모범답: ${esc(w.model)}${w.modelNext ? ` / 다음 질문: ${esc(w.modelNext)}` : ''}</div>
    </div>`;
  }).join('');
  const act2 = `<div class="gsec"><h3>ACT 2 · 밝혀라 <span class="pts">${s.a2} / 30${s.a2Pending ? ' · 채점 대기' : ''}</span></h3>${whys}
    ${t.act2?.core ? `<div class="ans" style="margin-top:12px"><span class="k">핵심 원인</span>${esc(t.act2.core)}</div>` : ''}</div>`;
  const ord = t.act3?.order || t.act3?.draft || [];
  const act3 = `<div class="gsec"><h3>ACT 3 · 해결하라 <span class="pts">${s.a3} / 50</span></h3>
    ${t.act3?.submittedAt ? '' : '<p class="muted">아직 제출 전입니다.</p>'}
    <div class="ans"><span class="k">먼저 (18:00 전)</span>${ord.slice(0, 4).map((x) => x || '—').join(' → ')}</div>
    <div class="ans"><span class="k">이후</span>${ord.slice(4, 8).map((x) => x || '—').join(' → ')}</div>
    ${t.act3?.parts ? `<div class="meta">안전 확보 ${t.act3.parts.safety} · 운영 정상화 ${t.act3.parts.normal} · 재발 방지 ${t.act3.parts.prevent} · 순서 보너스 ${t.act3.parts.order}</div>` : ''}</div>`;
  const auto = t.act4?.auto || scoreAct4(t.act4 || {});
  const act4 = `<div class="gsec"><h3>ACT 4 · 진실을 밝혀라 (보너스) <span class="pts">${s.a4} / 10</span></h3>
    ${ACT4.questions.map((q) => `<div class="ans"><span class="k">${esc(q.q)} · 자동 ${auto[q.key]} / ${q.max}</span>${esc(t.act4?.[q.key]) || '—'}</div>`).join('')}
    <div class="inline"><span>점수 직접 입력(선택)</span><input type="number" min="0" max="10" id="a4ov" value="${typeof ad.act4Override === 'number' ? ad.act4Override : ''}" placeholder="자동 ${auto.total}"><button class="btn small" id="a4clear">자동 점수로</button></div></div>`;
  $('#view').innerHTML = `
    <div class="pills">${list.map((x) => `<button data-team="${x.id}" class="${x.id === gradeTeam ? 'on' : ''}">${esc(tname(x))} · ${scoreOf(x).total}점</button>`).join('')}</div>
    <div class="row" style="margin-bottom:12px"><h2 style="margin:0">${esc(tname(t))}</h2><div class="total">${s.total}<small> 점</small></div></div>
    ${act1}${act2}${act3}${act4}`;
  $$('[data-team]').forEach((b) => b.addEventListener('click', () => { gradeTeam = b.dataset.team; render(true); }));
  $$('[data-chk]').forEach((c) => c.addEventListener('change', () => {
    const arr = ACT1.gapItems.map((_, i) => ($(`[data-chk="${i}"]`)?.checked) || false);
    upd(t.id, { 'admin.act1Checks': arr });
  }));
  $('#a1done').addEventListener('click', () => upd(t.id, { 'admin.act1Done': !ad.act1Done, 'admin.act1Checks': ACT1.gapItems.map((_, i) => $(`[data-chk="${i}"]`).checked) }));
  $$('[data-manual]').forEach((inp) => inp.addEventListener('change', () => {
    const v = inp.value === '' ? null : Math.max(0, Math.min(10, +inp.value));
    upd(t.id, { [`admin.manual.${inp.dataset.manual}`]: v });
  }));
  $('#a4ov').addEventListener('change', (e) => upd(t.id, { 'admin.act4Override': e.target.value === '' ? null : Math.max(0, Math.min(10, +e.target.value)) }));
  $('#a4clear').addEventListener('click', () => upd(t.id, { 'admin.act4Override': null }));
}

// ── 발표 ────────────────────────────────
function renderShow() {
  const list = teamList();
  const sub = [['act1', 'ACT 1'], ['act2', 'ACT 2'], ['act3', 'ACT 3'], ['act4', 'ACT 4'], ['board', '점수판']];
  let body = '';
  if (showAct === 'act1') {
    body = `<h2>ACT 1 · 팀별 GAP</h2>
      <div class="sgrid">${list.map((t) => `<div class="scol"><h3>${esc(tname(t))}</h3><div class="ans"><span class="k">GAP</span>${esc(t.act1?.gap) || '—'}</div><div class="ans"><span class="k">AS-IS</span>${esc(t.act1?.asis) || '—'}</div></div>`).join('')}</div>
      ${reveal ? `<div class="modelbox"><b>GAP 모범답</b><br>${ACT1.gapItems.map((g, i) => `${'①②③④'[i]} ${esc(g)}`).join('<br>')}</div>` : ''}`;
  } else if (showAct === 'act2') {
    body = `<h2>ACT 2 · WHY를 따라 내려가기</h2>` + ACT2.whys.map((w) => `
      <div style="margin-bottom:22px"><div class="kicker">${w.label}</div><div class="whyq" style="font-size:24px">${esc(w.question)}</div>
      <div class="sgrid">${list.map((t) => { const d = t.act2?.[w.key] || {}; return `<div class="scol"><h3>${esc(tname(t))} ${d.status === 'passed' ? '<span class="badge ok">통과</span>' : d.status === 'manual' ? '<span class="badge manual">강사 채점</span>' : ''}</h3><div class="ans">${esc(d.answer) || '—'}</div>${w.hasNext && d.next ? `<div class="ans"><span class="k">이어서 할 질문</span>${esc(d.next)}</div>` : ''}</div>`; }).join('')}</div>
      ${reveal ? `<div class="modelbox"><b>모범답</b> ${esc(w.model)}</div>` : ''}</div>`).join('') +
      `<div class="sgrid">${list.map((t) => `<div class="scol"><h3>${esc(tname(t))} · 핵심 원인</h3><div class="ans">${esc(t.act2?.core) || '—'}</div></div>`).join('')}</div>`;
  } else if (showAct === 'act3') {
    const ans = [...ACT3.answerFront, ...ACT3.answerBack];
    const titles = Object.fromEntries(DO_CARDS.map((c) => [c.no, c.title]));
    const row = (name, ord, isAns) => `<div class="row8"><div class="nm">${esc(name)}</div>${Array.from({ length: 8 }, (_, i) => {
      const v = ord[i] || '';
      let cls = i < 4 ? 'front' : '';
      if (reveal && !isAns && v) cls += (i < 4 ? ACT3.answerFront : ACT3.answerBack).includes(v) ? ' good' : ' bad';
      return `<div class="cell ${cls}" title="${esc(titles[v] || '')}">${v || '—'}</div>`;
    }).join('')}</div>`;
    body = `<h2>ACT 3 · 실행 순서</h2>
      <div class="row8"><div></div>${Array.from({ length: 8 }, (_, i) => `<div class="cell head">${i < 4 ? '18:00 전' : '개장 후'} ${i + 1}</div>`).join('')}</div>
      ${list.map((t) => row(tname(t), t.act3?.order || [], false)).join('')}
      ${reveal ? row('정답', ans, true) + `<div class="modelbox"><b>먼저</b> ${ACT3.answerFront.map((n) => `${n} ${titles[n]}`).join(' → ')}<br><b>이후</b> ${ACT3.answerBack.map((n) => `${n} ${titles[n]}`).join(' → ')}</div>` : ''}
      ${reveal ? `<div class="sgrid">${list.map((t) => { const p = t.act3?.parts || {}; return `<div class="scol"><h3>${esc(tname(t))} · ${t.act3?.score || 0}점</h3><div class="meta" style="font-size:16px">안전 확보 ${p.safety || 0}/10 · 운영 정상화 ${p.normal || 0}/10<br>재발 방지 ${p.prevent || 0}/20 · 순서 보너스 ${p.order || 0}/10</div></div>`; }).join('')}</div>` : ''}`;
  } else if (showAct === 'act4') {
    body = `<h2>ACT 4 · 진실을 밝혀라</h2>` + ACT4.questions.map((q, i) => `
      <div style="margin-bottom:22px"><div class="whyq" style="font-size:24px">${i + 1}. ${esc(q.q)}</div>
      <div class="sgrid">${list.map((t) => `<div class="scol"><h3>${esc(tname(t))}</h3><div class="ans">${esc(t.act4?.[q.key]) || '—'}</div></div>`).join('')}</div>
      ${reveal ? `<div class="modelbox"><b>해석</b> ${esc(ACT4.model[q.key])}</div>` : ''}</div>`).join('');
  } else {
    const rows = list.map((t) => ({ t, s: scoreOf(t) })).sort((a, b) => b.s.total - a.s.total);
    const max = 110;
    const best3 = [...rows].sort((a, b) => b.s.a3 - a.s.a3)[0];
    const colors = ['#e9b949', '#8fb0ff', '#45c48a', '#c99bff'];
    body = `<h2>점수판</h2>
      <div class="legend"><span><i style="background:${colors[0]}"></i>ACT 1 (20)</span><span><i style="background:${colors[1]}"></i>ACT 2 (30)</span><span><i style="background:${colors[2]}"></i>ACT 3 (50)</span><span><i style="background:${colors[3]}"></i>ACT 4 보너스 (10)</span></div>
      <div class="board">${rows.map(({ t, s }, i) => `<div class="brow ${i === 0 && s.total > 0 ? 'first' : ''}">
        <div class="rk">${i + 1}</div><div class="nm">${esc(tname(t))}</div>
        <div class="barwrap"><div class="bar">${[s.a1, s.a2, s.a3, s.a4].map((v, k) => `<i style="width:${(v / max) * 100}%;background:${colors[k]}"></i>`).join('')}</div>
          <div class="br">ACT1 ${s.a1}${s.a1Pending ? '(대기)' : ''} · ACT2 ${s.a2}${s.a2Pending ? '(대기)' : ''} · ACT3 ${s.a3} · ACT4 ${s.a4}</div></div>
        <div class="sc">${s.total}</div></div>`).join('')}</div>
      ${reveal && best3 ? `<div class="best"><div class="t">BEST SOLUTION TEAM · ACT 3 최고점</div><div class="n">${esc(tname(best3.t))}</div></div>` : ''}`;
  }
  $('#view').innerHTML = `<div class="show">
    <div class="row" style="margin-bottom:16px;flex-wrap:wrap">
      <div class="pills" style="margin:0">${sub.map(([k, l]) => `<button data-act="${k}" class="${showAct === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <button class="btn small ${reveal ? 'primary' : ''}" id="reveal">${reveal ? '정답 숨기기' : showAct === 'board' ? '1위 발표' : '정답 공개'}</button>
    </div>${list.length ? body : '<div class="empty">아직 입장한 팀이 없습니다.</div>'}</div>`;
  $$('[data-act]').forEach((b) => b.addEventListener('click', () => { showAct = b.dataset.act; reveal = false; render(true); }));
  $('#reveal').addEventListener('click', () => { reveal = !reveal; render(true); });
}

// ── 설정 ────────────────────────────────
function renderSetup() {
  const base = location.origin + location.pathname.replace(/admin\.html$/, '');
  const url = `${base}?s=${encodeURIComponent(code)}`;
  const tm = session?.timers || DEFAULT_TIMERS;
  const tc = session?.teamCount || 3;
  $('#view').innerHTML = `<div class="setup">
    <div class="gsec"><h3>팀 입장 QR</h3>
      <div id="qr"></div><div class="url">${esc(url)}</div>
      <p class="muted" style="font-size:14px">팀 휴대폰으로 QR을 찍으면 교육 코드가 자동으로 들어갑니다.</p></div>
    <div class="gsec"><h3>교육 설정</h3>
      <div class="field"><label class="label">참여 팀 수</label>
        <div class="pills">${Array.from({ length: MAX_TEAMS }, (_, i) => `<button data-tc="${i + 1}" class="${tc === i + 1 ? 'on' : ''}">${i + 1}팀</button>`).join('')}</div></div>
      <div class="field"><label class="label">제한시간 (분) <small>시간이 지나도 작성은 계속할 수 있고, 화면에 ‘시간 종료’만 표시됩니다.</small></label>
        <div class="inline">${['act1', 'act2', 'act3', 'act4'].map((k) => `<span>${k.toUpperCase().replace('ACT', 'ACT ')}</span><input type="number" min="1" max="60" data-tm="${k}" value="${tm[k] ?? ''}">`).join('')}</div></div>
      <div class="field"><label class="label" for="newcode">교육 코드 <small>교육마다 새 코드를 쓰면 이전 기록과 섞이지 않습니다.</small></label>
        <div class="inline"><input type="text" id="newcode" value="${esc(code)}" style="width:180px;text-transform:uppercase"><button class="btn small" id="codeGo">이 코드로 전환</button></div></div>
    </div>
    <div class="gsec"><h3>팀 초기화</h3>
      <p class="muted" style="font-size:14px">잘못 입장했거나 처음부터 다시 해야 할 때 사용합니다. 해당 팀의 모든 답과 점수가 지워집니다.</p>
      <div class="inline">${teamList().map((t) => `<button class="btn small" data-reset="${t.id}">${esc(tname(t))} 초기화</button>`).join('') || '<span class="muted">입장한 팀이 없습니다.</span>'}</div>
    </div></div>`;
  if (window.qrcode) { const q = window.qrcode(0, 'M'); q.addData(url); q.make(); $('#qr').innerHTML = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); $('#qr svg').setAttribute('width', '240'); $('#qr svg').setAttribute('height', '240'); }
  $$('[data-tc]').forEach((b) => b.addEventListener('click', () => store.setSession(code, { teamCount: +b.dataset.tc })));
  $$('[data-tm]').forEach((inp) => inp.addEventListener('change', () => store.setSession(code, { [`timers.${inp.dataset.tm}`]: Math.max(1, +inp.value || DEFAULT_TIMERS[inp.dataset.tm]) })));
  $('#codeGo').addEventListener('click', () => { const v = $('#newcode').value.trim().toUpperCase(); if (!v) return; code = v; teams = {}; session = null; connect(); render(true); });
  $$('[data-reset]').forEach((b) => b.addEventListener('click', () => { if (confirm(`${tname(teams[b.dataset.reset])}의 모든 기록을 지울까요?`)) store.resetTeam(code, b.dataset.reset); }));
}

boot();
