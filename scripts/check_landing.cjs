// Run with PLAYWRIGHT_MODULE set to a locally installed Playwright module.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const out = path.resolve('.impeccable/review');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const results = [];
  try {
    for (const width of [1440, 390, 320, 768, 1024]) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.locator('.lp img').evaluateAll(images => Promise.all(images.map(image => { image.loading = 'eager'; return image.decode(); })));
      assert.match(await page.locator('.lp-room-cover img').getAttribute('src'), /study-together/, 'Reading room image did not switch to the group study photo');
      const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, headingLines: document.querySelector('h1').getBoundingClientRect().height / parseFloat(getComputedStyle(document.querySelector('h1')).lineHeight) }));
      assert.ok(dimensions.scroll <= dimensions.width, `Horizontal overflow at ${width}: ${JSON.stringify(dimensions)}`);
      assert.equal(await page.evaluate(() => window.innerWidth - document.documentElement.clientWidth), 0, `Scrollbar gutter remains at ${width}`);
      assert.ok(dimensions.headingLines < 3.2, `Hero wraps too far at ${width}`);
      const name = width === 1440 ? 'desktop' : width === 390 ? 'mobile' : `user-${width}`;
      await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
      await page.screenshot({ path: path.join(out, `${name}-hero.png`) });
      await page.getByRole('button', { name: 'Economics', exact: true }).click();
      await page.getByText('Why does opportunity cost matter?', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Introduction to Economics' }).click();
      assert.equal(await page.locator('#sample-source').isVisible(), true);
      await page.getByRole('button', { name: 'Biology', exact: true }).click();
      assert.equal(await page.locator('#sample-source').count(), 0);
      await page.getByRole('button', { name: 'Next study scenario' }).click();
      assert.equal(await page.locator('.lp-scenario h3').textContent(), 'For the topic that finally clicks.');
      await page.getByRole('button', { name: 'Previous study scenario' }).click();
      assert.equal(await page.locator('.lp-scenario h3').textContent(), 'For the “where did I save that?” moments.');
      if (width < 901) {
        await page.getByRole('button', { name: 'Open menu' }).click();
        await page.locator('#landing-mobile-nav a').first().click();
        assert.equal(await page.locator('#landing-mobile-nav').count(), 0);
        assert.equal(new URL(page.url()).hash, '#capabilities');
      }
      assert.equal(await page.getByText('Pexels', { exact: true }).count(), 0);
      assert.equal(await page.getByText('3dicons', { exact: true }).count(), 0);
      if (width === 390 || width === 320) {
        await page.locator('.lp-footer').scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        await page.screenshot({ path: path.join(out, `footer-${width}.png`) });
        assert.ok(await page.locator('.lp-footer').evaluate(element => element.getBoundingClientRect().right <= document.documentElement.clientWidth), `Footer overflows at ${width}`);
      }
      await page.getByRole('button', { name: 'Create your free account', exact: true }).click();
      await page.locator('.lp').waitFor({ state: 'detached' });
      assert.ok(await page.locator('input[type="email"]').count(), 'Signup email field missing');
      assert.equal(await page.evaluate(() => window.scrollY), 0, 'Signup did not reset scroll');
      results.push({ width, ...dimensions, interactions: 'passed' });
      await context.close();
    }
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
    const journeyColor = () => page.locator('.lp-journey').evaluate(element => getComputedStyle(element).backgroundColor);
    await page.waitForTimeout(700);
    const whyLink = page.locator('.lp-nav-links a').first();
    assert.equal(await whyLink.locator('.lp-nav-ring ellipse').evaluate(element => getComputedStyle(element).opacity), '0', 'Navigation circle is visible while idle');
    await whyLink.hover();
    await page.waitForTimeout(620);
    assert.equal(await whyLink.locator('.lp-nav-ring ellipse').evaluate(element => parseFloat(getComputedStyle(element).strokeDashoffset)), 0, 'Navigation circle did not complete on hover');
    const initialFeatureColor = await journeyColor();
    assert.equal(await page.locator('.lp-hero-sheet, .lp-hero-bulb').count(), 0, 'Removed hero ornaments are still present');
    const waterHasInk = await page.locator('.lp-water-field canvas').evaluate(canvas => {
      const context = canvas.getContext('2d');
      if (!context) return false;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) return true;
      return false;
    });
    assert.equal(waterHasInk, true, 'Water surface canvas did not draw');
    const initialDepth = await page.locator('.lp-hero-depth').evaluate(element => getComputedStyle(element).transform);
    await page.locator('.lp-hero-photo').hover({ position: { x: 280, y: 140 } });
    await page.waitForTimeout(850);
    assert.notEqual(await page.locator('.lp-hero-depth').evaluate(element => getComputedStyle(element).transform), initialDepth, 'Hero does not respond in 3D to pointer movement');
    await page.screenshot({ path: path.join(out, 'desktop-water.png') });
    await page.mouse.move(1, 1);
    await page.locator('.lp-materials').evaluate(element => window.scrollTo(0, element.offsetTop - 140));
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(out, 'hero-materials-transition.png') });
    await page.locator('.lp-nav-links a').nth(1).click();
    await page.waitForTimeout(1000);
    assert.equal(new URL(page.url()).hash, '#workflow');
    assert.ok(await page.locator('#workflow').evaluate(element => Math.abs(element.getBoundingClientRect().top - 100) < 130), 'Smooth navigation did not reach workflow');
    const colors = [];
    for (const selector of ['.lp-features', '.lp-workflow', '.lp-integrity', '.lp-life']) {
      const stages = [];
      for (const viewportFraction of [0.8, 0.1]) {
        await page.locator(selector).evaluate((element, fraction) => window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - window.innerHeight * fraction), viewportFraction);
        await page.waitForTimeout(700);
        stages.push(await journeyColor());
      }
      assert.notEqual(stages[0], stages[1], `${selector} did not darken`);
      assert.equal(await page.locator('body').evaluate(element => getComputedStyle(element).backgroundColor), stages[1], `Document edge does not match ${selector}`);
      colors.push({ selector, stages });
      await page.screenshot({ path: path.join(out, `${selector.slice(4)}-scroll.png`) });
    }
    const pill = await page.locator('.lp-nav').evaluate(element => ({ radius: parseFloat(getComputedStyle(element).borderRadius), width: element.getBoundingClientRect().width }));
    assert.ok(pill.radius > 100 && pill.width <= 1100, `Navigation did not become a pill: ${JSON.stringify(pill)}`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(700);
    assert.equal(await journeyColor(), initialFeatureColor);
    assert.equal(await page.locator('.lp-header').evaluate(element => element.classList.contains('is-scrolled')), false);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.lp-features').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(234, 219, 202)');
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await page.locator('.lp').waitFor({ state: 'detached' });
    assert.equal(await page.locator('input[type="email"]').count(), 1);
    assert.deepEqual(errors, [], 'Browser runtime errors');
    fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify({ results, colors, errors }, null, 2));
    console.log(JSON.stringify({ results, colors, errors }, null, 2));
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
