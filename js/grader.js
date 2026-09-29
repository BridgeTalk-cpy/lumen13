// 자유 작성 답안 판정기 (개념 판정)
// 반환: { ok, soft, reason, hintKey }
//   ok=true  → 통과
//   soft=true → 오답으로 세지 않고 다시 쓰게 함 (예: 사람 지목)
//   reason  → 화면에 보여줄 안내 문구(특수 오답일 때)

export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/씨에스|시에스|씨이에스/g, 'cs')
    .replace(/[\s\-_.,·ㆍ・'"“”‘’!?()\[\]{}~:;/\\|]+/g, '');
}

const has = (t, list) => list.some((w) => t.includes(w));
const count = (t, groups) => groups.filter((g) => has(t, g)).length;

// ── 공통 어휘 ─────────────────────────────
const SUBSTANCE = ['cs13', '시제품', '군중안정', '안정용', '신경물질', '신경성분'];
const QUESTION = ['왜', '어떻게', '무엇', '뭐', '어디', '어째서', '무슨', '까', '가?', '는가', '나?'];
const SPREAD = ['퍼', '분사', '노출', '공기', '뿌', '살포', '유입', '유출', '흘러', '나왔', '새어', '확산', '방출', '들어갔', '들어왔', '흡입', '연무'];
const PURPLE = ['보라'];
const DISTRACTOR_CAUSE = ['음식', '알레르기', '알러지', '고열', '더위', '열사병', '더워', '탈수', '식중독'];
const PERSON = ['담당자', '범인', '팀장', '박준호', '기술자', '직원이', '직원의', '작업자가', '작업자의', '스태프가', '누가작동', '누가분사', '누가했'];

// WHY1
const EXPOSE = ['노출', '흡입', '들이마', '들이켜', '마셔', '마셨', '마시', '접촉', '맡', '호흡', '퍼', '분사', '뿌', '살포', '공기', '작용', '영향', '중독', '닿', '묻', '반응'];

// WHY2
const UNAPPROVED = ['승인되지않', '승인안', '미승인', '승인목록에없', '승인없이', '승인받지않', '승인을받지않', '승인을안', '허가없이', '허가받지않', '허가되지않', '무단', '추가용기', '추가된용기', '추가로연결', '몰래', '불법', '승인외', '목록에없', '목록외'];
const UNSCHEDULED = ['예정에없', '예정되지않', '예정보다', '예정과다르', '일정에없', '일정과다르', '1715', '예정외', '예정시간전', '테스트전', '테스트시간이아닌', '예정전'];
const DEVICE = ['연무', '장치', '공급라인', '라인', '장비', '기계', '호스'];
const ACTION = ['작동', '분사', '뿌', '가동', '연결', '살포', '틀었', '켜', '방출'];

// WHY2 → 다음 질문
const POSSIBLE = ['승인', '허가', '가능', '막지', '못막', '허용', '될수', '할수', '확인', '절차', '관리', '검증', '점검', '통제', '걸러'];

// WHY3
const G_CHECK = ['확인', '재확인', '점검', '검증', '체크', '검수', '승인', '검토'];
const G_AUTH = ['권한', '단독', '혼자', '통제', '제어', '수동모드', '접근'];
const G_RESP = ['책임', '담당', '역할', '분장', '주체', '소관', '관리자'];
const G_PROC = ['절차', '규정', '프로세스', '체계', '기준', '매뉴얼', '규칙', '단계', '안내', '구조', '시스템'];
const LACK = ['없', '부재', '누락', '미흡', '불명확', '명확하지', '명확치', '모호', '빠져', '빠진', '부족', '않', '못', '불분명', '허술', '공백', '미비', '애매', '안했', '안됐', '안되', '안받', '안정해', '몰랐', '생략', '무시'];

const r = (ok, extra = {}) => ({ ok, soft: false, reason: '', ...extra });

// 답만 채점합니다. (다음 질문은 채점하지 않음)
export function gradeWhy(key, answer) {
  const a = norm(answer);
  if (a.length < 4) return r(false, { soft: true, reason: '답을 한 문장으로 작성해 주세요.' });

  if (key === 'why1') {
    return r(has(a, SUBSTANCE) && has(a, EXPOSE));
  }
  if (key === 'why2') {
    const okA = (has(a, UNAPPROVED) || has(a, UNSCHEDULED)) && (has(a, DEVICE) || has(a, ACTION));
    if (okA && has(a, PERSON)) return r(false, { soft: true, reason: '아직 누가 작동했는지는 판단하지 마십시오. \'누가\'가 아니라 \'어떻게\' 퍼졌는지를 써 주세요.' });
    return r(okA);
  }
  if (key === 'why3') {
    const c = count(a, [G_CHECK, G_AUTH, G_RESP, G_PROC]);
    return r(c >= 2 && has(a, LACK));
  }
  return r(false);
}

// ── ACT 2 점수 ─────────────────────────────
// 1차 정답 10 / 1차 오답 −2 / 힌트카드 −3 / 2차도 오답이면 강사 점수(최대값 = 남은 점수)
export function whyMax(w, cfg) {
  return cfg.pointsPerWhy - cfg.penaltyPerWrong * (w?.wrong ? 1 : 0) - (w?.hintCard ? cfg.hintCardPenalty : 0);
}
export function whyScore(w, manual, cfg) {
  if (!w) return { score: 0, pending: false };
  if (w.status === 'passed') return { score: whyMax(w, cfg), pending: false };
  if (w.status === 'manual') {
    if (typeof manual === 'number') return { score: manual, pending: false };
    return { score: 0, pending: true };
  }
  return { score: 0, pending: false };
}

// ── ACT 3 점수 ─────────────────────────────
export function scoreAct3(order, act3) {
  if (!Array.isArray(order) || order.filter(Boolean).length < 8) return { total: 0, parts: {} };
  const front = order.slice(0, 4);
  const back = order.slice(4, 8);
  const parts = {};
  let total = 0;
  for (const g of act3.groups) {
    const pool = g.where === 'front' ? front : back;
    const s = g.cards.filter((c) => pool.includes(c)).length * g.per;
    parts[g.key] = s;
    total += s;
  }
  const fo = front.join() === act3.answerFront.join() ? act3.orderBonus : 0;
  const bo = back.join() === act3.answerBack.join() ? act3.orderBonus : 0;
  parts.order = fo + bo;
  total += fo + bo;
  return { total, parts };
}

// ── ACT 4 점수 ─────────────────────────────
const W_WHO = ['장비담당', '기술담당', '장비기술', '장비관리자', '연무장치담당', '장비운영담당'];
const EVIDENCE = [
  ['제어실', '입실', '퇴실', '출입', '1714', '1718'],
  ['비워', '1735', '공식테스트', '예정된테스트', '테스트가있', '테스트핑계', '테스트라고'],
  ['삭제', '영상', '단말기', 'cctv'],
  ['권한', '수동모드', '기술담당자만'],
  ['예상보다', '반응이심', '메시지', '문자', '카톡'],
  ['1715', '수동분사', '분사기록', '작동기록'],
];
const MOTIVE = ['도입', '보류', '반대', '시스템', '선택', '필요성', '일부러', '고의', '의도', '팔', '판매', '계약', '영업', '시범', '효과'];
const HIDE = ['삭제', '영상', '기록', '보고', '숨기', '숨겼', '은폐', '감추', '감췄', '지우', '지웠', '입막', '알리지'];

export function scoreAct4(ans = {}) {
  const q1 = norm(ans.q1), q2 = norm(ans.q2), q3 = norm(ans.q3);
  const s1 = has(q1, W_WHO) ? 3 : 0;
  const ev = count(q2, EVIDENCE);
  const s2 = ev >= 2 ? 3 : ev === 1 ? 1 : 0;
  const s3 = (has(q3, MOTIVE) ? 2 : 0) + (has(q3, HIDE) ? 2 : 0);
  return { q1: s1, q2: s2, q3: s3, total: s1 + s2 + s3 };
}
