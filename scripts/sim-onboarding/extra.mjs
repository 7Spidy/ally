import {OLD} from "./designs.mjs"; import {FINAL} from "./finaldesign.mjs"; import * as L from "./lib2.mjs";
const PRIOR={ROMANTIC:.35,FRIEND:.22,PSYCH:.20,MONEY:.12,TRAINER:.11};
console.log("\n--- Drop-one ablation (h=1): accuracy if question is skipped (its answer scored as nothing)");
const CM=L.clusterMap(FINAL); const base=L.simulate(FINAL,{n:60000,h:1,seed:2,prior:PRIOR,cm:CM}).acc; console.log("all questions:",(100*base).toFixed(1)+"%");
for(const q of ["q5","q6","q7","q8","q9"]){ const d=JSON.parse(JSON.stringify(FINAL)); d.SCORE[q]=[{},{},{},{}]; const r=L.simulate(d,{n:60000,h:1,seed:2,prior:PRIOR,cm:CM}); console.log(`without ${q}: ${(100*r.acc).toFixed(1)}%  (${((r.acc-base)*100).toFixed(1)} pts)`);}
{const d=JSON.parse(JSON.stringify(FINAL)); d.PRESSURE_SCORE=Object.fromEntries(Object.keys(d.PRESSURE_SCORE).map(k=>[k,{}])); const r=L.simulate(d,{n:60000,h:1,seed:2,prior:PRIOR,cm:CM}); console.log(`without q10 (pressure): ${(100*r.acc).toFixed(1)}%  (${((r.acc-base)*100).toFixed(1)} pts)`);}
console.log("\n--- Tiebreak threshold (CLOSE_MARGIN) trade-off, h=.8");
for(const m of [1,2,3]){ const old=L.CLOSE_MARGIN; // patch via closure: re-implement quickly
  let n=0,ok=0,tbn=0; const R=L.rng(4), cm=L.clusterMap(FINAL);
  const keys=Object.keys(PRIOR); const pickT=()=>{let r=R(),acc=0;for(const k of keys){acc+=PRIOR[k];if(r<=acc)return k;}return keys[0];};
  for(let i=0;i<60000;i++){const type=pickT(); const a=L.respond(FINAL,cm,type,.8,R); let r=L.rank(L.totals(FINAL,a)); const gap=r[0].score-r[1].score;
    const tie=(gap===0&&(r[0].id==="ROMANTIC"||r[1].id==="ROMANTIC"))?false:gap<m;
    if(tie){tbn++; const tb=L.resolveTiebreak(type,[r[0].id,r[1].id],R); r=L.rank(L.totals(FINAL,a,tb));}
    n++; if(L.assign(r).primary===type)ok++;}
  console.log(`margin ${m}: top-1 ${(100*ok/n).toFixed(1)}%  tiebreak shown ${(100*tbn/n).toFixed(1)}%`);}
console.log("\n--- Straight-liners (same card position on all five, every pressure): primary core");
for(const [n,d] of [["CURRENT",OLD],["FINAL",FINAL]]){ const out=[]; for(let i=0;i<4;i++){const res={}; for(const p of Object.keys(d.PRESSURES)){const a={q5:i,q6:i,q7:i,q8:i,q9:i,q10:p}; const as=L.assign(L.rank(L.totals(d,a))); res[as.primary]=(res[as.primary]||0)+1;} out.push(`#${i+1}: `+Object.entries(res).map(([k,v])=>`${k.slice(0,4)}×${v}`).join(" "));} console.log(n.padEnd(8),out.join(" | "));}
