// Tests for the highlight color setting with the real extension loaded: the
// popup (src/popup/), and the color it saves on an open X page
// (src/page-color.js and src/highlight.css).
//
// The tests share one X tab and one popup tab, and run in the order of this
// file. Each test starts from the color the one before it left.
//
// Run: npm install, then npx playwright install chromium, then npm test.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const EXTENSION = fs.realpathSync(path.join(__dirname, '..'));
// Chrome names an unpacked extension after a hash of its folder's path.
const ID = [...crypto.createHash('sha256').update(EXTENSION).digest('hex').slice(0, 32)]
  .map((digit) => String.fromCharCode(97 + parseInt(digit, 16)))
  .join('');
const POPUP = `chrome-extension://${ID}/src/popup/popup.html`;
const PAGE = 'https://x.com/home';

const YELLOW = 'rgb(255, 229, 0)';
const DARK = 'rgb(15, 20, 25)';
const WHITE = 'rgb(255, 255, 255)';
const LIGHT = 'rgb(231, 233, 234)';

// An ad on X, with the label "Ad" on the author's line and no timestamp.
// Its last part has a background of its own and is as wide as the ad. And
// a normal post, with a timestamp and no label.
const FEED = `
  <article data-testid="tweet" id="ad">
    <div class="header">
      <div data-testid="User-Name"><a href="/author"><span>Author</span></a><span>@author</span></div>
      <div><div dir="ltr"><span>Ad</span></div></div>
    </div>
    <div data-testid="tweetText" lang="en"><span id="ad-text">Hello</span></div>
    <div id="wide" style="background: rgb(0, 0, 0)">Shop now</div>
  </article>
  <article data-testid="tweet" id="normal">
    <div class="header">
      <div data-testid="User-Name"><a href="/author"><span>Author</span></a><span>@author</span><a href="/author/status/1"><time datetime="2026-11-23T00:00:00Z">1h</time></a></div>
    </div>
    <div data-testid="tweetText" lang="en"><span id="normal-text">Hello</span></div>
  </article>`;

const HTML = `<!doctype html>
<html lang="en">
<head><style>
  body { background: #000; color: ${LIGHT}; font: 15px sans-serif; margin: 0 }
  article { display: block; border-bottom: 1px solid #333 }
  .header { display: flex; gap: 8px }
  a { color: rgb(29, 155, 240); text-decoration: none }
</style></head>
<body><main>${FEED}</main></body>
</html>`;

let context;
let tab;
let popup;
const requests = [];
const errors = [];

before(async () => {
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  });
  context.on('request', (request) => requests.push(request.url()));
  // Keep the tests off the real network. The popup's own files come from
  // the extension, so they still load. Routes added later win.
  await context.route(/^https?:/, (route) => route.abort());
  await context.route(PAGE, (route) => route.fulfill({ contentType: 'text/html', body: HTML }));
  tab = await context.newPage();
  tab.on('pageerror', (error) => errors.push(error.message));
  await tab.goto(PAGE);
  await tab.waitForSelector('#ad[data-ad-highlighter]');
  popup = await context.newPage();
  popup.on('pageerror', (error) => errors.push(error.message));
  popup.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await popup.goto(POPUP);
  await popup.waitForSelector('.swatch');
});

after(async () => {
  await context?.close();
});

// The colors the X tab shows on the ad and on the normal post.
function colors() {
  return tab.evaluate(() => {
    const style = (id) => getComputedStyle(document.getElementById(id));
    return {
      ad: style('ad').backgroundColor,
      adText: style('ad-text').color,
      wide: style('wide').backgroundImage,
      wideText: style('wide').color,
      normal: style('normal').backgroundColor,
      normalText: style('normal-text').color,
    };
  });
}

// What the X tab must show with the highlight color background (in the
// form "rgb(r, g, b)") and the text color text.
function expected(background, text) {
  return {
    ad: background,
    adText: text,
    wide: `linear-gradient(${background}, ${background})`,
    wideText: text,
    normal: 'rgba(0, 0, 0, 0)',
    normalText: LIGHT,
  };
}

// Wait until the ad on the X tab has the background color background.
function waitForAd(background) {
  return tab.waitForFunction(
    (wanted) => getComputedStyle(document.getElementById('ad')).backgroundColor === wanted,
    background,
    { timeout: 5000 },
  );
}

// What the popup shows.
function popupState() {
  return popup.evaluate(() => {
    const preview = getComputedStyle(document.getElementById('preview'));
    return {
      hex: document.getElementById('hex').value,
      sliders: ['hue', 'saturation', 'lightness'].map((id) => Number(document.getElementById(id).value)),
      pressed: [...document.querySelectorAll('.swatch[aria-pressed="true"]')].map((swatch) => swatch.getAttribute('aria-label')),
      note: document.getElementById('text-note').textContent,
      preview: [preview.backgroundColor, preview.color],
    };
  });
}

function saved() {
  return popup.evaluate(async () => (await chrome.storage.local.get('highlightColor')).highlightColor);
}

test('before a color is picked, ads are yellow with dark text, and the popup shows yellow', async () => {
  assert.deepEqual(await colors(), expected(YELLOW, DARK));
  assert.deepEqual(await popupState(), {
    hex: '#ffe500',
    sliders: [54, 100, 50],
    pressed: ['Yellow'],
    note: 'Ads get dark text on this color.',
    preview: [YELLOW, DARK],
  });
});

test('the popup offers colors to pick with one click, with yellow first', async () => {
  const swatches = await popup.$$eval('.swatch', (all) =>
    all.map((swatch) => [swatch.getAttribute('aria-label'), getComputedStyle(swatch).backgroundColor]),
  );
  assert.equal(swatches.length, 12);
  assert.deepEqual(swatches[0], ['Yellow', YELLOW]);
  for (const [name, background] of swatches) {
    assert.ok(name.length > 0);
    assert.match(background, /^rgb\(/);
  }
  assert.equal(new Set(swatches.map(([, background]) => background)).size, 12);
});

test('picking a deep color paints open ads that color with white text, at once', async () => {
  await popup.bringToFront();
  await popup.getByRole('button', { name: 'Blue', exact: true }).click();
  await waitForAd('rgb(29, 78, 216)');
  assert.deepEqual(await colors(), expected('rgb(29, 78, 216)', WHITE));
  assert.equal(await saved(), '#1d4ed8');
  const state = await popupState();
  assert.deepEqual(state.pressed, ['Blue']);
  assert.equal(state.hex, '#1d4ed8');
  assert.equal(state.note, 'Ads get white text on this color.');
  assert.deepEqual(state.preview, ['rgb(29, 78, 216)', WHITE]);
});

test('picking a bright color gives ads dark text', async () => {
  await popup.getByRole('button', { name: 'Mint' }).click();
  await waitForAd('rgb(94, 242, 176)');
  assert.deepEqual(await colors(), expected('rgb(94, 242, 176)', DARK));
  assert.equal((await popupState()).note, 'Ads get dark text on this color.');
});

test('a hex code picks any color: six digits at once, three when the person leaves the field', async () => {
  const field = popup.locator('#hex');
  await field.fill('123456');
  await waitForAd('rgb(18, 52, 86)');
  assert.deepEqual(await colors(), expected('rgb(18, 52, 86)', WHITE));
  assert.deepEqual((await popupState()).pressed, []);

  await field.fill('#ABC');
  // Three digits may be the start of six, so nothing changes yet.
  assert.equal(await saved(), '#123456');
  await field.press('Tab');
  await waitForAd('rgb(170, 187, 204)');
  assert.equal(await saved(), '#aabbcc');
  assert.equal((await popupState()).hex, '#aabbcc');
});

test('a code that is not a color is marked, and the color stays', async () => {
  const field = popup.locator('#hex');
  await field.fill('#zzz');
  await field.press('Tab');
  assert.equal(await field.getAttribute('aria-invalid'), 'true');
  assert.equal(await popup.locator('#hex-help').evaluate((help) => help.classList.contains('error')), true);
  assert.equal(await saved(), '#aabbcc');
  assert.equal((await colors()).ad, 'rgb(170, 187, 204)');

  await field.fill('#c62828');
  assert.equal(await field.getAttribute('aria-invalid'), 'false');
  await waitForAd('rgb(198, 40, 40)');
});

test('a slider changes the color, and the hex code follows', async () => {
  await popup.locator('#lightness').fill('30');
  const [hue, saturation] = (await popupState()).sliders;
  const code = await popup.evaluate(([h, s]) => adHighlighterColor.hslToHex(h, s, 30), [hue, saturation]);
  assert.equal(await saved(), code);
  assert.equal((await popupState()).hex, code);
  const rgb = `rgb(${[1, 3, 5].map((start) => parseInt(code.slice(start, start + 2), 16)).join(', ')})`;
  await waitForAd(rgb);
});

test('dragging a slider saves at most once a frame, and saves where it stops or when the popup closes', async () => {
  const result = await popup.evaluate(async () => {
    const writes = [];
    const set = chrome.storage.local.set.bind(chrome.storage.local);
    chrome.storage.local.set = (items) => {
      writes.push(items.highlightColor);
      return set(items);
    };
    const hue = document.getElementById('hue');
    // Many moves in one frame, as when a person drags the slider.
    for (const value of [10, 20, 30, 40, 50]) {
      hue.value = String(value);
      hue.dispatchEvent(new Event('input'));
    }
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    const afterFrame = [...writes];
    hue.value = '60';
    hue.dispatchEvent(new Event('change'));
    const afterChange = [...writes];
    // The popup closes while a move still waits for its frame.
    hue.value = '70';
    hue.dispatchEvent(new Event('input'));
    dispatchEvent(new Event('pagehide'));
    chrome.storage.local.set = set;
    const [, s, l] = ['hue', 'saturation', 'lightness'].map((id) => Number(document.getElementById(id).value));
    const at = (h) => adHighlighterColor.hslToHex(h, s, l);
    return { afterFrame, afterChange, all: writes, at50: at(50), at60: at(60), at70: at(70) };
  });
  assert.deepEqual(result.afterFrame, [result.at50]);
  assert.deepEqual(result.afterChange, [result.at50, result.at60]);
  assert.deepEqual(result.all, [result.at50, result.at60, result.at70]);
  await popup.waitForFunction((wanted) => chrome.storage.local.get('highlightColor').then((got) => got.highlightColor === wanted), result.at70);
});

test('the color stays after a reload, and the popup opens on it', async () => {
  await popup.getByRole('button', { name: 'Purple' }).click();
  await waitForAd('rgb(106, 27, 154)');
  await tab.reload();
  await tab.waitForSelector('#ad[data-ad-highlighter]');
  await waitForAd('rgb(106, 27, 154)');
  assert.deepEqual(await colors(), expected('rgb(106, 27, 154)', WHITE));
  await popup.reload();
  await popup.waitForFunction(() => document.getElementById('hex').value === '#6a1b9a');
  assert.deepEqual((await popupState()).pressed, ['Purple']);
});

test('the page keeps one style element for the color, however often it changes', async () => {
  for (const name of ['Coral', 'Lime', 'Red']) await popup.getByRole('button', { name }).click();
  await waitForAd('rgb(198, 40, 40)');
  const styles = await tab.evaluate(
    () => [...document.querySelectorAll('style')].filter((style) => style.textContent.includes('--ad-highlighter-color')).length,
  );
  assert.equal(styles, 1);
});

test('"Back to yellow" puts back the default', async () => {
  await popup.getByRole('button', { name: 'Back to yellow' }).click();
  await waitForAd(YELLOW);
  assert.deepEqual(await colors(), expected(YELLOW, DARK));
  assert.equal(await saved(), '#ffe500');
  assert.deepEqual((await popupState()).pressed, ['Yellow']);
});

test('a saved value that is not a color shows the default yellow, on the page and in the popup', async () => {
  await popup.evaluate(() => chrome.storage.local.set({ highlightColor: '#1d4ed8' }));
  await waitForAd('rgb(29, 78, 216)');
  await popup.evaluate(() => chrome.storage.local.set({ highlightColor: 'red; } body { display: none' }));
  await waitForAd(YELLOW);
  assert.deepEqual(await colors(), expected(YELLOW, DARK));
  assert.equal(await tab.evaluate(() => getComputedStyle(document.body).display), 'block');
  await popup.reload();
  await popup.waitForSelector('.swatch[aria-pressed="true"]');
  assert.equal((await popupState()).hex, '#ffe500');
});

test('the popup and the page make no network requests and show no errors', () => {
  const other = requests.filter((url) => url !== PAGE && !url.startsWith(`chrome-extension://${ID}/`));
  assert.deepEqual(other, []);
  // The popup's own files came from the extension, under the id above.
  assert.ok(requests.includes(`chrome-extension://${ID}/src/popup/popup.js`), requests.join('\n'));
  assert.deepEqual(errors, []);
});
