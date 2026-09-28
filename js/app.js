import { getStore } from './store.js';
import { ACT1, ACT2, ACT3, ACT4, DO_CARDS, PICKUPS, MAX_TEAMS, DEFAULT_TIMERS } from './content.js';
import { gradeWhy, scoreAct3, scoreAct4 } from './grader.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const now = () => Date.now();
const LS_ME = 'l13me';

let store, code, teamId, session = null, team = null;
let unTeam = null, unSess = null;
let renderedKey = '';
let fb = null;              // ACT2 피드백
let act3Order = null;       // ACT3 로컬 상태
let lastWhyIdx = -1;

// ── 유틸 ────────────────────────────────
// 데모 모드에서는 탭마다 다른 팀으로 테스트할 수 있도록 sessionStorage 사용
const meStore = () => (store?.mode === 'demo' ? sessionStorage : localStorage);
function loadMe() { try { return JSON.parse(meStore().getItem(LS_ME) || 'null'); } catch { return null; } }
function saveMe(v) { try { v ? meStore().setItem(LS_ME, JSON.stringify(v)) : meStore().removeItem(LS_ME); } catch {} }
const timers = {};
function debounceSave(path, value, statusEl) {
  clearTimeout(timers[path]);
  if (statusEl) statusEl.textContent = '저장 중…';
  timers[path] = setTimeout(async () => {
    await store.updateTeam(code, teamId, { [path]: value });
    if (statusEl) statusEl.textContent = '자동 저장됨';
  }, 500);
}
function flushSaves() { Object.values(timers).forEach(clearTimeout); }
function confirmModal(title, text, ok = '확인', cancel = '취소') {
  return new Promise((res) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal"><h3>${esc(title)}</h3><p>${esc(text)}</p><div class="btns">${cancel ? `<button class="btn" data-v="0">${esc(cancel)}</button>` : ''}<button class="btn primary" data-v="1">${esc(ok)}</button></div></div>`;
    bg.addEventListener('click', (e) => { const v = e.target.dataset?.v; if (v !== undefined) { bg.remove(); res(v === '1'); } });
    document.body.appendChild(bg);
  });
}
function setBottom(html) {
  const bb = $('#bottombar');
  if (!html) { bb.classList.add('hidden'); $('#bottom').innerHTML = ''; return; }
  $('#bottom').innerHTML = html; bb.classList.remove('hidden');
}

// ── 시작 ────────────────────────────────
async function boot() {
  store = await getStore();
  if (store.mode === 'demo') $('#demo').classList.remove('hidden');
  const params = new URLSearchParams(location.search);
  const me = loadMe();
  const urlCode = (params.get('s') || '').trim().toUpperCase();
  if (me && (!urlCode || urlCode === me.code)) { code = me.code; teamId = me.id; attach(); }
  else showJoin(urlCode || me?.code || 'CINOS');
  setInterval(tick, 1000);
}

function attach() {
  unTeam?.(); unSess?.();
  unSess = store.watchSession(code, (s) => { session = s; });
  unTeam = store.watchTeam(code, teamId, (t) => {
    if (!t) { saveMe(null); team = null; showJoin(code); return; }
    team = t; onTeam();
  });
}

// ── 입장 ────────────────────────────────
function showJoin(defCode) {
  unTeam?.(); unSess?.(); team = null; renderedKey = 'join';
  $('#teamtag').textContent = '';
  $('#timer').classList.add('hidden');
  let pick = null, count = MAX_TEAMS, curCode = defCode;
  $('#main').innerHTML = `
    <p class="kicker">MODULE 1 · 문제해결 게임</p>
    <h1>사라진 13분을<br>찾아라!</h1>
    <p class="lead">우리 팀 번호를 선택하고 시작하세요. 팀 휴대폰 한 대로 함께 작성합니다.</p>
    <div class="card">
      <label class="label" for="code">교육 코드</label>
      <input type="text" id="code" value="${esc(curCode)}" autocomplete="off" autocapitalize="characters">
      <div style="height:14px"></div>
      <span class="label">우리 팀</span>
      <div class="teams" id="teams"></div>
      <label class="label" for="tname">팀 이름 <small>선택 사항 · 비워 두면 ‘○팀’으로 표시됩니다</small></label>
      <input type="text" id="tname" maxlength="16" placeholder="예) 셜록팀">
    </div>`;
  const drawTeams = () => {
    $('#teams').innerHTML = Array.from({ length: count }, (_, i) => `<button class="teambtn ${pick === i + 1 ? 'on' : ''}" data-t="${i + 1}">${i + 1}팀</button>`).join('');
  };
  let un = null;
  const watch = () => { un?.(); un = store.watchSession(curCode, (s) => { count = Math.min(s?.teamCount || MAX_TEAMS, MAX_TEAMS); if (pick > count) pick = null; drawTeams(); upd(); }); };
  const upd = () => { const b = $('#startBtn'); if (b) b.disabled = !pick || !curCode; };
  $('#teams').addEventListener('click', (e) => { const t = e.target.closest('[data-t]'); if (!t) return; pick = +t.dataset.t; drawTeams(); upd(); });
  $('#code').addEventListener('change', (e) => { curCode = e.target.value.trim().toUpperCase(); e.target.value = curCode; watch(); upd(); });
  setBottom(`<button class="btn primary block" id="startBtn" disabled>ACT 1 시작하기</button>`);
  $('#startBtn').addEventListener('click', async () => {
    un?.();
    code = curCode; teamId = String(pick);
    const name = $('#tname').value.trim();
    await store.ensureTeam(code, teamId, { id: teamId, name: name || `${teamId}팀`, stage: 'act1', joinedAt: now(), stageStartedAt: { act1: now() } });
    if (name) await store.updateTeam(code, teamId, { name });
    saveMe({ code, id: teamId });
    renderedKey = '';
    attach();
  });
  drawTeams(); watch();
}

// ── 팀 상태 반영 ─────────────────────────
function keyFor(t) {
  let k = t.stage;
  if (t.stage === 'act2') k += JSON.stringify(ACT2.whys.map((w) => [t.act2?.[w.key]?.status, t.act2?.[w.key]?.wrong, (t.act2?.[w.key]?.attempts || []).length]));
  return k;
}
function onTeam() {
  $('#teamtag').textContent = team.name || `${teamId}팀`;
  const k = keyFor(team);
  if (k === renderedKey) return;
  renderedKey = k;
  render();
  tick();
}

function render() {
  const s = team.stage;
  if (s === 'act1') return renderAct1();
  if (s === 'pickup2') return renderPickup('act2', 'ACT 2 시작');
  if (s === 'act2') return renderAct2();
  if (s === 'pickup3') return renderPickup('act3', 'ACT 3 시작');
  if (s === 'act3') return renderAct3();
  if (s === 'pickup4') return renderPickup('act4', 'ACT 4 시작');
  if (s === 'act4') return renderAct4();
  if (s === 'done') return renderDone();
}

function tick() {
  const el = $('#timer');
  if (!team || !/^act[1-4]$/.test(team.stage)) { el.classList.add('hidden'); return; }
  const start = team.stageStartedAt?.[team.stage];
  const mins = session?.timers?.[team.stage] ?? DEFAULT_TIMERS[team.stage];
  if (!start || !mins) { el.classList.add('hidden'); return; }
  const left = Math.round((start + mins * 60000 - now()) / 1000);
  el.classList.remove('hidden', 'low', 'over');
  if (left <= 0) { el.textContent = '시간 종료'; el.classList.add('over'); return; }
  if (left <= 60) el.classList.add('low');
  el.textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
}

async function goStage(stage, extra = {}) {
  flushSaves();
  const patch = { stage, ...extra };
  if (/^act\d$/.test(stage)) patch[`stageStartedAt.${stage}`] = now();
  await store.updateTeam(code, teamId, patch);
  window.scrollTo(0, 0);
}

const teamSwitch = `<div class="center" style="margin-top:28px"><button class="link" id="switchTeam">팀 다시 선택하기</button></div>`;
function bindSwitch() {
  $('#switchTeam')?.addEventListener('click', async () => {
    if (await confirmModal('팀을 다시 선택할까요?', '작성한 내용은 그대로 남아 있습니다. 같은 팀 번호를 다시 고르면 이어서 할 수 있어요.', '다시 선택')) {
      saveMe(null); showJoin(code);
    }
  });
}

// ── ACT 1 ───────────────────────────────
function renderAct1() {
  const a = team.act1 || {};
  $('#main').innerHTML = `
    <p class="kicker">MODULE 1 · 문제해결 게임</p>
    <h1>${esc(ACT1.title)}</h1>
    <p class="lead">${esc(ACT1.intro)}</p>
    <div class="card">
      <span class="label">TO-BE · 기대 상태 <small>18:00에는 어떤 상태가 되어야 하는가?</small></span>
      <div class="fixed">${esc(ACT1.tobe)}</div>
    </div>
    <div class="card">
      <label class="label" for="asis">AS-IS · 현재 상태 <small>${esc(ACT1.asisQ)}</small></label>
      <textarea id="asis" placeholder="17:26 그림에서 달라진 점을 적어 주세요">${esc(a.asis)}</textarea>
      <div class="saved" id="s_asis"></div>
    </div>
    <div class="card">
      <label class="label" for="gap">GAP · 해결해야 할 차이 <small>${esc(ACT1.gapQ)}</small></label>
      <textarea id="gap" placeholder="입장을 방해하는 것만 골라 적어 주세요">${esc(a.gap)}</textarea>
      <div class="saved" id="s_gap"></div>
    </div>${teamSwitch}`;
  bindSwitch();
  ['asis', 'gap'].forEach((f) => $('#' + f).addEventListener('input', (e) => { debounceSave(`act1.${f}`, e.target.value, $('#s_' + f)); upd(); }));
  setBottom(`<button class="btn primary block" id="sub1">제출하고 다음으로</button>`);
  const upd = () => { $('#sub1').disabled = !($('#asis').value.trim() && $('#gap').value.trim()); };
  upd();
  $('#sub1').addEventListener('click', async () => {
    if (!(await confirmModal('ACT 1을 제출할까요?', '제출하면 수정할 수 없어요.', '제출'))) return;
    await goStage('pickup2', { 'act1.asis': $('#asis').value, 'act1.gap': $('#gap').value, 'act1.submittedAt': now() });
  });
}

// ── 카드 받으러 오기 ──────────────────────
function renderPickup(act, btnLabel) {
  setBottom(`<button class="btn primary block" id="go">카드를 받았어요 · ${esc(btnLabel)}</button>`);
  $('#main').innerHTML = `
    <div class="center pickup">
      <div class="big-emoji">🗂️</div>
      <p class="kicker">미션 완료!</p>
      <h1>강사님께 카드를<br>받으러 오세요</h1>
      <div class="what">${esc(PICKUPS[act])}</div>
      <p class="muted">카드를 받은 뒤 아래 버튼을 누르면<br>다음 미션과 타이머가 시작됩니다.</p>
    </div>${teamSwitch}`;
  bindSwitch();
  $('#go').addEventListener('click', () => goStage(act));
}

// ── ACT 2 ───────────────────────────────
function currentWhyIdx() {
  return ACT2.whys.findIndex((w) => !['passed', 'manual'].includes(team.act2?.[w.key]?.status));
}
function renderAct2() {
  const cur = currentWhyIdx();
  const parts = [`<p class="kicker">MODULE 1 · 문제해결 게임</p><h1>${esc(ACT2.title)}</h1><p class="lead">${esc(ACT2.intro)}</p>`];
  ACT2.whys.forEach((w, i) => {
    if (cur !== -1 && i > cur) return;
    const d = team.act2?.[w.key] || {};
    const head = `<div class="row"><span class="kicker" style="margin:0">${w.label}</span>${d.status === 'passed' ? '<span class="badge ok">통과</span>' : d.status === 'manual' ? '<span class="badge manual">강사 채점</span>' : '<span class="badge open">진행 중</span>'}</div>
      <div class="whyq">${esc(w.question)}</div>`;
    if (i !== cur) {
      parts.push(`<div class="card ${d.status === 'passed' ? 'done' : 'manual'}">${head}
        <div class="lockedtext"><span class="k">우리 팀의 답</span>${esc(d.answer)}</div>
        ${w.hasNext ? `<div class="lockedtext"><span class="k">이어서 할 질문</span>${esc(d.next)}</div>` : ''}</div>`);
      return;
    }
    const wrong = d.wrong || 0;
    const f = fb && fb.key === w.key ? fb : null;
    parts.push(`<div class="card gold" id="curwhy">${head}
      <div class="whybody">${w.body.map((p) => `<p>${esc(p)}</p>`).join('')}</div>
      <div class="note">${esc(w.note)}</div>
      <div style="height:14px"></div>
      <div class="field"><label class="label" for="ans">우리 팀의 답 <small>한 문장으로 작성</small></label>
        <textarea id="ans">${esc(d.answer)}</textarea></div>
      ${w.hasNext ? `<div class="field"><label class="label" for="nxt">다음에 이어서 할 수 있는 질문은?</label>
        <textarea id="nxt" style="min-height:72px">${esc(d.next)}</textarea></div>` : ''}
      <div class="row"><span class="tries">틀린 횟수 ${wrong} / ${ACT2.maxTries}</span><span class="saved" id="s_ans"></span></div>
      ${f ? `<div class="feedback ${f.type}"><span class="t">${esc(f.title)}</span>${esc(f.text)}</div>` : ''}
      <div style="height:12px"></div>
      <button class="btn primary block" id="check">정답 확인</button>
    </div>`);
  });
  // 이전 WHY에서 넘어온 피드백(통과/강사채점) 표시
  if (fb && (cur === -1 || fb.key !== ACT2.whys[cur].key) && (fb.type === 'ok' || fb.type === 'manual-info')) {
    parts.splice(parts.length - 1, 0, `<div class="feedback ${fb.type === 'ok' ? 'ok' : 'soft'}" style="margin:0 0 14px"><span class="t">${esc(fb.title)}</span>${esc(fb.text)}</div>`);
  }
  if (cur === -1) {
    parts.push(`<div class="card gold"><label class="label" for="core">핵심 원인 <small>${esc(ACT2.coreQ)}</small></label>
      <textarea id="core">${esc(team.act2?.core)}</textarea><div class="saved" id="s_core"></div></div>`);
    setBottom(`<button class="btn primary block" id="sub2">ACT 2 제출하고 다음으로</button>`);
  } else setBottom('');
  $('#main').innerHTML = parts.join('') + teamSwitch;
  bindSwitch();

  if (cur === -1) {
    const upd = () => { $('#sub2').disabled = !$('#core').value.trim(); };
    $('#core').addEventListener('input', (e) => { debounceSave('act2.core', e.target.value, $('#s_core')); upd(); });
    upd();
    $('#sub2').addEventListener('click', async () => {
      if (!(await confirmModal('ACT 2를 제출할까요?', '제출하면 수정할 수 없어요.', '제출'))) return;
      fb = null;
      await goStage('pickup3', { 'act2.core': $('#core').value, 'act2.submittedAt': now() });
    });
    return;
  }
  const w = ACT2.whys[cur];
  $('#ans').addEventListener('input', (e) => debounceSave(`act2.${w.key}.answer`, e.target.value, $('#s_ans')));
  $('#nxt')?.addEventListener('input', (e) => debounceSave(`act2.${w.key}.next`, e.target.value, $('#s_ans')));
  $('#check').addEventListener('click', () => checkWhy(w));
  if (lastWhyIdx !== cur) { lastWhyIdx = cur; if (cur > 0) setTimeout(() => $('#curwhy')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); }
}

async function checkWhy(w) {
  const btn = $('#check'); btn.disabled = true;
  flushSaves();
  const ans = $('#ans').value, nxt = w.hasNext ? $('#nxt').value : '';
  const d = team.act2?.[w.key] || {};
  const g = gradeWhy(w.key, ans, nxt);
  const attempts = [...(d.attempts || []), { a: ans, n: nxt, ok: g.ok, soft: !!g.soft, at: now() }];
  const base = `act2.${w.key}`;
  const patch = { [`${base}.answer`]: ans, [`${base}.next`]: nxt, [`${base}.attempts`]: attempts };
  if (g.ok) {
    patch[`${base}.status`] = 'passed'; patch[`${base}.passedAt`] = now();
    fb = { key: w.key, type: 'ok', title: `${w.label} 통과!`, text: w.hasNext ? '다음 WHY가 열렸습니다.' : '마지막으로 핵심 원인을 정리해 주세요.' };
  } else if (g.soft) {
    fb = { key: w.key, type: 'soft', title: '조금만 더 작성해 주세요', text: g.reason };
  } else {
    const wrong = (d.wrong || 0) + 1;
    patch[`${base}.wrong`] = wrong;
    if (wrong >= ACT2.maxTries) {
      patch[`${base}.status`] = 'manual'; patch[`${base}.manualAt`] = now();
      fb = { key: w.key, type: 'manual-info', title: '강사님이 직접 채점할게요', text: w.hasNext ? '작성한 답은 저장되었습니다. 다음 WHY로 넘어갑니다.' : '작성한 답은 저장되었습니다. 핵심 원인을 정리해 주세요.' };
    } else {
      const hint = g.part === 'next'
        ? '이어서 할 질문은 ‘방금 찾은 원인’이 왜, 어떻게 생겼는지를 묻는 질문이어야 합니다.'
        : w.hints[wrong - 1];
      const text = [g.reason, hint].filter(Boolean).join(' ');
      fb = { key: w.key, type: 'bad', title: `다시 확인해 보세요 (${wrong}/${ACT2.maxTries})`, text };
      if (w.hintCardOnSecond && wrong === 2) patch['act2.hintCard'] = 'need';
    }
  }
  await store.updateTeam(code, teamId, patch);
  if (g.soft) { renderedKey = ''; onTeam(); }
}

// ── ACT 3 ───────────────────────────────
function renderAct3() {
  if (!act3Order) act3Order = Array.isArray(team.act3?.draft) ? [...team.act3.draft] : Array(8).fill(null);
  const used = new Set(act3Order.filter(Boolean));
  const nextIdx = act3Order.findIndex((x) => !x);
  const slot = (i) => `<button class="slot ${act3Order[i] ? 'filled' : ''} ${i === nextIdx ? 'next' : ''}" data-slot="${i}"><span class="n">${i + 1}번째</span><span class="v">${act3Order[i] || ''}</span></button>`;
  $('#main').innerHTML = `
    <p class="kicker">MODULE 1 · 문제해결 게임</p>
    <h1>${esc(ACT3.title)}</h1>
    <p class="lead">${esc(ACT3.intro)}</p>
    <div class="card">
      <div class="slotgroup"><div class="gl">18:00 개장 전 · 먼저 할 일</div><div class="slots">${[0, 1, 2, 3].map(slot).join('')}</div></div>
      <div class="slotgroup after"><div class="gl">개장 후 · 이어서 할 일</div><div class="slots">${[4, 5, 6, 7].map(slot).join('')}</div></div>
      <p class="muted" style="font-size:13px;margin:4px 0 0">카드를 누르면 빈칸에 순서대로 들어갑니다. 채워진 칸을 누르면 빠집니다.</p>
    </div>
    <div class="cards">${DO_CARDS.map((c) => `<button class="docard" data-no="${c.no}" ${used.has(c.no) ? 'disabled' : ''}><span class="no">${c.no}</span><span class="tt">${esc(c.title)}</span></button>`).join('')}</div>
    ${teamSwitch}`;
  bindSwitch();
  const save = () => store.updateTeam(code, teamId, { 'act3.draft': act3Order });
  $('#main').querySelectorAll('[data-no]').forEach((b) => b.addEventListener('click', () => {
    const i = act3Order.findIndex((x) => !x); if (i < 0) return;
    act3Order[i] = b.dataset.no; save(); renderAct3();
  }));
  $('#main').querySelectorAll('[data-slot]').forEach((b) => b.addEventListener('click', () => {
    const i = +b.dataset.slot; if (!act3Order[i]) return;
    act3Order[i] = null; save(); renderAct3();
  }));
  const full = act3Order.every(Boolean);
  setBottom(`<button class="btn primary block" id="sub3" ${full ? '' : 'disabled'}>${full ? '순서 제출하기' : `카드 ${act3Order.filter(Boolean).length} / 8`}</button>`);
  $('#sub3').addEventListener('click', async () => {
    if (!(await confirmModal('이 순서로 제출할까요?', `먼저: ${act3Order.slice(0, 4).join(' → ')}\n이후: ${act3Order.slice(4).join(' → ')}\n제출하면 수정할 수 없어요.`, '제출'))) return;
    const sc = scoreAct3(act3Order, ACT3);
    const order = [...act3Order]; act3Order = null;
    await goStage('pickup4', { 'act3.order': order, 'act3.score': sc.total, 'act3.parts': sc.parts, 'act3.submittedAt': now() });
  });
}

// ── ACT 4 ───────────────────────────────
function renderAct4() {
  const a = team.act4 || {};
  $('#main').innerHTML = `
    <p class="kicker">MODULE 1 · 보너스 미션</p>
    <h1>${esc(ACT4.title)}</h1>
    <p class="lead">${esc(ACT4.intro)}</p>
    <div class="card"><span class="label">앞에서 확인된 사실</span><div class="fixed" style="font-weight:500">${esc(ACT4.fact)}</div>
      <div class="note">${esc(ACT4.note)}</div></div>
    ${ACT4.questions.map((q, i) => `<div class="card"><label class="label" for="${q.key}">${i + 1}. ${esc(q.q)}</label>
      <textarea id="${q.key}" ${q.key === 'q1' ? 'style="min-height:60px"' : ''}>${esc(a[q.key])}</textarea><div class="saved" id="s_${q.key}"></div></div>`).join('')}
    ${teamSwitch}`;
  bindSwitch();
  setBottom(`<button class="btn primary block" id="sub4">최종 제출하기</button>`);
  const upd = () => { $('#sub4').disabled = !ACT4.questions.every((q) => $('#' + q.key).value.trim()); };
  ACT4.questions.forEach((q) => $('#' + q.key).addEventListener('input', (e) => { debounceSave(`act4.${q.key}`, e.target.value, $('#s_' + q.key)); upd(); }));
  upd();
  $('#sub4').addEventListener('click', async () => {
    if (!(await confirmModal('최종 제출할까요?', '제출하면 수정할 수 없어요.', '제출'))) return;
    const ans = Object.fromEntries(ACT4.questions.map((q) => [q.key, $('#' + q.key).value]));
    const auto = scoreAct4(ans);
    await goStage('done', { 'act4.q1': ans.q1, 'act4.q2': ans.q2, 'act4.q3': ans.q3, 'act4.auto': auto, 'act4.submittedAt': now() });
  });
}

function renderDone() {
  setBottom('');
  $('#main').innerHTML = `
    <div class="center pickup">
      <div class="big-emoji">🔎</div>
      <p class="kicker">모든 미션 완료</p>
      <h1>수고하셨습니다!</h1>
      <p class="muted">이제 강사 화면을 봐 주세요.<br>팀별 답과 점수를 함께 확인합니다.</p>
    </div>${teamSwitch}`;
  bindSwitch();
}

boot();
