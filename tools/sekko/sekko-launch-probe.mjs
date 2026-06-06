import { chromium } from 'playwright';
try {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('about:blank');
  await browser.close();
  console.log('LAUNCH_OK');
} catch (e) {
  console.log('LAUNCH_FAIL:', e.message.split('\n')[0]);
}
