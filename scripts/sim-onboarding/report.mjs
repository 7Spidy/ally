import {OLD,makeNew} from "./designs.mjs"; import * as L from "./lib2.mjs";
const CO=L.CORE_ORDER, pad=(s,n)=>String(s).padEnd(n), pc=x=>(100*x).toFixed(1).padStart(5)+"%";
function audit(d,label){
  const N={}, byP={}, ps={}; let tot=0,tb=0,ex=0; 
  for(const a of L.all(d)){const r=L.rank(L.totals(d,a)); tot++; const as=L.assign(r);
    N[as.primary]=(N[as.primary]||0)+1; if(L.needsTiebreak(r))tb++; if(r[0].score===r[1].score)ex++;
    byP[a.q10]??={}; byP[a.q10][as.primary]=(byP[a.q10][as.primary]||0)+1;
    // owner present as primary or secondary
    const own=d.PRESSURE_OWNER?d.PRESSURE_OWNER[a.q10]:Object.entries(d.PRESSURE_SCORE[a.q10]).sort((x,y)=>y[1]-x[1])[0][0];
    ps[a.q10]??={n:0,ok:0}; ps[a.q10].n++; if(as.primary===own||as.secondary===own)ps[a.q10].ok++;}
  console.log(`\n=== ${label} (${tot} combos) ===`);
  console.log("Primary share, uniform answers: "+CO.map(c=>`${c.slice(0,4)} ${pc((N[c]||0)/tot)}`).join(" | "));
  console.log(`Tiebreak needed: ${pc(tb/tot)}   exact top ties: ${pc(ex/tot)}`);
  console.log("Pressure -> primary core:");
  for(const[p,m]of Object.entries(byP)){const n=Object.values(m).reduce((a,b)=>a+b,0);
    console.log("  "+pad(p,8)+CO.map(c=>`${c.slice(0,4)} ${pc((m[c]||0)/n)}`).join(" ")+`  | owner is primary-or-secondary ${pc(ps[p].ok/ps[p].n)}`);}
  // straight-lining
  const sl=[]; for(let i=0;i<4;i++){const a={q5:i,q6:i,q7:i,q8:i,q9:i,q10:"alone"}; const r=L.rank(L.totals(d,a)); sl.push(`all-#${i+1}→${r[0].id}${L.needsTiebreak(r)?"*":""}`);}
  console.log("Straight-liners (pressure=alone), *=tiebreak: "+sl.join("  "));
}
audit(OLD,"CURRENT"); for(const dom of [3,4,5]) audit(makeNew(dom),`NEW dom=${dom}`);
