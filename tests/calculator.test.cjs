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
const {buildChartMetrics}=ctx;
const {netAnnualReturn,closeIis}=ctx;
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

test('accumulation separates principal, tax refunds and compounded investment income',()=>{
  const annual=1.01**12-1;
  const a=accumulate(1,0,100,annual,0,false,1000);
  close(a.components.own[1],1100);
  close(a.components.interest[1],11);
  close(a.components.refunds[1],0);
  const b=accumulate(25,9,40000,annual,.13,true,1000,{inflation:.1,indexContributions:true});
  close(b.components.own.at(-1),1000+b.contrib);
  close(b.components.refunds.at(-1),b.refunds);
  for(let i=0;i<b.series.length;i++){
    close(b.components.own[i]+b.components.refunds[i]+b.components.interest[i],b.series[i]);
  }
});

test('pension withdrawals reduce all sources proportionally, including new refunds and interest',()=>{
  const initial={own:1000,refunds:100,interest:100};
  const s=simPension(1200,100,1.01**12-1,10,.13,1,1,0,200,{initialComponents:initial});
  const before=1248.26,after=1148.26;
  close(s.end,after);
  close(s.components.own[1],1010*after/before);
  close(s.components.refunds[1],126*after/before);
  close(s.components.interest[1],112.26*after/before);
  assert.deepEqual(initial,{own:1000,refunds:100,interest:100});
});

test('component balances join across phases and sum to balance through work and depletion',()=>{
  const a=accumulate(180,9,18000,.1,.13,true,36554,{inflation:.06,indexContributions:true});
  const initialComponents=Object.fromEntries(Object.entries(a.components).map(([k,v])=>[k,v.at(-1)]));
  const s=simPension(a.bal,80000,.08,18000,.13,60,600,9,a.carry,{inflation:.06,elapsedMonths:180,indexContributions:true,initialComponents});
  for(const key of Object.keys(initialComponents))close(s.components[key][0],initialComponents[key]);
  for(let i=0;i<s.series.length;i++){
    const values=Object.values(s.components).map(v=>v[i]);
    assert.ok(values.every(v=>Number.isFinite(v)&&v>=0));
    close(values.reduce((a,b)=>a+b,0),s.series[i]);
    if(s.zeroAt>=0&&i>=s.zeroAt)assert.ok(values.every(v=>v===0));
  }
  assert.ok(s.zeroAt>0);
});

test('chart units transform every component and keep inflation metrics independent of display units',()=>{
  const a=accumulate(24,0,1000,.08,.13,true,10000);
  const real=buildChartMetrics(a.series,a.components,.1,true);
  const nominal=buildChartMetrics(a.series,a.components,.1,false);
  for(let i=0;i<a.series.length;i++){
    close(Object.values(real.components).reduce((sum,v)=>sum+v[i],0),real.vals[i]);
    close(Object.values(nominal.components).reduce((sum,v)=>sum+v[i],0),nominal.vals[i]);
    close(real.real[i]+real.inflationGap[i],real.nominal[i]);
    close(real.inflationPct[i],nominal.inflationPct[i]);
    close(real.inflationGap[i],nominal.inflationGap[i]);
  }
  close(real.inflationPct[24],21);
  close(real.real[24],a.bal/1.21);
});

test('zero inflation makes price growth and purchasing-power gap exactly zero',()=>{
  const a=accumulate(120,6,18000,.08,.13,true,1000);
  const data=buildChartMetrics(a.series,a.components,0,true);
  assert.ok(data.inflationPct.every(v=>v===0));
  assert.ok(data.inflationGap.every(v=>v===0));
  data.vals.forEach((v,i)=>close(v,a.series[i]));
});

test('income tax applies to earnings, never to deposits or contribution refunds',()=>{
  const opts={incomeTaxRate:.13,taxableShare:1};
  const flat=accumulate(25,9,40000,0,.13,true,100000,opts);
  close(flat.taxes,0); close(flat.bal,100000+flat.contrib+flat.refunds);
  const s=accumulate(1,0,100,1.01**12-1,0,false,1000,opts);
  close(s.taxes,1.43); close(s.bal,1109.57);
  close(s.components.own[1],1100); close(s.components.interest[1],9.57);
});

test('monthly income tax matches an independent compound-growth calculation',()=>{
  const gross=1.01**12-1,opts={incomeTaxRate:.15,taxableShare:1};
  const s=accumulate(120,0,0,gross,0,false,100000,opts);
  close(s.bal,100000*1.0085**120);
  close(netAnnualReturn(gross,opts),1.0085**12-1);
  const noTax=accumulate(120,0,0,gross,0,false,100000);
  assert.ok(noTax.bal-s.bal>s.taxes,'Tax also removes future compounding');
});

test('IIS dividend share is a share of earnings, and remaining income is deferred',()=>{
  const s=accumulate(1,0,0,1.01**12-1,0,false,100000,{iis3:true,incomeTaxRate:.13,taxableShare:.25});
  close(s.taxes,32.5); close(s.deferredIncome,750); close(s.bal,100967.5);
  closeIis(s,.13); close(s.closingTax,0);
  const allDividends=accumulate(1,0,0,1.01**12-1,0,false,100000,{iis3:true,incomeTaxRate:.13,taxableShare:1});
  close(allDividends.deferredIncome,0);
});

test('IIS closure taxes only result exceeding 30 million, not principal or dividends',()=>{
  for(const income of [29000000,30000000,31000000]){
    const s=accumulate(12,0,0,.1,0,false,income/.1,{iis3:true,incomeTaxRate:.13,taxableShare:0});
    close(s.deferredIncome,income,.00001);
    closeIis(s,.13,.06);
    const expected=Math.max(0,income-30000000)*.13;
    close(s.closingTax,expected,.00001);
    close(s.bal,income/.1+income-expected,.00001);
    close(s.taxSeries.at(-1),expected,.00001);
    close(s.realTaxSeries.at(-1),expected/1.06,.00001);
    close(s.components.own.at(-1)+s.components.refunds.at(-1)+s.components.interest.at(-1),s.bal);
  }
});

test('disabling tax or exempting all earnings preserves gross accumulation',()=>{
  const args=[180,9,18000,.12,.13,true,36554];
  const gross=accumulate(...args);
  for(const opts of [{incomeTaxRate:0},{incomeTaxRate:.15,taxableShare:0}]){
    const s=accumulate(...args,opts);
    close(s.bal,gross.bal); close(s.taxes,0);
  }
  close(netAnnualReturn(-.1,{incomeTaxRate:.15}),-.1);
});

test('taxes are discounted at payment dates and accumulate monotonically',()=>{
  const s=accumulate(24,0,0,.12,0,false,100000,{inflation:.1,incomeTaxRate:.13});
  let discounted=0;
  for(let i=1;i<s.taxSeries.length;i++){
    const payment=s.taxSeries[i]-s.taxSeries[i-1];
    assert.ok(payment>=0); discounted+=payment/priceFactor(.1,i);
    close(s.realTaxSeries[i],discounted);
  }
  assert.ok(s.realTaxes>s.taxes/1.1**2);
});

test('pension payout is spendable cash; deposits and withdrawals are not taxed again',()=>{
  const s=simPension(100000,1000,1.01**12-1,100,0,1,1,0,0,{incomeTaxRate:.13,initialComponents:{own:100000,refunds:0,interest:0}});
  close(s.taxes,130); close(s.end,99970);
  close(Object.values(s.components).reduce((sum,series)=>sum+series[1],0),s.end);
});

test('perpetual and finite pensions agree with closed forms after income tax',()=>{
  const opts={incomeTaxRate:.13,inflation:.06,elapsedMonths:180},capital=3000000,n=240;
  const r=(1+monthlyRate(.12)*.87)/(1.06**(1/12))-1;
  const realCapital=capital/1.06**15;
  close(solvePerpetual(capital,.12,0,0,0,600,0,0,opts),realCapital*r);
  close(solveAnnuity(capital,.12,0,0,0,n,0,0,opts),realCapital*r/(1-(1+r)**-n));
  close(solvePerpetual(capital,.08,0,0,0,600,0,0,{incomeTaxRate:.15,inflation:.075}),0);
});

test('after IIS closure, last refund arrives once and pension contributions get no deductions',()=>{
  const s=simPension(100000,0,0,10000,.13,24,25,9,30000,{refundsOnWork:false});
  close(s.end,100000+240000+3900);
});

test('tax series and net components stay consistent through pension depletion',()=>{
  const a=closeIis(accumulate(180,9,18000,.12,.13,true,36554,{iis3:true,incomeTaxRate:.13,taxableShare:.25}),.13);
  const initialComponents=Object.fromEntries(Object.entries(a.components).map(([k,v])=>[k,v.at(-1)]));
  const s=simPension(a.bal,80000,.08,0,.13,0,600,9,a.carry,{incomeTaxRate:.15,inflation:.075,elapsedMonths:180,initialComponents,refundsOnWork:false});
  assert.ok(s.zeroAt>0);
  for(let i=0;i<s.series.length;i++){
    close(Object.values(s.components).reduce((sum,values)=>sum+values[i],0),s.series[i]);
    assert.ok(Number.isFinite(s.taxSeries[i]));
    if(i>s.zeroAt)close(s.taxSeries[i],s.taxSeries[s.zeroAt]);
  }
});
