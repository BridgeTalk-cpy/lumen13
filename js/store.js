// 데이터 저장소: Firebase(Firestore) 또는 데모(브라우저 localStorage)
import { firebaseConfig } from './firebase-config.js';

const FB_VER = '10.12.2';

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof o[keys[i]] !== 'object' || o[keys[i]] === null) o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}

// ── 데모 모드 ─────────────────────────────
function makeDemo() {
  const KEY = 'l13db';
  const listeners = new Set();
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
  const write = (db) => { localStorage.setItem(KEY, JSON.stringify(db)); listeners.forEach((f) => f()); };
  window.addEventListener('storage', (e) => { if (e.key === KEY) listeners.forEach((f) => f()); });
  const sess = (db, code) => (db[code] ||= { doc: {}, teams: {} });
  const sub = (fn) => { listeners.add(fn); fn(); return () => listeners.delete(fn); };
  return {
    mode: 'demo',
    watchSession: (code, cb) => sub(() => cb(read()[code]?.doc || null)),
    async setSession(code, patch) { const db = read(); const s = sess(db, code); Object.entries(patch).forEach(([k, v]) => setPath(s.doc, k, v)); write(db); },
    watchTeam: (code, id, cb) => sub(() => cb(read()[code]?.teams?.[id] || null)),
    watchTeams: (code, cb) => sub(() => cb(read()[code]?.teams || {})),
    async ensureTeam(code, id, init) { const db = read(); const s = sess(db, code); if (!s.teams[id]) { s.teams[id] = init; write(db); } },
    async updateTeam(code, id, patch) { const db = read(); const s = sess(db, code); s.teams[id] ||= { id }; Object.entries(patch).forEach(([k, v]) => setPath(s.teams[id], k, v)); write(db); },
    async resetTeam(code, id) { const db = read(); const s = sess(db, code); delete s.teams[id]; write(db); },
  };
}

// ── Firebase 모드 ─────────────────────────
async function makeFirebase(cfg) {
  const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-app.js`);
  const fs = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-firestore.js`);
  const app = initializeApp(cfg);
  const db = fs.getFirestore(app);
  const sRef = (code) => fs.doc(db, 'sessions', code);
  const tRef = (code, id) => fs.doc(db, 'sessions', code, 'teams', String(id));
  return {
    mode: 'firebase',
    watchSession: (code, cb) => fs.onSnapshot(sRef(code), (d) => cb(d.exists() ? d.data() : null)),
    async setSession(code, patch) {
      await fs.setDoc(sRef(code), {}, { merge: true });
      await fs.updateDoc(sRef(code), patch);
    },
    watchTeam: (code, id, cb) => fs.onSnapshot(tRef(code, id), (d) => cb(d.exists() ? d.data() : null)),
    watchTeams: (code, cb) => fs.onSnapshot(fs.collection(db, 'sessions', code, 'teams'), (qs) => {
      const out = {}; qs.forEach((d) => { out[d.id] = d.data(); }); cb(out);
    }),
    async ensureTeam(code, id, init) {
      const snap = await fs.getDoc(tRef(code, id));
      if (!snap.exists()) await fs.setDoc(tRef(code, id), init);
    },
    async updateTeam(code, id, patch) {
      try { await fs.updateDoc(tRef(code, id), patch); }
      catch (e) { await fs.setDoc(tRef(code, id), { id: String(id) }, { merge: true }); await fs.updateDoc(tRef(code, id), patch); }
    },
    async resetTeam(code, id) { await fs.deleteDoc(tRef(code, id)); },
  };
}

export async function getStore() {
  if (firebaseConfig && firebaseConfig.projectId) {
    try { return await makeFirebase(firebaseConfig); }
    catch (e) { console.error('Firebase 연결 실패, 데모 모드로 전환', e); }
  }
  return makeDemo();
}
