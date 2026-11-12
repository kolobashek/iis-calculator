// Run with Playwright available through NODE_PATH; Chrome must be installed.
const {chromium}=require('playwright');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const assert=require('node:assert/strict');
const close=(a,b)=>assert.ok(Math.abs(a-b)<.01,`${a} != ${b}`);

(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1100}});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    const url=pathToFileURL(path.join(__dirname,'../index.html')).href;
    await page.goto(url);
    const set=async(id,value)=>page.evaluate(({id,value})=>{
      const el=document.getElementById(id);
      if(el.type==='checkbox')el.checked=value;else el.value=value;
      el.dispatchEvent(new Event('input',{bubbles:true}));
    },{id,value});
    const result=()=>page.evaluate(()=>window.businessState.result);
    const verifyTabs=async(which)=>{
      for(const name of ['investment','business']){
        assert.equal(await page.locator('#'+name+'Tab').getAttribute('aria-selected'),String(name===which));
        assert.equal(await page.locator('#'+name+'Panel').isVisible(),name===which);
      }
    };
    await verifyTabs('investment');
    await page.locator('#monthly').fill('24000');
    const investmentValue=await page.locator('#monthly').inputValue();
    const investmentCapital=await page.evaluate(()=>chartState.data.nominal[chartState.data.splitIdx]);
    await page.locator('#businessTab').click();
    await verifyTabs('business');
    assert.equal(new URL(page.url()).hash,'#business');
    assert.equal(await page.locator('#bizInvestment').inputValue(),'1 000 000');
    await page.locator('#bizRevenue').fill('456789,50');
    assert.equal(await page.locator('#bizRevenue').inputValue(),'456 789,50');
    await page.locator('#investmentTab').click();
    await verifyTabs('investment');
    assert.equal(await page.locator('#monthly').inputValue(),investmentValue);
    close(await page.evaluate(()=>chartState.data.nominal[chartState.data.splitIdx]),investmentCapital);
    await page.locator('#businessTab').click();
    assert.equal(await page.locator('#bizRevenue').inputValue(),'456 789,5');

    // Automatic tab activation follows WAI-ARIA keyboard navigation.
    await page.locator('#businessTab').focus();
    await page.keyboard.press('ArrowLeft');await verifyTabs('investment');
    await page.keyboard.press('ArrowRight');await verifyTabs('business');
    await page.keyboard.press('Home');await verifyTabs('investment');
    await page.keyboard.press('End');await verifyTabs('business');
    assert.equal(await page.locator('#businessTab').getAttribute('tabindex'),'0');

    const configure=async(values)=>{for(const [id,value] of Object.entries(values))await set(id,value);};
    await configure({bizInvestment:120000,bizRevenue:10000,bizFixed:0,bizSalary:0,bizReinvestment:0,bizVariable:0,bizRamp:0,bizHorizon:24,bizTaxRate:0,bizRevenueGrowth:0,bizCostGrowth:0,bizDiscount:12});
    let data=await result();
    assert.equal(data.summary.paybackMonth,12);
    close(data.summary.roi,1);
    close(data.rows[0].cumulativeCashFlow,-120000);
    close(data.rows.at(-1).cumulativeCashFlow,120000);
    assert.ok(data.summary.discountedPaybackMonth>12);
    assert.ok(await page.locator('#businessTable tr').count()>=24);
    assert.ok(!/NaN|undefined|Infinity/.test(await page.locator('#businessResults').innerText()));
    await set('bizChartMonth',0);
    assert.match(await page.locator('#businessChartReadout').innerText(),/120[\s\u00a0\u202f]?000/);
    await set('bizChartMonth',24);
    assert.match(await page.locator('#businessChartReadout').innerText(),/120[\s\u00a0\u202f]?000/);

    // Empty/zero startup capital must not produce an infinite ROI or a fake payback.
    await set('bizInvestment',0);
    data=await result();
    assert.equal(data.summary.roi,null);
    assert.equal(data.summary.paybackMonth,null);
    assert.ok(!/NaN|undefined|Infinity/.test(await page.locator('#businessResults').innerText()));

    // Losses and the funding gap are surfaced, including the initial investment.
    await configure({bizInvestment:120000,bizRevenue:0,bizFixed:10000,bizHorizon:12});
    data=await result();
    assert.equal(data.summary.paybackMonth,null);
    close(data.summary.requiredFunding,240000);
    close(data.summary.extraFunding,120000);
    close(data.summary.netResult,-240000);

    // The tax basis selector changes actual cash flow, not only a label.
    await configure({bizRevenue:100000,bizFixed:20000,bizVariable:20,bizTaxRate:10,bizTaxMode:'revenue'});
    const revenueTax=await result();
    close(revenueTax.steadyMonth.tax,10000);
    await set('bizTaxMode','profit');
    const profitTax=await result();
    close(profitTax.steadyMonth.tax,6000);
    close(profitTax.steadyMonth.cashFlow-revenueTax.steadyMonth.cashFlow,4000);

    // Direct business URLs activate the panel on load.
    await page.goto(url+'#business');
    await verifyTabs('business');
    await page.screenshot({path:path.join(__dirname,'../../business-desktop.png'),fullPage:true});
    for(const width of [768,390]){
      await page.setViewportSize({width,height:844});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Overflow at ${width}px`);
      await page.locator('#bizInvestment').fill('1000000');
      assert.equal(await page.locator('#bizInvestment').inputValue(),'1 000 000');
      close((await result()).rows[0].cumulativeCashFlow,-1000000);
      const box=await page.locator('#businessChart').boundingBox();
      assert.ok(box.width>0&&box.height>0);
    }
    await page.screenshot({path:path.join(__dirname,'../../business-mobile.png'),fullPage:true});
    await page.locator('#investmentTab').click();
    await page.locator('#monthly').fill('18000');
    assert.equal(await page.locator('#monthly').inputValue(),'18 000');
    assert.ok(await page.evaluate(()=>chartState.data.nominal.every(Number.isFinite)));
    assert.deepEqual(errors,[]);
    console.log('Business browser smoke passed: tabs/keyboard/hash, input persistence, formatting, exact cash flow, both tax bases, losses/funding, zero investment, pension regression, mobile layout.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
