export const CORE_ORDER = ["ROMANTIC","PSYCH","FRIEND","MONEY","TRAINER"];
export const CLOSE_MARGIN = 2, SECONDARY_MARGIN = 3;
const Q = ["q5","q6","q7","q8","q9"];

export function totals(d, a, tb){
  const t={ROMANTIC:0,PSYCH:0,MONEY:0,TRAINER:0,FRIEND:0};
  for(const q of Q) for(const [c,p] of Object.entries(d.SCORE[q][a[q]])) t[c]+=p;
  if(a.q10){
    if(d.PRESSURE_SCORE) for(const [c,p] of Object.entries(d.PRESSURE_SCORE[a.q10])) t[c]+=p;
    else t[d.PRESSURE_OWNER[a.q10]] += d.PRESSURE_POINTS;
  }
  if(tb) t[tb]+=3;
  return t;
}
export const rank=t=>CORE_ORDER.map(id=>({id,score:t[id]})).sort((x,y)=>y.score-x.score||CORE_ORDER.indexOf(x.id)-CORE_ORDER.indexOf(y.id));
export function needsTiebreak(r){const g=r[0].score-r[1].score; if(g===0&&(r[0].id==="ROMANTIC"||r[1].id==="ROMANTIC"))return false; return g<CLOSE_MARGIN;}
export function assign(r){const s=r.slice(1).find(x=>x.id!=="ROMANTIC"); return {primary:r[0].id, secondary:(s&&r[0].score-s.score<=SECONDARY_MARGIN)?s.id:null};}
export function* all(d){const P=Object.keys(d.PRESSURES);
  for(let a=0;a<4;a++)for(let b=0;b<4;b++)for(let c=0;c<4;c++)for(let e=0;e<4;e++)for(let f=0;f<4;f++)for(const p of P) yield {q5:a,q6:b,q7:c,q8:e,q9:f,q10:p};}

// cluster of an option = cluster of its top-scored core (mechanical, same rule for old and new)
export const CLUSTER_OF_CORE={ROMANTIC:"C",PSYCH:"R",FRIEND:"P",MONEY:"D",TRAINER:"D"};
export function clusterMap(d){const m={}; for(const q of Q) m[q]=d.SCORE[q].map(o=>{
  const top=Object.entries(o).sort((a,b)=>b[1]-a[1]||CORE_ORDER.indexOf(a[0])-CORE_ORDER.indexOf(b[0]))[0][0]; return CLUSTER_OF_CORE[top];}); return m;}

// seeded rng
export function rng(seed){let s=seed>>>0;return()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
const pick=(R,w)=>{let r=R()*Object.values(w).reduce((a,b)=>a+b,0);for(const[k,v]of Object.entries(w)){if((r-=v)<=0)return k;}return Object.keys(w).pop();};

// Respondent model (independent of the scoring tables): P(style cluster | latent type), scaled by 'hit' strength h.
// h=1 is the base model; lower h blends toward uniform (noisier people).
export const STYLE={ // C closeness, R reflective, P playful, D directive
  ROMANTIC:{C:.55,R:.15,P:.22,D:.08}, PSYCH:{C:.15,R:.55,P:.10,D:.20}, FRIEND:{C:.15,R:.10,P:.65,D:.10},
  MONEY:{C:.05,R:.15,P:.10,D:.70}, TRAINER:{C:.05,R:.05,P:.15,D:.75}};
export const DOMAIN={ // P(pressure | latent type)
  ROMANTIC:{money:.08,health:.07,head:.2,alone:.4,notgood:.15,change:.10},
  PSYCH:{money:.08,health:.07,head:.45,alone:.1,notgood:.15,change:.15},
  FRIEND:{money:.08,health:.07,head:.12,alone:.18,notgood:.30,change:.25},
  MONEY:{money:.60,health:.05,head:.10,alone:.05,notgood:.10,change:.10},
  TRAINER:{money:.05,health:.60,head:.10,alone:.05,notgood:.10,change:.10}};
const mix=(w,h)=>Object.fromEntries(Object.entries(w).map(([k,v])=>[k,h*v+(1-h)*0.25]));
const mixD=(w,h)=>Object.fromEntries(Object.entries(w).map(([k,v])=>[k,h*v+(1-h)/6]));
export function respond(d,cm,type,h,R){
  const a={};
  for(const q of Q){const cl=pick(R,mix(STYLE[type],h)); const idx=cm[q].map((c,i)=>c===cl?i:-1).filter(i=>i>=0); a[q]=idx.length?idx[Math.floor(R()*idx.length)]:Math.floor(R()*4);}
  a.q10=pick(R,mixD(DOMAIN[type],h)); return a;
}
// the tiebreak screen: user prefers the line of their true core if it is in the pair (p=.8), else coin flip
export function resolveTiebreak(type,pair,R){ if(pair.includes(type)) return R()<.8?type:pair.find(x=>x!==type); return pair[R()<.5?0:1]; }
export function simulate(d,{n=40000,h=1,seed=7,prior,cm:cmOverride}={}){
  const R=rng(seed), cm=cmOverride||clusterMap(d); const types=Object.keys(prior);
  const conf={}; let tbn=0, ok=0, okNoTb=0, inPS=0, N=0;
  for(let i=0;i<n;i++){
    const type=pick(R,prior); const a=respond(d,cm,type,h,R);
    let r=rank(totals(d,a)); let tb=null;
    if(needsTiebreak(r)){tbn++; tb=resolveTiebreak(type,[r[0].id,r[1].id],R); r=rank(totals(d,a,tb));}
    const as=assign(r); N++;
    conf[type]??={}; conf[type][as.primary]=(conf[type][as.primary]||0)+1;
    if(as.primary===type) ok++; if(as.primary===type||as.secondary===type) inPS++;
  }
  return {conf,acc:ok/N,tbRate:tbn/N,primOrSec:inPS/N,N};
}
