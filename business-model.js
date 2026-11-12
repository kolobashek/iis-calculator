(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BusinessModel=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const defaults={
    initialInvestment:500000,monthlyRevenue:250000,variableCostRate:.4,
    fixedCosts:60000,ownerSalary:40000,monthlyReinvestment:10000,
    taxMode:'revenue',taxRate:.06,rampMonths:6,horizonMonths:60,
    annualRevenueGrowth:0,annualCostGrowth:0,discountRate:.1
  };
  const bounded=(value,fallback,min,max)=>{
    const number=Number(value===undefined?fallback:value);
    return Number.isFinite(number)?Math.max(min,Math.min(max,number)):fallback;
  };
  function normalize(input={}){
    input=input||{};
    const normalized={...defaults};
    for(const key of ['initialInvestment','monthlyRevenue','fixedCosts','ownerSalary','monthlyReinvestment']){
      normalized[key]=bounded(input[key],defaults[key],0,1e12);
    }
    normalized.variableCostRate=bounded(input.variableCostRate,defaults.variableCostRate,0,1);
    normalized.taxRate=bounded(input.taxRate,defaults.taxRate,0,.99);
    normalized.taxMode=input.taxMode==='profit'?'profit':'revenue';
    normalized.rampMonths=Math.round(bounded(input.rampMonths,defaults.rampMonths,0,600));
    normalized.horizonMonths=Math.round(bounded(input.horizonMonths,defaults.horizonMonths,1,600));
    for(const key of ['annualRevenueGrowth','annualCostGrowth'])normalized[key]=bounded(input[key],defaults[key],-.99,1);
    normalized.discountRate=bounded(input.discountRate,defaults.discountRate,0,1);
    return normalized;
  }

  // Cash is collected and operating costs are paid in the same month.
  // Reinvestment represents a cash reserve for capex, not a deductible expense.
  // Tax rates are user-defined scenarios, not a statutory tax calculation.
  function monthAt(input,month,steady=false){
    const elapsed=steady?0:(month-1)/12;
    const ramp=steady||input.rampMonths===0?1:Math.min(1,month/input.rampMonths);
    const revenue=input.monthlyRevenue*ramp*Math.pow(1+input.annualRevenueGrowth,elapsed);
    const costFactor=Math.pow(1+input.annualCostGrowth,elapsed);
    const variableCosts=revenue*input.variableCostRate;
    const fixedCosts=input.fixedCosts*costFactor;
    const ownerSalary=input.ownerSalary*costFactor;
    const reinvestment=input.monthlyReinvestment*costFactor;
    const profitBeforeTax=revenue-variableCosts-fixedCosts-ownerSalary;
    const tax=Math.max(0,input.taxMode==='revenue'?revenue:profitBeforeTax)*input.taxRate;
    const netProfit=profitBeforeTax-tax;
    return {month,revenue,variableCosts,fixedCosts,ownerSalary,reinvestment,profitBeforeTax,tax,netProfit,cashFlow:netProfit-reinvestment};
  }

  function breakEven(input){
    const fixed=input.fixedCosts+input.ownerSalary;
    if(fixed===0&&input.monthlyReinvestment===0)return 0;
    const margin=1-input.variableCostRate-(input.taxMode==='revenue'?input.taxRate:0);
    if(margin<=0)return null;
    const reinvestment=input.monthlyReinvestment/(input.taxMode==='profit'?1-input.taxRate:1);
    return (fixed+reinvestment)/margin;
  }

  function calculate(rawInput={}){
    const input=normalize(rawInput);
    let cumulative=-input.initialInvestment,discountedCumulative=cumulative;
    let minimum=cumulative,totalRevenue=0,totalTaxes=0,totalNetProfit=0,totalCashFlow=0;
    let paybackMonth=null,discountedPaybackMonth=null,paybackLost=false;
    const rows=[{
      month:0,revenue:0,variableCosts:0,fixedCosts:0,ownerSalary:0,reinvestment:0,
      profitBeforeTax:0,tax:0,netProfit:0,cashFlow:cumulative,
      cumulativeCashFlow:cumulative,discountedCashFlow:cumulative,cumulativeDiscountedCashFlow:cumulative
    }];
    for(let month=1;month<=input.horizonMonths;month++){
      const row=monthAt(input,month);
      totalRevenue+=row.revenue;totalTaxes+=row.tax;totalNetProfit+=row.netProfit;totalCashFlow+=row.cashFlow;
      cumulative+=row.cashFlow;
      row.discountedCashFlow=row.cashFlow/Math.pow(1+input.discountRate,month/12);
      discountedCumulative+=row.discountedCashFlow;
      row.cumulativeCashFlow=cumulative;row.cumulativeDiscountedCashFlow=discountedCumulative;
      rows.push(row);
      minimum=Math.min(minimum,cumulative);
      if(input.initialInvestment>0){
        if(paybackMonth===null&&cumulative>=-1e-8)paybackMonth=month;
        else if(paybackMonth!==null&&cumulative< -1e-8)paybackLost=true;
        if(discountedPaybackMonth===null&&discountedCumulative>=-1e-8)discountedPaybackMonth=month;
      }
    }
    const requiredFunding=Math.max(input.initialInvestment,-minimum);
    const summary={
      totalRevenue,totalTaxes,totalNetProfit,totalCashFlow,
      netResult:cumulative,roi:input.initialInvestment>0?cumulative/input.initialInvestment:null,
      paybackMonth,discountedPaybackMonth,paybackLost,
      requiredFunding,extraFunding:requiredFunding-input.initialInvestment,npv:discountedCumulative
    };
    return {input,rows,summary,steadyMonth:monthAt(input,1,true),breakevenRevenue:breakEven(input)};
  }
  return {calculate};
});
