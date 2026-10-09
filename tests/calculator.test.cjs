const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const ctx=vm.createContext({});
vm.runInContext(script.slice(0,script.indexOf('function render()')),ctx);
const {priceFactor,monthlyRate,accumulate,simPension,solveAnnuity,solvePerpetual}=ctx;
const close=(actual,expected,tolerance=1e-5)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);

test('10% annual inflation compounds by date, not by subtraction',()=>{
  close(priceFactor(.1,24),1.21);
  close(121000/priceFactor(.1,24),100000);
});

test('zero inflation preserves the accumulation model and calendar tax refunds',()=>{
  const s=accumulate(24,9,10000,0,.13,true,50000,{inflation:0,indexContributions:true});
  close(s.contrib,240000);
  close(s.refunds,19500); // 3 months before first January, then a full year.
  close(s.bal,309500);
});

test('unindexed contributions do not change nominal accumulation',()=>{
  const args=[180,7,18000,.1,.13,true,36554];
  const a=accumulate(...args),b=accumulate(...args,{inflation:.12});
  close(a.bal,b.bal); close(a.contrib,b.contrib); close(a.refunds,b.refunds);
});

test('annual contribution indexing starts after twelve months; tax cap stays nominal',()=>{
  const s=accumulate(25,0,40000,0,.13,true,0,{inflation:.1,indexContributions:true});
  close(s.contrib,40000*12+44000*12+48400);
  close(s.refunds,104000);
});

test('payout is valued at end of month and inflation continues across retirement',()=>{
  const s=simPension(100000,1000,0,0,0,0,2,0,0,{inflation:.12,elapsedMonths:120});
  close(s.end,100000-1000*priceFactor(.12,121)-1000*priceFactor(.12,122));
});

test('contribution indexing continues after retirement, without resetting the clock',()=>{
  const s=simPension(1000,0,0,100,0,13,13,0,0,{inflation:.1,elapsedMonths:12,indexContributions:true});
  close(s.end,1000+12*110+121);
});

test('nominal pension at 0% inflation agrees with closed form',()=>{
  const r=monthlyRate(.08),capital=1000000,w=5000,n=120;
  const expected=capital*(1+r)**n-w*((1+r)**n-1)/r;
  close(simPension(capital,w,.08,0,0,0,n,0,0).end,expected,1e-4);
});

test('inflation-adjusted annuity agrees with closed form and nearly exhausts account',()=>{
  for(const [annual,inflation] of [[.08,0],[.08,.06],[.06,.06],[.03,.1]]){
    const options={inflation,elapsedMonths:120},n=240,capital=2000000;
    const r=monthlyRate((1+annual)/(1+inflation)-1);
    const realCapital=capital/priceFactor(inflation,120);
    const expected=Math.abs(r)<1e-12?realCapital/n:realCapital*r/(1-(1+r)**(-n));
    const w=solveAnnuity(capital,annual,0,0,0,n,0,0,options);
    close(w,expected,1e-5);
    assert.ok(simPension(capital,w,annual,0,0,0,n,0,0,options).end<.01);
  }
});

test('perpetual real payout agrees with closed form over different inflation rates',()=>{
  for(const inflation of [0,.04,.08,.12]){
    const annual=.08,options={inflation,elapsedMonths:120},capital=1000000;
    const r=monthlyRate((1+annual)/(1+inflation)-1);
    const expected=Math.max(0,r)*capital/priceFactor(inflation,120);
    close(solvePerpetual(capital,annual,0,0,0,600,0,0,options),expected);
  }
});

test('work and delayed refund: perpetual payout stays sustainable after all inflows',()=>{
  const opts={inflation:.06,elapsedMonths:180,indexContributions:true};
  const capital=3000000,annual=.09,monthly=20000,tax=.13,work=60;
  const w=solvePerpetual(capital,annual,monthly,tax,work,600,9,200000,opts);
  const s=simPension(capital,w,annual,monthly,tax,work,1200,9,200000,opts);
  assert.equal(s.zeroAt,-1);
  close(s.series[120]/priceFactor(.06,300),s.series[1200]/priceFactor(.06,1380),.1);
});

test('January refund from accumulation survives phase boundary exactly once',()=>{
  const a=accumulate(3,9,10000,0,.13,true,0);
  const s=simPension(a.bal,0,0,0,.13,0,13,0,a.carry,{inflation:.1});
  close(s.end,33900);
});

test('zero balance and zero payouts remain finite; no annuity can be paid',()=>{
  close(solveAnnuity(0,.08,0,0,0,120,0,0,{inflation:.06}),0);
  close(solvePerpetual(0,.08,0,0,0,600,0,0,{inflation:.06}),0);
  assert.equal(simPension(0,0,.08,0,0,0,12,0,0).zeroAt,-1);
});
