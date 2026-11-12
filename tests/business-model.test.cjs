const {test}=require('node:test');
const assert=require('node:assert/strict');
const {calculate}=require('../business-model.js');
const close=(actual,expected,tolerance=1e-7)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);
const simple={initialInvestment:10000,monthlyRevenue:1000,variableCostRate:0,fixedCosts:0,ownerSalary:0,monthlyReinvestment:0,taxMode:'revenue',taxRate:0,rampMonths:0,horizonMonths:12,annualRevenueGrowth:0,annualCostGrowth:0,discountRate:0};

test('constant cash flow recovers initial investment and ROI excludes principal',()=>{
  const r=calculate(simple);
  close(r.summary.totalCashFlow,12000);close(r.summary.netResult,2000);close(r.summary.roi,.2);
  assert.equal(r.summary.paybackMonth,10);assert.equal(r.summary.discountedPaybackMonth,10);
  close(r.summary.requiredFunding,10000);close(r.summary.extraFunding,0);
  close(r.rows[0].cashFlow,-10000);close(r.rows.at(-1).cumulativeCashFlow,2000);
});

test('tax bases differ; owner compensation is operating expense and capex reserve is cash-only',()=>{
  const input={...simple,variableCostRate:.4,fixedCosts:100,ownerSalary:100,monthlyReinvestment:100,taxRate:.2};
  const revenue=calculate(input),profit=calculate({...input,taxMode:'profit'});
  close(revenue.steadyMonth.profitBeforeTax,400);close(revenue.steadyMonth.tax,200);
  close(revenue.steadyMonth.netProfit,200);close(revenue.steadyMonth.cashFlow,100);
  close(profit.steadyMonth.tax,80);close(profit.steadyMonth.netProfit,320);close(profit.steadyMonth.cashFlow,220);
  close(profit.summary.totalTaxes,960);
});

test('losses receive no fictional tax credit and require additional financing',()=>{
  const r=calculate({...simple,monthlyRevenue:100,fixedCosts:300,taxRate:.15,taxMode:'profit'});
  close(r.summary.totalTaxes,0);close(r.summary.netResult,-12400);
  close(r.summary.requiredFunding,12400);close(r.summary.extraFunding,2400);
  assert.equal(r.summary.paybackMonth,null);assert.equal(r.summary.discountedPaybackMonth,null);
});

test('zero revenue with recurring costs never recovers startup funding',()=>{
  const r=calculate({...simple,monthlyRevenue:0,fixedCosts:200,ownerSalary:100});
  close(r.summary.totalRevenue,0);close(r.summary.totalTaxes,0);close(r.summary.extraFunding,3600);
  assert.equal(r.summary.paybackMonth,null);
});

test('startup ramp delays receipts but does not ramp down fixed costs',()=>{
  const r=calculate({...simple,initialInvestment:1000,monthlyRevenue:1200,rampMonths:4,fixedCosts:500,horizonMonths:4});
  assert.deepEqual(r.rows.slice(1).map(x=>x.revenue),[300,600,900,1200]);
  assert.deepEqual(r.rows.slice(1).map(x=>x.cashFlow),[-200,100,400,700]);
  close(r.summary.requiredFunding,1200);close(r.summary.extraFunding,200);
  assert.equal(r.summary.paybackMonth,4);
  close(r.steadyMonth.revenue,1200);close(r.steadyMonth.cashFlow,700);
});

test('sales and cost growth compound from original price level independently',()=>{
  const r=calculate({...simple,annualRevenueGrowth:.21,annualCostGrowth:.1,fixedCosts:100,ownerSalary:200,monthlyReinvestment:50,horizonMonths:13});
  close(r.rows[1].revenue,1000);close(r.rows[13].revenue,1210);
  close(r.rows[13].fixedCosts,110);close(r.rows[13].ownerSalary,220);close(r.rows[13].reinvestment,55);
  close(r.steadyMonth.cashFlow,650);
});

test('discounted cash flow agrees with present-value annuity and delays payback',()=>{
  const r=calculate({...simple,discountRate:.12});
  const m=1.12**(1/12)-1;
  close(r.summary.npv,1000*(1-(1+m)**-12)/m-10000);
  assert.ok(r.summary.discountedPaybackMonth>r.summary.paybackMonth);
  close(r.rows[12].discountedCashFlow,1000/1.12);
});

test('break-even revenue covers expenses, owner salary, tax and investment reserve',()=>{
  for(const taxMode of ['revenue','profit']){
    const input={...simple,taxMode,taxRate:.15,variableCostRate:.4,fixedCosts:100,ownerSalary:200,monthlyReinvestment:100};
    const r=calculate(input);
    const at=calculate({...input,monthlyRevenue:r.breakevenRevenue}).steadyMonth;
    close(at.cashFlow,0);
    assert.ok(calculate({...input,monthlyRevenue:r.breakevenRevenue*.99}).steadyMonth.cashFlow<0);
    assert.ok(calculate({...input,monthlyRevenue:r.breakevenRevenue*1.01}).steadyMonth.cashFlow>0);
  }
});

test('no positive contribution margin cannot cover fixed expenses',()=>{
  assert.equal(calculate({...simple,variableCostRate:.95,taxRate:.1,fixedCosts:10}).breakevenRevenue,null);
  assert.equal(calculate({...simple,variableCostRate:1,taxRate:0,fixedCosts:10,taxMode:'profit'}).breakevenRevenue,null);
  close(calculate({...simple,variableCostRate:1}).breakevenRevenue,0);
});

test('zero initial investment avoids undefined ROI and payback estimates',()=>{
  const r=calculate({...simple,initialInvestment:0});
  assert.equal(r.summary.roi,null);assert.equal(r.summary.paybackMonth,null);assert.equal(r.summary.discountedPaybackMonth,null);
  close(r.summary.netResult,12000);close(r.summary.requiredFunding,0);
});

test('a project can cross payback and later lose the recovered investment',()=>{
  const r=calculate({...simple,initialInvestment:50,monthlyRevenue:200,fixedCosts:100,annualRevenueGrowth:-.9,horizonMonths:24});
  assert.equal(r.summary.paybackMonth,1);assert.equal(r.summary.paybackLost,true);
  assert.ok(r.summary.netResult<0);
});

test('ledger reconciles all cash, taxes and profit through growth and ramp',()=>{
  const r=calculate({initialInvestment:200000,monthlyRevenue:80000,variableCostRate:.3,fixedCosts:20000,ownerSalary:10000,monthlyReinvestment:5000,taxMode:'profit',taxRate:.15,rampMonths:8,horizonMonths:60,annualRevenueGrowth:.08,annualCostGrowth:.06,discountRate:.12});
  let cash=-r.input.initialInvestment;
  for(const row of r.rows.slice(1)){
    close(row.revenue-row.variableCosts-row.fixedCosts-row.ownerSalary-row.tax,row.netProfit);
    close(row.netProfit-row.reinvestment,row.cashFlow);
    cash+=row.cashFlow;close(row.cumulativeCashFlow,cash);
  }
  close(r.summary.netResult,r.summary.totalCashFlow-r.input.initialInvestment);
  close(r.summary.totalNetProfit-r.rows.slice(1).reduce((s,r)=>s+r.reinvestment,0),r.summary.totalCashFlow,1e-6);
});

test('invalid and extreme inputs are bounded and produce finite series',()=>{
  const r=calculate({initialInvestment:-1,monthlyRevenue:Infinity,variableCostRate:7,taxRate:3,horizonMonths:Infinity,rampMonths:-3,annualRevenueGrowth:-2,annualCostGrowth:NaN,discountRate:-5});
  assert.equal(r.input.initialInvestment,0);assert.equal(r.input.variableCostRate,1);assert.equal(r.input.taxRate,.99);
  assert.equal(r.input.rampMonths,0);assert.equal(r.input.annualRevenueGrowth,-.99);assert.equal(r.input.discountRate,0);
  assert.ok(r.rows.every(row=>Object.values(row).every(Number.isFinite)));
  assert.ok(calculate().rows.length>1);assert.ok(calculate(null).rows.length>1);
});
