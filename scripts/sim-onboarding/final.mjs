import {OLD,PRESSURES} from "./designs.mjs"; import * as L from "./lib2.mjs";
const C={ROMANTIC:2,FRIEND:1}, R={PSYCH:2}, P={FRIEND:2,ROMANTIC:1}, D={MONEY:2,TRAINER:2};
export const FINAL={PRESSURES,SCORE:{q5:[C,R,P,D],q6:[R,P,D,C],q7:[D,C,R,P],q8:[P,D,C,R],q9:[C,P,R,D]},
 PRESSURE_SCORE:{money:{MONEY:3},health:{TRAINER:3},head:{PSYCH:3},alone:{ROMANTIC:2,FRIEND:1},notgood:{FRIEND:2,PSYCH:1},change:{PSYCH:2,FRIEND:1}}};
const PRIOR={ROMANTIC:.35,FRIEND:.22,PSYCH:.20,MONEY:.12,TRAINER:.11};
// ---- Bayes ceiling for FINAL's option structure under the respondent model
function bayes(h,prior=PRIOR){ const cm=L.clusterMap(FINAL); let acc=0;
  const mix=(w)=>Object.fromEntries(Object.entries(w).map(([k,v])=>[k,h*v+(1-h)*0.25])), mixD=(w)=>Object.fromEntries(Object.entries(w).map(([k,v])=>[k,h*v+(1-h)/6]));
  for(const a of L.all(FINAL)){ let best=0;
    for(const t of Object.keys(prior)){ let p=prior[t]; for(const q of ["q5","q6","q7","q8","q9"]){const n=cm[q].filter(c=>c===cm[q][a[q]]).length; p*=mix(L.STYLE[t])[cm[q][a[q]]]/n;} p*=mixD(L.DOMAIN[t])[a.q10]; best=Math.max(best,p);} acc+=best; } return acc; }
console.log("Bayes-optimal top-1 ceiling (no tiebreak screen):",[1,.7,.5].map(h=>`h=${h}: ${(100*bayes(h)).toFixed(1)}%`).join("  "));
for(const h of [1,.7,.5]){const r=L.simulate(FINAL,{n:80000,h,seed:5,prior:PRIOR}); const o=L.simulate(OLD,{n:80000,h,seed:5,prior:PRIOR});
 console.log(`h=${h}: FINAL top-1 ${(100*r.acc).toFixed(1)}% (incl. tiebreak screen, tb shown ${(100*r.tbRate).toFixed(1)}%) | CURRENT ${(100*o.acc).toFixed(1)}%  | FINAL prim-or-sec ${(100*r.primOrSec).toFixed(1)}% vs ${(100*o.primOrSec).toFixed(1)}%`);}
// ---- robustness: perturb the respondent model 300x
const R0=L.rng(99); const jig=(m,s)=>{const o={};for(const[k,w]of Object.entries(m)){const x=Object.fromEntries(Object.entries(w).map(([c,v])=>[c,v*(1+(R0()*2-1)*s)]));const z=Object.values(x).reduce((a,b)=>a+b,0);o[k]=Object.fromEntries(Object.entries(x).map(([c,v])=>[c,v/z]));}return o;};
const S0=JSON.parse(JSON.stringify(L.STYLE)), D0=JSON.parse(JSON.stringify(L.DOMAIN)); let wins=0, deltas=[], minRecNew=[], minRecOld=[];
for(let i=0;i<300;i++){ Object.assign(L.STYLE,jig(S0,.35)); Object.assign(L.DOMAIN,jig(D0,.35));
  const a=L.simulate(FINAL,{n:6000,h:.8,seed:i,prior:PRIOR}), b=L.simulate(OLD,{n:6000,h:.8,seed:i,prior:PRIOR});
  const mr=(r)=>Math.min(...L.CORE_ORDER.map(k=>{const row=r.conf[k]||{};const n=Object.values(row).reduce((x,y)=>x+y,0)||1;return (row[k]||0)/n;}));
  if(a.acc>b.acc)wins++; deltas.push(a.acc-b.acc); minRecNew.push(mr(a)); minRecOld.push(mr(b)); }
deltas.sort((x,y)=>x-y); const mean=x=>x.reduce((a,b)=>a+b,0)/x.length;
console.log(`Robustness (300 perturbed respondent models, ±35% on every probability, h=.8): FINAL beats CURRENT in ${wins}/300; accuracy delta median ${(100*deltas[150]).toFixed(1)}pts (p5 ${(100*deltas[15]).toFixed(1)}, p95 ${(100*deltas[285]).toFixed(1)}); mean worst-core recall ${(100*mean(minRecNew)).toFixed(1)}% vs ${(100*mean(minRecOld)).toFixed(1)}%`);
