// Run with Playwright available through NODE_PATH; Chrome must be installed.
const {chromium}=require('playwright');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1100}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(pathToFileURL(path.join(__dirname,'../index.html')).href);
    const set=async(id,value)=>page.evaluate(({id,value})=>{
      const input=document.getElementById(id);
      if(input.type==='checkbox')input.checked=value;else input.value=value;
      input.dispatchEvent(new Event('input',{bubbles:true}));
    },{id,value});
    assert.equal(await page.locator('#monthly').inputValue(),'17 000');
    assert.equal(await page.locator('#withdraw').inputValue(),'80 000');
    await page.locator('#startCap').fill('1\u202f234\u00a0567,89 ₽');
    assert.equal(await page.locator('#startCap').inputValue(),'1 234 567,89');
    assert.equal(await page.evaluate(()=>chartState.data.nominal[0]),1234567.89);
    await page.locator('#monthly').fill('');
    await page.locator('#monthly').pressSequentially('18000');
    assert.equal(await page.locator('#monthly').inputValue(),'18 000');
    await page.locator('#monthly').evaluate(el=>el.setSelectionRange(1,1));
    await page.keyboard.type('2');
    assert.equal(await page.locator('#monthly').inputValue(),'128 000');
    assert.equal(await page.locator('#monthly').evaluate(el=>el.selectionStart),2);
    await page.keyboard.press('Backspace');
    assert.equal(await page.locator('#monthly').inputValue(),'18 000');
    await set('startCap',36554.56);
    await set('ret',12);await set('retP',10);await set('inflation',7.5);
    const snapshot=()=>page.evaluate(()=>({
      capital:chartState.data.nominal[chartState.data.splitIdx],
      accTaxes:chartState.data.taxSeries[chartState.data.splitIdx],
      refunds:chartState.data.components.refunds[chartState.data.splitIdx],
      netRates:[...document.querySelectorAll('.rate-panel')].map(e=>e.innerText)
    }));
    const iis=await snapshot();assert.ok(iis.accTaxes>0);assert.ok(iis.refunds>0);
    await set('accountType','broker');
    const broker=await snapshot();
    assert.equal(broker.refunds,0);assert.ok(broker.capital<iis.capital);
    assert.equal(await page.locator('#refundFields').isVisible(),false);
    assert.equal(await page.locator('#iisDividendField').isVisible(),false);
    await set('incomeTaxes',false);
    const gross=await snapshot();assert.equal(gross.accTaxes,0);assert.ok(gross.capital>broker.capital);
    await set('incomeTaxes',true);
    assert.equal((await snapshot()).capital,broker.capital,'No double tax when toggled');
    let cases=0;
    for(const account of ['iis3','broker'])for(const tax of [false,true])for(const mode of ['A','B','C']){
      await set('accountType',account);await set('incomeTaxes',tax);
      await page.locator('#m'+mode).click();
      await set('workOn',true);await set('indexContributions',true);
      const result=await page.evaluate(()=>{
        const d=chartState.data;
        return {
          finite:d.vals.every(v=>Number.isFinite(v)&&v>=0),
          sum:d.vals.every((v,i)=>Math.abs(v-Object.values(d.components).reduce((s,arr)=>s+arr[i],0))<.001),
          tax:d.taxSeries.every((v,i)=>Number.isFinite(v)&&v>=0&&(!i||v>=d.taxSeries[i-1])),
          end:d.vals.at(-1),text:document.getElementById('results').innerText
        };
      });
      assert.ok(result.finite&&result.sum&&result.tax);
      assert.ok(!/NaN|undefined/.test(result.text));
      if(mode==='C')assert.ok(result.end<.01);
      cases++;
    }
    await set('workOn',false);await set('accountType','broker');await set('incomeTaxes',true);
    await set('retP',8);await set('inflation',7.5);await page.locator('#mB').click();
    assert.equal(await page.locator('.rate-panel').nth(1).getAttribute('data-state'),'negative');
    assert.match(await page.locator('#summary').innerText(),/невозможна/);
    // Exercise closure beyond the exemption and phase boundary in the actual page.
    await set('accountType','iis3');await set('monthly',1000000);await set('dividendShare',0);
    assert.match(await page.locator('#results').innerText(),/Из них при закрытии ИИС-3/);
    assert.ok((await snapshot()).accTaxes>0);
    await set('chartMonth',180);
    assert.equal(await page.locator('#chartBreakdown .res').count(),6);
    assert.match(await page.locator('#chartBreakdown').innerText(),/Налоги удержаны/);
    for(const units of ['real','nominal','comparison']){
      await set('chartUnits',units);
      assert.ok(await page.evaluate(()=>chartState.data.vals.every(Number.isFinite)));
    }
    await set('monthly',18000);await set('dividendShare',25);await set('retP',10);
    await page.locator('#mA').click();
    await page.screenshot({path:path.join(__dirname,'../../taxes-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.locator('#startCap').fill('1000000');
    assert.equal(await page.locator('#startCap').inputValue(),'1 000 000');
    assert.equal(await page.evaluate(()=>chartState.data.nominal[0]),1000000);
    await page.screenshot({path:path.join(__dirname,'../../taxes-mobile.png'),fullPage:true});
    assert.deepEqual(errors,[]);
    console.log(`Passed ${cases} account/tax/pension combinations, tax threshold, net return, money input/caret, and mobile checks.`);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
