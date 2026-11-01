const { test, expect } = require('@playwright/test');
const { player, create, action, normalCall, playOne, answerPartnerFeedback } = require('./helpers/watten-journey.cjs');
for (const language of ['de', 'en']) for (const count of [2, 3, 4]) for (const viewport of [{ width: 320, height: 568 }, { width: 350, height: 568 }, { width: 320, height: 700 }, { width: 360, height: 640 }, { width: 375, height: 667 }, { width: 390, height: 568 }, { width: 390, height: 700 }, { width: 391, height: 700 }, { width: 440, height: 568 }, { width: 440, height: 600 }, { width: 440, height: 700 }]) test(`${language}: short play and bidding zones with ${count} players at ${viewport.width}x${viewport.height}`,  async ({ browser, baseURL }, info) => {
  test.setTimeout(90000);
  const p=[];
  try {
    const b={newContext: options => browser.newContext({...options, viewport:{width:440,height:956}, serviceWorkers:'block'})};
    for (let i=0;i<count;i++) p.push(await player(b,baseURL,language));
    await create(p,{count,target:15,determination:'normal'});
    await normalCall(p);
    for (const peer of p) await peer.page.setViewportSize(viewport);
    await playOne(p);
    // Compare settled card slots: the arrival animation intentionally scales a card.
    await Promise.all(p.map(peer => peer.page.locator('.wt-trick-card').first().evaluate(async node => {
      await Promise.allSettled(node.getAnimations().map(animation => animation.finished));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    })));
    const before = await Promise.all(p.map(peer => peer.page.locator('.wt-trick-card').first().boundingBox()));
    await action(p,'bid');
    await expect.poll(()=>p.every(q=>q.traffic.snapshot.engine.phase==='bid_response')).toBe(true);
    await answerPartnerFeedback(p,'good');
    const q=p.find(q=>q.traffic.snapshot.engine.actions.includes('respond_hold'));
    const page=q.page;
    const beforeBid = before[p.indexOf(q)];
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const inspect=await page.evaluate(()=>{
      const visible=n=>!n.closest('[hidden]')&&getComputedStyle(n).display!=='none'&&getComputedStyle(n).visibility!=='hidden'&&n.getBoundingClientRect().width>0;
      const hit=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;
      const buttons=[...document.querySelectorAll('[data-wt-panel] .wt-bid button')].filter(visible);
      const cards=[...document.querySelectorAll('.wt-trick-card')].filter(visible);
      const targets=[...document.querySelectorAll('[data-wt-panel], [data-wt-stake], [data-wt-hand] > *, .wt-seat-name, .wt-seat-call-role, .wt-backs > i:not([hidden]), .wt-reference')].filter(visible);
      return { buttons:buttons.map(n=>{const r=n.getBoundingClientRect();return {w:r.width,h:r.height,hit:n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}}),
        clashes:targets.flatMap(n=>cards.filter(c=>hit(n.getBoundingClientRect(),c.getBoundingClientRect())).map(()=>n.className)),
        handWidths:[...document.querySelectorAll('[data-wt-hand] > *')].filter(visible).map(n=>parseFloat(getComputedStyle(n).width)),
        seats:[...document.querySelectorAll('.wt-seat:not(.is-own) .wt-backs > i:not([hidden])')].filter(visible).map(n=>n.getBoundingClientRect().width),
        centre:{...document.querySelector('.wt-centre').dataset}};
    });
    await page.screenshot({path:info.outputPath(`short-${language}-${count}-${viewport.width}x${viewport.height}.png`)});
    expect(inspect.buttons.length).toBe(3);
    expect(inspect.buttons.every(b=>b.w>=43.9&&b.h>=43.9&&b.hit)).toBe(true);
    expect(inspect.clashes).toEqual([]);
    expect(inspect.centre.wtPortraitTrick).toBe('true');
    expect(inspect.handWidths.every(width => width >= 60)).toBe(true);
    if (viewport.width > 390 && viewport.height >= 600) {
      expect(await page.locator('.wt-trick-card').first().evaluate(node => parseFloat(getComputedStyle(node).width))).toBeGreaterThanOrEqual(76);
    }
    expect(await page.locator('.wt-trick-card').first().boundingBox()).toEqual(beforeBid);
    await action(p,'respond_hold','hold');
    await expect.poll(() => q.traffic.snapshot.engine.phase).toBe('play');
    expect(await page.locator('.wt-trick-card').first().boundingBox()).toEqual(beforeBid);
  } finally {await Promise.allSettled(p.map(x=>x.context.close()));}
});
