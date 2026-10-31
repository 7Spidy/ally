export const PRESSURES={money:1,health:1,head:1,alone:1,notgood:1,change:1};
export const OLD={ PRESSURES,
 SCORE:{ q5:[{ROMANTIC:2,PSYCH:1},{ROMANTIC:2,PSYCH:1},{PSYCH:2,FRIEND:1},{FRIEND:2,TRAINER:1}],
  q6:[{ROMANTIC:2,PSYCH:1},{FRIEND:2,ROMANTIC:1},{PSYCH:2,MONEY:1},{MONEY:2,TRAINER:1}],
  q7:[{PSYCH:2,ROMANTIC:1},{ROMANTIC:2},{FRIEND:2},{TRAINER:2,MONEY:1}],
  q8:[{FRIEND:2,ROMANTIC:1},{ROMANTIC:2,PSYCH:1},{MONEY:2,PSYCH:1},{TRAINER:2,MONEY:1}],
  q9:[{PSYCH:2},{FRIEND:2},{ROMANTIC:2},{TRAINER:2,MONEY:1}]},
 PRESSURE_OWNER:{money:"MONEY",health:"TRAINER",head:"PSYCH",alone:"ROMANTIC",notgood:"FRIEND",change:"FRIEND"}, PRESSURE_POINTS:3};

// New: one option per support style in every question; directive option feeds MONEY and TRAINER equally.
const C={ROMANTIC:2,PSYCH:1}, R={PSYCH:2,ROMANTIC:1}, P={FRIEND:2,ROMANTIC:1}, D={MONEY:2,TRAINER:2};
export function makeNew(dom=4){ return { PRESSURES,
 SCORE:{ q5:[C,R,P,D], q6:[R,P,D,C], q7:[D,C,R,P], q8:[P,D,C,R], q9:[C,P,R,D] },
 PRESSURE_SCORE:{ money:{MONEY:dom}, health:{TRAINER:dom}, head:{PSYCH:dom},
   alone:{ROMANTIC:dom-1,FRIEND:1}, notgood:{FRIEND:dom-1,PSYCH:1}, change:{PSYCH:dom-1,FRIEND:1} } }; }
