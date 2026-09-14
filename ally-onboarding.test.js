// Tests for ally-onboarding.html, section 12 of claude_change_spec.md.
// Run with:  node --test
// The engine block is extracted from the HTML file and evaluated in a bare
// vm context, so these tests exercise the exact code that ships.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const loose = require('node:assert');
// vm-realm arrays carry a different prototype; compare structure, not identity
const same = (a, b, msg) => loose.deepEqual(a, b, msg);
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML_PATH = path.join(__dirname, 'ally-onboarding.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'manifest.json'), 'utf8'));

function block(id) {
  const re = new RegExp(`<script type="module" id="${id}">([\\s\\S]*?)</script>`);
  const m = html.match(re);
  if (!m) throw new Error(`script block #${id} not found`);
  return m[1];
}
const engineSrc = block('ally-engine');
const appSrc = block('ally-app');

const sandbox = vm.createContext({});
vm.runInContext(engineSrc, sandbox, { filename: 'ally-engine.js' });
const E = sandbox.AllyEngine;
assert.ok(E, 'engine exported to globalThis.AllyEngine');

// ---- helpers ----
function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    clear: () => m.clear(),
    dump: () => Object.fromEntries(m),
  };
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomAnswers() {
  const q11 = [];
  const tags = [...E.INTEREST_TAGS];
  const n = Math.floor(Math.random() * 4);
  for (let i = 0; i < n; i++) q11.push(tags.splice(Math.floor(Math.random() * tags.length), 1)[0]);
  return {
    q5: pick(E.DISCLOSURE_STOPS),
    q6: Math.random(),
    q7: Math.random(),
    q8: pick(E.STRUCTURE_STOPS),
    q9: Math.random(),
    q10: pick(E.PRESSURES),
    q11,
  };
}
function answersForCore(c, q10 = c.owns) {
  return { q5: c.disclosure, q6: c.warmth, q7: c.push, q8: c.structure, q9: c.nostalgia, q10, q11: [] };
}
function subsets(arr, maxSize) {
  const out = [[]];
  for (let size = 1; size <= maxSize; size++) {
    const rec = (start, cur) => {
      if (cur.length === size) { out.push([...cur]); return; }
      for (let i = start; i < arr.length; i++) rec(i + 1, [...cur, arr[i]]);
    };
    rec(0, []);
  }
  return out;
}
const isoDaysAgo = (years, extraDays, base = new Date()) => {
  const d = new Date(base.getFullYear() - years, base.getMonth(), base.getDate() + extraDays);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// =====================================================================
// Matching
// =====================================================================
test('1. identical answers produce an identical core across 100 runs', () => {
  const a = randomAnswers();
  const first = E.computeCore(a);
  for (let i = 0; i < 100; i++) {
    const again = E.computeCore(a);
    same(again, first);
  }
});

test('2. every one of the six cores is reachable by some answer combination', () => {
  const reached = new Set();
  for (const c of E.CORES) reached.add(E.computeCore(answersForCore(c)).primary);
  same([...reached].sort(), E.CORES.map(c => c.id).sort());
});

test('3. a user whose vector exactly matches a core scores that core first', () => {
  for (const c of E.CORES) {
    // with its own pressure
    assert.equal(E.scoreCores(answersForCore(c))[0].id, c.id);
    // and with no pressure boost anywhere
    assert.equal(E.scoreCores(answersForCore(c, null))[0].id, c.id);
  }
});

test('4. the pressure boost is exactly 1.15x and applies to exactly one core', () => {
  for (let run = 0; run < 200; run++) {
    const a = randomAnswers();
    const boosted = new Map(E.scoreCores(a).map(r => [r.id, r.score]));
    const plain = new Map(E.scoreCores({ ...a, q10: null }).map(r => [r.id, r.score]));
    const changed = [...boosted.keys()].filter(id => boosted.get(id) !== plain.get(id));
    assert.equal(changed.length, 1, `exactly one core changed for q10=${a.q10}`);
    const id = changed[0];
    assert.equal(E.CORES.find(c => c.id === id).owns, a.q10);
    // within 4-decimal rounding of the published scores
    assert.ok(Math.abs(boosted.get(id) - plain.get(id) * 1.15) < 0.0002, `ratio for ${id}`);
  }
});

test('5. top-two gap below 0.06 produces a blend with weight 70', () => {
  let found = 0;
  for (let i = 0; i < 20000 && found < 25; i++) {
    const ranked = E.scoreCores(randomAnswers());
    if (ranked[0].score - ranked[1].score < 0.06) {
      const r = E.assignCore(ranked);
      assert.equal(r.weight, 70);
      assert.equal(r.primary, ranked[0].id);
      assert.notEqual(r.secondary, null);
      assert.notEqual(r.secondary, r.primary);
      found++;
    }
  }
  assert.ok(found > 0, 'found near-tie vectors');
});

test('6. top-two gap of 0.06 or above gives secondary null and weight 100', () => {
  let found = 0;
  for (let i = 0; i < 20000 && found < 25; i++) {
    const ranked = E.scoreCores(randomAnswers());
    if (ranked[0].score - ranked[1].score >= 0.06) {
      const r = E.assignCore(ranked);
      assert.equal(r.weight, 100);
      assert.equal(r.secondary, null);
      assert.equal(r.primary, ranked[0].id);
      found++;
    }
  }
  assert.ok(found > 0, 'found clear-gap vectors');
  // exact boundary
  const r = E.assignCore([{ id:'A', score:0.80 }, { id:'B', score:0.74 }, { id:'C', score:0.5 }]);
  same(r, { primary:'A', secondary:null, weight:100 });
});

test('7. KIAAN is never secondary across a 10,000-run random sweep', () => {
  for (let i = 0; i < 10000; i++) {
    const r = E.computeCore(randomAnswers());
    assert.notEqual(r.secondary, 'KIAAN');
  }
  // and the explicit near-tie case where KIAAN is second
  const r = E.assignCore([{ id:'PRIYA', score:0.90 }, { id:'KIAAN', score:0.89 }, { id:'ANAY', score:0.70 }]);
  assert.equal(r.secondary, 'ANAY');
});

test('8. Q11 interests do not change the assigned core', () => {
  for (let run = 0; run < 20; run++) {
    const base = randomAnswers();
    const perms = subsets(E.INTEREST_TAGS, 3);
    assert.equal(perms.length, 93);
    const cores = new Set(perms.map(q11 => {
      const r = E.computeCore({ ...base, q11 });
      return `${r.primary}/${r.secondary}/${r.weight}`;
    }));
    assert.equal(cores.size, 1);
  }
});

// =====================================================================
// Deck
// =====================================================================
test('9. orderDeck returns exactly 16 of the selected gender, no duplicates, no omissions', () => {
  for (const gender of ['woman', 'man']) {
    const set = E.deckTemplates(manifest.templates, gender);
    assert.equal(set.length, 16);
    for (let run = 0; run < 50; run++) {
      const user = { region: pick(['North','West','East','Northeast','Central','South','Outside India','Unspecified']), age: 18 + Math.floor(Math.random() * 25), interests: randomAnswers().q11 };
      const out = E.orderDeck(set, user);
      assert.equal(out.length, 16);
      assert.ok(out.every(t => t.gender === gender));
      assert.equal(new Set(out.map(t => t.id)).size, 16);
      same(out.map(t => t.id).sort(), set.map(t => t.id).sort());
    }
  }
});

test('10. over 500 runs with identical input, at least two distinct orderings appear', () => {
  const set = E.deckTemplates(manifest.templates, 'woman');
  const user = { region:'West', age:24, interests:['making','screen'] };
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(E.orderDeck(set, user).map(t => t.id).join(','));
  assert.ok(seen.size >= 2, `distinct orderings: ${seen.size}`);
});

test('11. overlap returns 0 for an empty pick array and 1 when every pick is matched', () => {
  assert.equal(E.overlap(['music','food'], []), 0);
  assert.equal(E.overlap(['music','food'], null), 0);
  assert.equal(E.overlap(['music','food'], undefined), 0);
  assert.equal(E.overlap(['music','food'], ['music','food']), 1);
  assert.equal(E.overlap(['music','food','people'], ['food']), 1);
  assert.equal(E.overlap(['music'], ['music','food']), 0.5);
  assert.equal(E.overlap([], ['music']), 0);
});

test('12. propose only ever returns a member of the pool', () => {
  for (let run = 0; run < 2000; run++) {
    const n = 1 + Math.floor(Math.random() * 8);
    const pool = Array.from({ length: n }, (_, i) => `T${i}`);
    const dwell = Object.fromEntries(pool.map(id => [id, Math.random() * 20000]));
    assert.ok(pool.includes(E.propose(pool, dwell)));
  }
  // pool member with no dwell record at all
  assert.ok(['A','B'].includes(E.propose(['A','B'], {})));
});

test('13. propose never returns null when the pool is non-empty', () => {
  for (let run = 0; run < 2000; run++) {
    const pool = ['A','B','C'].slice(0, 1 + Math.floor(Math.random() * 3));
    assert.notEqual(E.propose(pool, { A: 0, B: 15000, C: 999999 }), null);
  }
  assert.equal(E.propose([], {}), null);
});

test('14. over 5,000 runs a 12,000ms card beats a 2,000ms card and the 2,000ms card still appears', () => {
  const counts = { hi: 0, lo: 0 };
  for (let i = 0; i < 5000; i++) counts[E.propose(['hi','lo'], { hi: 12000, lo: 2000 })]++;
  assert.ok(counts.hi > counts.lo, `hi=${counts.hi} lo=${counts.lo}`);
  assert.ok(counts.lo >= 1, `lo proposed ${counts.lo} times`);
});

test('15. dwell above 15,000ms is capped', () => {
  assert.equal(E.dwellWeight(15000), E.dwellWeight(99999999));
  assert.equal(E.dwellWeight(15000), E.dwellWeight(15001));
  assert.ok(E.dwellWeight(14999) < E.dwellWeight(15000));
  let d = {};
  for (let i = 0; i < 40; i++) d = E.addDwell(d, 'X', 1000);
  assert.equal(d.X, 15000);
  // proposal weighting treats 15,000 and 50,000 identically
  let a = 0, b = 0;
  for (let i = 0; i < 6000; i++) (E.propose(['a','b'], { a: 15000, b: 50000 }) === 'a' ? a++ : b++);
  assert.ok(Math.abs(a - b) < 400, `a=${a} b=${b}`);
});

// =====================================================================
// Gate
// =====================================================================
test('16. DOB exactly 18 years ago today passes; one day later fails', () => {
  const today = new Date();
  const exactly18 = isoDaysAgo(18, 0, today);
  const oneDayShort = isoDaysAgo(18, 1, today);
  assert.equal(E.ageAt(exactly18, today), 18);
  assert.equal(E.ageAt(oneDayShort, today), 17);
  const st = E.initialState();
  const pass = E.applyGate(st, exactly18, today, fakeStorage());
  assert.equal(pass.age, 18);
  assert.equal(pass.dob, exactly18);
  assert.notEqual(pass.screen, E.S.blocked);
  const fail = E.applyGate(st, oneDayShort, today, fakeStorage());
  assert.equal(fail.screen, E.S.blocked);
  // fixed-date check independent of the clock
  assert.equal(E.ageAt('2008-09-14', new Date(2026, 8, 14)), 18);
  assert.equal(E.ageAt('2008-09-15', new Date(2026, 8, 14)), 17);
  assert.equal(E.ageAt('2008-02-29', new Date(2026, 1, 28)), 17);
  assert.equal(E.ageAt('2008-02-29', new Date(2026, 2, 1)), 18);
});

test('17. failing the gate leaves no DOB in the persisted state', () => {
  const today = new Date();
  const storage = fakeStorage();
  const st = { ...E.initialState(), dob: '1990-01-01', age: 36, screen: E.S.birthday };
  const out = E.applyGate(st, isoDaysAgo(17, 0, today), today, storage);
  assert.equal(out.dob, null);
  assert.equal(out.age, null);
  const persisted = E.serialize(out, today);
  assert.ok(!persisted.includes('1990-01-01'));
  assert.equal(JSON.parse(persisted).state.dob, null);
  assert.equal(JSON.parse(persisted).state.age, null);
  // and the device flag is 180 days out
  const until = Number(storage.getItem(E.BLOCK_KEY));
  assert.equal(until, today.getTime() + 180 * 86400000);
});

test('18. a future ally_blocked_until short-circuits to the blocked screen on boot', () => {
  const now = new Date();
  const future = fakeStorage({ ally_blocked_until: String(now.getTime() + 1000), ally_session: E.serialize({ ...E.initialState(), screen: 9 }, now) });
  const b = E.bootDecision(future, now);
  assert.equal(b.mode, 'blocked');
  assert.equal(b.state.screen, E.S.blocked);
  const past = fakeStorage({ ally_blocked_until: String(now.getTime() - 1000) });
  assert.equal(E.bootDecision(past, now).mode, 'fresh');
  // resume windows
  const day = 86400000;
  const saved = screen => E.serialize({ ...E.initialState(), screen }, new Date(now.getTime() - 0));
  const at = (ms, screen = 9) => fakeStorage({ ally_session: JSON.stringify({ savedAt: now.getTime() - ms, state: { ...E.initialState(), screen } }) });
  assert.equal(E.bootDecision(at(3 * day), now).mode, 'resume');
  assert.equal(E.bootDecision(at(3 * day), now).state.screen, 9);
  assert.equal(E.bootDecision(at(10 * day), now).mode, 'choose');
  assert.equal(E.bootDecision(at(40 * day), now).mode, 'fresh');
  assert.equal(E.bootDecision(at(40 * day), now).state.screen, 0);
  void saved;
});

// =====================================================================
// Flow
// =====================================================================
test('19. no code path sets state.locked without an explicit confirm action', () => {
  // (a) Static: every non-null write to `locked` in the whole build lives
  //     inside confirmLock, and confirmLock is called from exactly one place,
  //     the handler wired to the "Yes, it's them" button.
  const all = engineSrc + '\n' + appSrc;
  const writes = [...all.matchAll(/\blocked\s*[:=](?!=)\s*([^,\n;]*)/g)]
    .filter(m => m[1].trim() !== 'null');
  assert.equal(writes.length, 1, `non-null writes to locked: ${writes.map(m => m[0]).join(' | ')}`);
  const fnStart = engineSrc.indexOf('function confirmLock(');
  const fnEnd = engineSrc.indexOf('\n}\n', fnStart);
  assert.ok(fnStart >= 0 && fnEnd > fnStart);
  const inside = engineSrc.slice(fnStart, fnEnd).includes(writes[0][0]);
  assert.ok(inside, 'the single locked write is inside confirmLock');
  const calls = [...appSrc.matchAll(/confirmLock\(/g)];
  assert.equal(calls.length, 1, 'confirmLock is called from exactly one place in the app');
  const handlerStart = appSrc.indexOf('function onConfirmYes(');
  const handlerEnd = appSrc.indexOf('\n}\n', handlerStart);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, 'onConfirmYes handler exists');
  assert.ok(calls[0].index > handlerStart && calls[0].index < handlerEnd, 'the call is inside onConfirmYes');
  const wiring = appSrc.match(/#confirm-yes[^\n]*onConfirmYes|onConfirmYes[^\n]*#confirm-yes/);
  assert.ok(wiring, 'onConfirmYes is wired to #confirm-yes');
  const refs = [...appSrc.matchAll(/onConfirmYes/g)];
  assert.equal(refs.length, 2, 'onConfirmYes appears exactly twice: definition and wiring');
  const button = html.match(/id="confirm-yes"[^>]*>([^<]*)</);
  assert.ok(button && button[1].trim() === "Yes, it's them", 'the wired button carries the confirm copy');

  // (b) Behavioural: drive every state-changing engine function with random
  //     input and confirm locked stays null throughout.
  const now = new Date();
  let st = E.initialState();
  for (let i = 0; i < 2000; i++) {
    const a = randomAnswers();
    st = { ...st, answers: a, core: E.computeCore(a) };
    st = E.applyGate(st, isoDaysAgo(18 + Math.floor(Math.random() * 20), 0, now), now, fakeStorage());
    const set = E.deckTemplates(manifest.templates, pick(['woman','man']));
    st.deckOrder = E.orderDeck(set, { region:'West', age: st.age, interests: a.q11 }).map(t => t.id);
    st.liked = st.deckOrder.filter(() => Math.random() < 0.3);
    st.dwell = Object.fromEntries(st.deckOrder.map(id => [id, Math.random() * 20000]));
    st.redraws = Math.floor(Math.random() * 5);
    st.poolRemoved = st.liked.filter(() => Math.random() < 0.5);
    const p = E.nextProposal(st);
    st = { ...st, proposed: p.proposed };
    st = E.invalidate(st, pick(['q1','q2','q3','q4','q5','q10','q11'])).state;
    st = E.bootDecision(fakeStorage({ ally_session: E.serialize(st, now) }), now).state;
    assert.equal(st.locked, null);
  }
  assert.equal(E.confirmLock(st, 'F01', now).locked, 'F01');
});

test('20. changing Q2 clears liked, dwell and proposed', () => {
  const st = {
    ...E.initialState(),
    deckGender: 'woman',
    deckOrder: ['F01','F02','F03'], deckIndex: 2, deckHistory: [{ id:'F01', dir:'like' }],
    dwell: { F01: 4000, F02: 900 }, liked: ['F01'], expanded: ['F02'],
    proposed: 'F01', proposalsSeen: 2, poolRemoved: ['F02'], redraws: 1,
    core: { primary:'MEHER', secondary:null, weight:100, ranked:[{ id:'MEHER', score:0.9 }] },
  };
  const { state: out, changed } = E.invalidate(st, 'q2');
  assert.equal(changed, true);
  same(out.liked, []);
  same(out.dwell, {});
  assert.equal(out.proposed, null);
  same(out.deckOrder, []);
  same(out.expanded, []);
  assert.equal(out.proposalsSeen, 0);
  same(out.poolRemoved, []);
  assert.equal(out.deckIndex, 0);
  // core is untouched by a gender change
  assert.equal(out.core.primary, 'MEHER');
  // Q1 invalidates only the order, keeping dwell and liked
  const q1 = E.invalidate(st, 'q1').state;
  same(q1.deckOrder, []);
  same(q1.liked, ['F01']);
  // Q3 invalidates nothing
  same(E.invalidate(st, 'q3'), { state: st, changed: false });
  // Q5 to Q10 invalidate the core only
  const q7 = E.invalidate(st, 'q7');
  assert.equal(q7.changed, true);
  assert.equal(q7.state.core.primary, null);
  same(q7.state.liked, ['F01']);
  // toast only fires when something existed
  assert.equal(E.invalidate(E.initialState(), 'q2').changed, false);
});
