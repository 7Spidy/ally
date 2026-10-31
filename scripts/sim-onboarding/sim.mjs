import {OLD,makeNew} from "./designs.mjs"; import * as L from "./lib2.mjs";
const CO=L.CORE_ORDER, pc=x=>(100*x).toFixed(1).padStart(5)+"%";
const PRIORS={ "assumed mix (35/22/20/12/11)":{ROMANTIC:.35,FRIEND:.22,PSYCH:.20,MONEY:.12,TRAINER:.11}, "uniform":{ROMANTIC:.2,PSYCH:.2,FRIEND:.2,MONEY:.2,TRAINER:.2} };
const D={ "CURRENT":OLD, "NEW dom3":makeNew(3), "NEW dom4":makeNew(4), "NEW dom5":makeNew(5) };
for(const [pn,prior] of Object.entries(PRIORS)){
  console.log(`\n##### prior: ${pn}`);
  for(const h of [1,0.7,0.5]){
    console.log(`\n-- respondent clarity h=${h} (1 = clear, 0.5 = very noisy)`);
    console.log("design      top-1 acc | tiebreak shown | primary-or-secondary | per-core recall: "+CO.map(c=>c.slice(0,4)).join("  "));
    for(const [dn,d] of Object.entries(D)){
      const r=L.simulate(d,{n:60000,h,seed:11,prior});
      const rec=CO.map(c=>{const row=r.conf[c]||{};const n=Object.values(row).reduce((a,b)=>a+b,0)||1;return pc((row[c]||0)/n);});
      console.log(`${dn.padEnd(11)} ${pc(r.acc)}   | ${pc(r.tbRate)}        | ${pc(r.primOrSec)}             | ${rec.join(" ")}`);
    }
  }
}
