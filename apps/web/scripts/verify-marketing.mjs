/**
 * Asserts the public pages actually render as designed — a marketing page that
 * silently loses its CSS still returns 200 and still contains the copy.
 *
 * Run: node apps/web/scripts/verify-marketing.mjs
 */
// playwright-core from a global install, not a project dependency.
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core').then(
  (m) => m.default ?? m,
);

const WEB = process.env.WEB_URL ?? 'http://localhost:5173';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        got ${JSON.stringify(actual)}\n        want ${JSON.stringify(expected)}`}`,
  );
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox'],
});

// --- home --------------------------------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${WEB}/`);
  await page.waitForLoadState('networkidle');

  const home = await page.evaluate(() => {
    const h1 = document.querySelector('h1');
    const header = document.querySelector('header');
    return {
      h1Size: h1 ? getComputedStyle(h1).fontSize : null,
      h1Weight: h1 ? getComputedStyle(h1).fontWeight : null,
      h1Width: h1 ? Math.round(h1.getBoundingClientRect().width) : 0,
      h1Centered: h1
        ? Math.abs(
            h1.getBoundingClientRect().left +
              h1.getBoundingClientRect().width / 2 -
              window.innerWidth / 2,
          ) < 4
        : false,
      headerBottomBorder: header
        ? getComputedStyle(header).borderBottomWidth
        : null,
      sections: document.querySelectorAll('main > section').length,
      logos: document.querySelectorAll('header svg').length,
      footer: !!document.querySelector('footer'),
      ctaLinks: [...document.querySelectorAll('a[href="/login"]')].length,
      pageHeight: document.body.scrollHeight,
    };
  });

  check('home renders no client errors', errors, []);
  check('hero is a real display size, not body text', home.h1Size, '48px');
  check('hero is semibold', home.h1Weight, '600');
  check('hero is centred', home.h1Centered, true);
  check('hero spans the container, not the full 1440', home.h1Width > 600 && home.h1Width < 1300, true);
  check('header has a rule under it', home.headerBottomBorder, '1px');
  check('four sections of content', home.sections, 4);
  check('logo is in the header', home.logos >= 1, true);
  check('footer exists', home.footer, true);
  check('two sign-in CTAs', home.ctaLinks, 3);
  check('page is taller than one screen', home.pageHeight > 1400, true);
  await page.close();
}

// --- login: split layout at desktop, single column below lg ------------------
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${WEB}/login`);
  await page.waitForLoadState('networkidle');

  const wide = await page.evaluate(() => {
    const aside = document.querySelector('aside');
    const form = document.querySelector('form');
    return {
      asideVisible: aside ? aside.getBoundingClientRect().width > 0 : false,
      asideWidth: aside ? Math.round(aside.getBoundingClientRect().width) : 0,
      asideBg: aside ? getComputedStyle(aside).backgroundColor : null,
      asideLeft: aside ? Math.round(aside.getBoundingClientRect().left) : null,
      formLeft: form ? Math.round(form.getBoundingClientRect().left) : 0,
      // Count only rendered logos — the mobile mark stays in the DOM at every
      // width and is merely hidden by lg:hidden.
      visibleLogos: [...document.querySelectorAll('svg')].filter(
        (s) => s.getBoundingClientRect().width > 0,
      ).length,
    };
  });
  check('brand panel shows at desktop', wide.asideVisible, true);
  check('brand panel is the left half', wide.asideLeft, 0);
  // Tailwind v4 emits oklch, not rgb — compare the channel, not the notation.
  check('brand panel is dark', wide.asideBg, 'oklch(0.208 0.042 265.755)');
  check('form sits right of the split', wide.formLeft > 600, true);
  check('exactly one logo is rendered at desktop', wide.visibleLogos, 1);

  await page.setViewportSize({ width: 500, height: 900 });
  await page.goto(`${WEB}/login`);
  await page.waitForLoadState('networkidle');
  const narrow = await page.evaluate(() => {
    const aside = document.querySelector('aside');
    return {
      asideWidth: aside ? Math.round(aside.getBoundingClientRect().width) : -1,
      logoVisible: !!document.querySelector('main svg'),
      submitWidth: Math.round(
        document.querySelector('button[type="submit"]').getBoundingClientRect().width,
      ),
    };
  });
  check('brand panel hides below lg', narrow.asideWidth, 0);
  check('logo still present on mobile', narrow.logoVisible, true);
  check('submit is full width on mobile', narrow.submitWidth > 300, true);
  await page.close();
}

await browser.close();
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
