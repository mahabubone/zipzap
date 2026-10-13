import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { resolve } from 'path';

const shotsDir = resolve(__dirname, '../shots');
mkdirSync(shotsDir, { recursive: true });

const SCREENS = [
  // Hub Console
  { name: 'hub-console-overview', url: 'http://localhost:5175/hubs/DCH-01', waitFor: 'nav' },
  { name: 'hub-console-work', url: 'http://localhost:5175/hubs/DCH-01/work', waitFor: 'nav' },
  { name: 'hub-console-riders', url: 'http://localhost:5175/hubs/DCH-01/riders', waitFor: 'nav' },
  { name: 'hub-console-deliveries', url: 'http://localhost:5175/hubs/DCH-01/deliveries', waitFor: 'nav' },
  { name: 'hub-console-pickups', url: 'http://localhost:5175/hubs/DCH-01/pickups', waitFor: 'nav' },
  { name: 'hub-console-manifests', url: 'http://localhost:5175/manifests', waitFor: 'nav' },

  // Merchant Web (Public Tracking + Merchant Console)
  { name: 'web-home', url: 'http://localhost:5173', waitFor: 'nav' },
  { name: 'web-login', url: 'http://localhost:5173/login', waitFor: 'nav' },
  { name: 'tracking-home', url: 'http://localhost:5174', waitFor: 'nav' },
];

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  for (const screen of SCREENS) {
    try {
      console.log(`📸 Capturing ${screen.name}...`);
      const page = await context.newPage();

      await page.goto(screen.url, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      // Small delay for rendering
      await page.waitForTimeout(1000);

      // Handle any auth redirect for hub console
      if (screen.url.includes('localhost:5175') && screen.name !== 'hub-console-login') {
        // Check if we need to log in
        const loginForm = await page.$('input[type="password"]');
        if (loginForm) {
          console.log(`  🔐 Logging in for ${screen.name}...`);
          await page.fill('input[type="email"]', 'hub@zipzap.dev');
          await page.fill('input[type="password"]', 'hubhubhub');
          await page.click('button[type="submit"]');
          await page.waitForURL('**/hubs/**', { timeout: 10000 });
          await page.waitForTimeout(1000);
        }
      }

      const filename = `${screen.name}.png`;
      await page.screenshot({ path: resolve(shotsDir, filename), fullPage: true });
      console.log(`  ✅ Saved ${filename}`);

      await page.close();
    } catch (e) {
      console.error(`  ❌ Failed ${screen.name}:`, e);
    }
  }

  await browser.close();
  console.log('🏁 All screenshots captured!');
}

main().catch(console.error);