/* UI uses the existing monetary input helpers; BusinessModel owns the math. */
(()=>{
  'use strict';
  const el=id=>document.getElementById(id);
  const money=value=>fmt(Math.round(value)||0);
  const percent=value=>(value*100).toLocaleString('ru-RU',{maximumFractionDigits:1})+'%';
  const number=id=>Number(el(id).value)||0;
  const cash=id=>parseMoney(el(id).value);
  const state=window.businessState={result:null,selectedMonth:0};
  const moneyIds=['bizInvestment','bizRevenue','bizFixed','bizSalary','bizReinvestment'];
  const numberIds=['bizRamp','bizHorizon','bizVariable','bizTaxRate','bizRevenueGrowth','bizCostGrowth','bizDiscount'];
  function read(){
    return {
      initialInvestment:cash('bizInvestment'),monthlyRevenue:cash('bizRevenue'),
      fixedCosts:cash('bizFixed'),ownerSalary:cash('bizSalary'),monthlyReinvestment:cash('bizReinvestment'),
      variableCostRate:number('bizVariable')/100,taxMode:el('bizTaxMode').value,taxRate:number('bizTaxRate')/100,
      rampMonths:number('bizRamp'),horizonMonths:number('bizHorizon'),
      annualRevenueGrowth:number('bizRevenueGrowth')/100,annualCostGrowth:number('bizCostGrowth')/100,discountRate:number('bizDiscount')/100
    };
  }
  function renderBusiness(){
    const result=BusinessModel.calculate(read());state.result=result;
    const {summary:s,steadyMonth:m,input:p}=result;
    const payoff=value=>p.initialInvestment===0?'Не рассчитывается':value===null?'Не достигнута':value+' мес.';
    const roi=s.roi===null?'—':percent(s.roi);
    const cards=[
      ['Свободные деньги в месяц',money(m.cashFlow),'При полной выручке, после оплаты владельца, налога и резерва',m.cashFlow>=0?'ok':'warn'],
      ['Окупаемость вложений',payoff(s.paybackMonth),'Первый месяц возврата '+money(p.initialInvestment),s.paybackMonth!==null?'ok':''],
      ['Выручка для безубыточности',result.breakevenRevenue===null?'Недостижима':money(result.breakevenRevenue),'В месяц, включая оплату владельца и резерв; в начальных ценах',''],
      ['Нужно денег с учётом убытков',money(s.requiredFunding),'Из них сверх запуска: '+money(s.extraFunding),s.extraFunding>0?'warn':''],
      ['Чистый денежный результат',money(s.netResult),'За '+p.horizonMonths+' мес., за вычетом первоначальных вложений',s.netResult>=0?'ok':'warn'],
      ['Доходность вложений (ROI)',roi,s.roi===null?'Не определяется без первоначальных вложений':'За все '+p.horizonMonths+' мес., не годовая; база — первоначальные вложения',s.roi!==null&&s.roi<0?'warn':''],
      ['Результат с учётом ставки (NPV)',money(s.npv),'Будущие потоки приведены по ставке '+percent(p.discountRate)+' годовых',s.npv>=0?'ok':'warn'],
      ['Окупаемость с учётом ставки',payoff(s.discountedPaybackMonth),'Первое пересечение нуля, ставка '+percent(p.discountRate)+'. Результат позднее может снизиться','']
    ];
    el('businessResults').innerHTML=cards.map(([label,value,note,cls])=>'<div class="res"><div class="lbl">'+label+'</div><div class="val '+cls+'">'+value+'</div><div class="note">'+note+'</div></div>').join('');
    let message=p.initialInvestment===0?'Первоначальных вложений нет: срок их окупаемости и ROI не определяются.':s.paybackMonth===null?'За '+p.horizonMonths+' месяцев первоначальные вложения не окупаются.':'Вложения впервые возвращаются к концу '+s.paybackMonth+'-го месяца.';
    if(s.paybackLost)message+=' Позже накопленный результат снова становится отрицательным — первая окупаемость не означает устойчивую прибыльность.';
    if(s.extraFunding>0)message+=' Для покрытия убытков понадобится ещё '+money(s.extraFunding)+' сверх первоначальных вложений. Эти убытки уже включены в денежный результат.';
    if(m.cashFlow<=0)message+=' На плановой выручке в начальных ценах свободного денежного потока '+(m.cashFlow<0?'не хватает даже на текущие расходы и резерв.':'не остаётся.');
    if(s.npv<0)message+=' При ставке сравнения '+percent(p.discountRate)+' будущие поступления не покрывают вложения с требуемой доходностью.';
    el('businessSummary').textContent=message;
    el('businessSummary').dataset.state=s.paybackLost||s.netResult<0||m.cashFlow<=0?'warning':'ok';
    const rows=[['Выручка',m.revenue],['Переменные расходы',-m.variableCosts],['Постоянные расходы',-m.fixedCosts],['Оплата труда владельца',-m.ownerSalary],['Налог',-m.tax],['Прибыль после налога',m.netProfit],['Резерв на обновление',-m.reinvestment],['Свободные деньги',m.cashFlow]];
    el('businessMonthly').innerHTML=rows.map(([label,value],i)=>'<div class="business-monthly-row '+(i===7?'total':'')+'"><span>'+label+'</span><strong class="'+(i===7?(value>=0?'rate-positive':'rate-negative'):'')+'">'+money(value)+'</strong></div>').join('');
    el('businessTable').innerHTML=result.rows.map(row=>'<tr data-month="'+row.month+'"><th scope="row">'+(row.month===0?'Запуск':row.month)+'</th><td>'+money(row.revenue)+'</td><td>'+money(row.tax)+'</td><td>'+money(row.cashFlow)+'</td><td>'+money(row.cumulativeCashFlow)+'</td></tr>').join('');
    state.selectedMonth=Math.min(state.selectedMonth,p.horizonMonths);
    el('bizChartMonth').max=p.horizonMonths;
    updateSelection();
  }
  function updateSelection(){
    const r=state.result.rows[state.selectedMonth];
    el('bizChartMonth').value=state.selectedMonth;
    el('bizChartMonthLabel').textContent=r.month===0?'Запуск':r.month;
    el('businessChartReadout').textContent=(r.month===0?'Запуск':'Месяц '+r.month)+': '+(r.month===0?'вложения ':'свободные деньги за месяц ')+money(r.cashFlow)+'. Итог с вложениями: '+money(r.cumulativeCashFlow)+'. С учётом ставки: '+money(r.cumulativeDiscountedCashFlow)+'.';
    el('bizChartMonth').setAttribute('aria-valuetext',el('businessChartReadout').textContent);
    el('businessTable').querySelectorAll('tr').forEach(row=>row.dataset.selected=Number(row.dataset.month)===r.month);
    drawBusinessChart();
  }
  function drawBusinessChart(){
    if(!state.result||el('businessPanel').hidden)return;
    const svg=el('businessChart'),w=svg.clientWidth||700,h=svg.clientHeight||310;
    const pad={left:68,right:12,top:20,bottom:32};
    const pw=Math.max(1,w-pad.left-pad.right),ph=h-pad.top-pad.bottom,rows=state.result.rows;
    const values=rows.flatMap(r=>[r.cumulativeCashFlow,r.cumulativeDiscountedCashFlow]);
    let low=Math.min(0,...values),high=Math.max(0,...values);
    const spread=Math.max(1,high-low);low-=spread*.08;high+=spread*.08;
    const x=month=>pad.left+month/state.result.input.horizonMonths*pw;
    const y=value=>pad.top+(high-value)/(high-low)*ph;
    const compact=value=>Math.abs(value)>=1e6?(value/1e6).toLocaleString('ru-RU',{maximumFractionDigits:1})+' млн':Math.abs(value)>=1000?(value/1000).toLocaleString('ru-RU',{maximumFractionDigits:0})+' тыс.':Math.round(value).toLocaleString('ru-RU');
    let html='<title>Возврат вложений в бизнес: обычный и дисконтированный денежный поток</title>';
    for(let i=0;i<=4;i++){
      const v=low+(high-low)*i/4,py=y(v);
      html+='<line x1="'+pad.left+'" x2="'+(w-pad.right)+'" y1="'+py+'" y2="'+py+'" stroke="#2a4a75"/>';
      if(Math.abs(py-y(0))>14)html+='<text x="'+(pad.left-7)+'" y="'+(py+4)+'" text-anchor="end" fill="#8fa5c0" font-size="10">'+compact(v)+'</text>';
    }
    html+='<line x1="'+pad.left+'" x2="'+(w-pad.right)+'" y1="'+y(0)+'" y2="'+y(0)+'" stroke="#e8eef7" stroke-dasharray="5 5"/><text x="'+pad.left+'" y="12" fill="#8fa5c0" font-size="10">₽ · ноль = вложения возвращены</text>';
    html+='<text x="'+(pad.left-7)+'" y="'+(y(0)+4)+'" text-anchor="end" fill="#e8eef7" font-size="11">0</text>';
    const ticks=new Set([0,state.result.input.horizonMonths]);
    for(let i=1;i<5;i++)ticks.add(Math.round(state.result.input.horizonMonths*i/5));
    [...ticks].sort((a,b)=>a-b).forEach(month=>html+='<text x="'+x(month)+'" y="'+(h-10)+'" text-anchor="middle" fill="#8fa5c0" font-size="11">'+month+'</text>');
    [['cumulativeDiscountedCashFlow','#c4b5fd'],['cumulativeCashFlow','#2dd4bf']].forEach(([key,color])=>{
      html+='<polyline fill="none" stroke="'+color+'" stroke-width="2.5" points="'+rows.map(r=>x(r.month)+','+y(r[key])).join(' ')+'"/>';
    });
    const selected=rows[state.selectedMonth];
    html+='<line x1="'+x(selected.month)+'" x2="'+x(selected.month)+'" y1="'+pad.top+'" y2="'+(h-pad.bottom)+'" stroke="#8fa5c0" stroke-dasharray="3 4"/>';
    html+='<circle cx="'+x(selected.month)+'" cy="'+y(selected.cumulativeCashFlow)+'" r="4" fill="#2dd4bf"/>';
    svg.setAttribute('viewBox','0 0 '+w+' '+h);svg.innerHTML=html;
    state.chart={width:w,pad,pw};
  }
  moneyIds.forEach(id=>{
    const input=el(id);formatMoneyField(input);
    input.addEventListener('input',()=>{formatMoneyField(input);renderBusiness();});
    input.addEventListener('blur',()=>{input.value=formatMoneyInput(Math.min(1e12,parseMoney(input.value)));renderBusiness();});
  });
  numberIds.forEach(id=>{
    const input=el(id);
    const normalize=()=>{
      const value=Math.max(+input.min,Math.min(+input.max,Number(input.value)||0));
      input.value=id==='bizRamp'||id==='bizHorizon'?Math.round(value):value;
    };
    input.addEventListener('input',()=>{if(input.value!=='')normalize();renderBusiness();});
    input.addEventListener('blur',()=>{normalize();renderBusiness();});
  });
  el('bizTaxMode').addEventListener('input',renderBusiness);
  el('bizChartMonth').addEventListener('input',()=>{state.selectedMonth=+el('bizChartMonth').value;updateSelection();});
  el('businessChart').addEventListener('pointermove',event=>{
    if(!state.chart)return;
    const rect=el('businessChart').getBoundingClientRect();
    const month=Math.round((event.clientX-rect.left-state.chart.pad.left)/state.chart.pw*state.result.input.horizonMonths);
    state.selectedMonth=Math.max(0,Math.min(state.result.input.horizonMonths,month));updateSelection();
  });
  const tabs=[el('investmentTab'),el('businessTab')];
  function activate(business,updateHash=false){
    cancelLineDwell();
    tabs.forEach((tab,i)=>{const active=(i===1)===business;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;});
    el('investmentPanel').hidden=business;el('businessPanel').hidden=!business;
    if(updateHash)history.replaceState(null,'',business?'#business':'#investments');
    if(business)drawBusinessChart();else{drawChart();updateInfo();}
  }
  tabs.forEach((tab,i)=>{
    tab.addEventListener('click',()=>activate(i===1,true));
    tab.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();
      const next=event.key==='Home'?0:event.key==='End'?1:1-i;
      activate(next===1,true);tabs[next].focus();
    });
  });
  window.addEventListener('hashchange',()=>activate(location.hash==='#business'));
  window.addEventListener('resize',drawBusinessChart);
  renderBusiness();activate(location.hash==='#business');
})();
