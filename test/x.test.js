// Tests for src/sites/x.js and src/core.js.
//
// Each test loads the extension into Chromium, serves sample posts at
// https://x.com, and checks which posts the extension highlights.
//
// Run: npm install, then npx playwright install chromium, then npm test.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

const EXTENSION = path.join(__dirname, '..');
const YELLOW = 'rgb(255, 229, 0)';
const DARK = 'rgb(15, 20, 25)';
const LIGHT = 'rgb(231, 233, 234)';
const WHITE = 'rgb(255, 255, 255)';

// One sample post, built like a post on X.
//   time        The post shows a timestamp of its own.
//   label       Text placed where X puts its ad label, or null for none.
//   labelPlace  'author-line' (beside the author's name) or 'bottom'.
//   labelStyle  CSS for the label, to hide it.
//   author      The author's display name.
//   userName    false to leave out the author block's data-testid.
//   style       CSS for the post itself.
//   extra       More HTML inside the post: media, a quoted post, a card.
function post(id, options = {}) {
  const {
    time = true,
    label = null,
    labelPlace = 'author-line',
    labelStyle = '',
    author = 'Author',
    userName = true,
    style = '',
    body = 'Hello',
    extra = '',
  } = options;
  const timeHtml = time ? '<a href="/author/status/1" role="link"><time datetime="2026-11-23T00:00:00Z">1h</time></a>' : '';
  const labelHtml = label === null ? '' : `<div><div dir="ltr"><span style="${labelStyle}">${label}</span></div></div>`;
  return `
    <article data-testid="tweet" id="${id}" style="${style}">
      <div class="header">
        <div ${userName ? 'data-testid="User-Name"' : ''} class="name"><a href="/author"><span>${author}</span></a><span>@author</span>${timeHtml}</div>
        ${labelPlace === 'author-line' ? labelHtml : ''}
        <span class="slot">Hi</span>
        <button data-testid="caret">More</button>
      </div>
      <div data-testid="tweetText" lang="en"><span>${body}</span> <a href="https://example.com">example.com</a></div>
      ${extra}
      ${labelPlace === 'bottom' ? labelHtml : ''}
    </article>`;
}

// Text drawn on a photo or video, with no background of its own.
const overlay = (testid, id) => `<div data-testid="${testid}"><div id="${id}" style="color:${WHITE}">Watch now</div></div>`;

// Parts of a link card. The bar is the last part inside the card, so the
// parts after the card only get checked if the scan climbs back out of it.
const cardParts = `
  <div data-testid="card.wrapper"><div id="card-bar" role="link" style="background:rgb(0, 0, 0);color:${WHITE}">Shop now</div></div>
  <div id="image-label" style="background:rgba(0, 0, 0, 0.77);color:${WHITE}">example.com</div>
  <div id="faint-tint" style="background:rgba(255, 255, 255, 0.1);color:${LIGHT}">Tinted</div>
  <div id="p3-solid" style="background:color(display-p3 0 0 0);color:${WHITE}">Solid</div>
  <div id="p3-faint" style="background:color(display-p3 0 0 0 / 0.2);color:${LIGHT}">Faint</div>`;

const quotedPost = '<div role="link"><div data-testid="User-Name"><span>Other</span><time>2h</time></div><div lang="en">Quoted text</div></div>';

// The sample feed. Ids that start with "ad" are ads; all others are not.
const FEED = [
  post('normal'),
  post('ad', { time: false, label: 'Ad', extra: overlay('videoPlayer', 'video-overlay') }),
  post('ad-with-photo', { time: false, label: 'Ad', extra: overlay('tweetPhoto', 'photo-overlay') }),
  post('ad-with-card', { time: false, label: 'Ad', extra: cardParts }),
  post('ad-with-time', { label: 'Ad', style: 'background-color: rgb(0, 0, 0)' }), // check 1 alone
  post('ad-label-at-bottom', { time: false, label: 'Promoted', labelPlace: 'bottom' }), // check 2 alone
  post('ad-quoting-a-post', { time: false, label: 'Ad', labelPlace: 'bottom', extra: quotedPost }),
  post('ad-to-normal', { time: false, label: 'Ad', extra: overlay('tweetPhoto', 'reused-overlay') }),
  post('normal-label-at-bottom', { label: 'Ad', labelPlace: 'bottom' }),
  post('normal-author-named-ad', { author: 'Ad' }),
  post('normal-ads-on-author-line', { label: 'Ads' }),
  post('normal-no-user-name', { label: 'Ad', userName: false }),
  post('normal-quote-name-beside-label', {
    userName: false,
    extra: `<div style="display:flex"><div role="link"><div data-testid="User-Name"><span>Other</span><time>2h</time></div></div><div dir="ltr"><span>Ad</span></div></div>`,
  }),
  post('normal-hidden-label', { label: 'Ad', labelStyle: 'display:none' }),
  post('normal-text-becomes-ad'),
  // Posts with no timestamp, so check 2 agrees. Each holds the word "Ad"
  // only in a place where it is part of the post, so none of them is an ad.
  // Each place matches one entry of NOT_A_LABEL in src/sites/x.js.
  post('normal-ad-in-text', { time: false, extra: '<div lang="en"><span>Ad</span></div>' }),
  post('normal-ad-in-post-text', { time: false, extra: '<div data-testid="tweetText"><span>Ad</span></div>' }),
  post('normal-ad-in-link', { time: false, extra: '<a href="/ad">Ad</a>' }),
  post('normal-ad-in-other-link', { time: false, extra: '<span role="link">Ad</span>' }),
  post('normal-ad-in-name', { time: false, extra: '<div data-testid="User-Name"><span>Ad</span></div>' }),
  post('normal-ad-in-quote', { time: false, extra: '<div role="link"><span>Ad</span></div>' }),
  post('normal-ad-in-card', { time: false, extra: '<div data-testid="card.wrapper"><span>Ad</span></div>' }),
  post('normal-ad-in-video', { time: false, extra: '<div data-testid="videoPlayer"><span>Ad</span></div>' }),
  post('normal-ad-in-video-component', { time: false, extra: '<div data-testid="videoComponent"><span>Ad</span></div>' }),
  post('normal-ad-in-photo', { time: false, extra: '<div data-testid="tweetPhoto"><span>Ad</span></div>' }),
  post('normal-ad-in-inner-post', { time: false, extra: '<article id="inner-post"><span>Ad</span></article>' }),
  post('normal-ad-starts-word', { time: false, extra: '<div>Ad<span>vertising</span></div>' }),
].join('');

const page = (feed) => `<!doctype html>
<html lang="en">
<head><style>
  body { background: #000; color: ${LIGHT}; font: 15px sans-serif; margin: 0 }
  main { padding-bottom: 100vh }
  article { display: block; padding: 12px; border-bottom: 1px solid #333 }
  .header { display: flex; gap: 8px; align-items: center }
  .name { display: flex; gap: 4px }
  a { color: rgb(29, 155, 240); text-decoration: none }
  button { background: none; border: 0; color: inherit; font: inherit }
</style></head>
<body><main id="feed">${feed}</main></body>
</html>`;

let context;
let tab;
const errors = [];

before(async () => {
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  });
  await context.route('https://x.com/home', (route) => route.fulfill({ contentType: 'text/html', body: page(FEED) }));
  // A page where no post shows a timestamp of its own. Only posts inside
  // other posts show one.
  await context.route('https://x.com/no-timestamps', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: page(
        post('ad-no-time-anywhere', { time: false, label: 'Ad' }) +
          post('normal-no-time-anywhere', { time: false, label: 'Ad', labelPlace: 'bottom' }) +
          post('normal-only-quote-has-time', { time: false, label: 'Ad', labelPlace: 'bottom', extra: quotedPost }) +
          post('normal-only-inner-article-has-time', { time: false, label: 'Ad', labelPlace: 'bottom', extra: '<article><time>3h</time></article>' }),
      ),
    }),
  );
  await context.route('https://example.com/', (route) =>
    route.fulfill({ contentType: 'text/html', body: page('<article id="a">A</article><article id="b">B</article>') }),
  );
  tab = await context.newPage();
  tab.on('pageerror', (error) => errors.push(String(error)));
  tab.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await tab.goto('https://x.com/home');
  await tab.waitForSelector('#ad[data-ad-highlighter]');
});

after(async () => {
  await context?.close();
});

// The ids of the marked posts on the page.
const markedIds = () =>
  tab.evaluate(() => [...document.querySelectorAll('[data-ad-highlighter]')].map((element) => element.id).sort());

const isMarked = (id) => tab.evaluate((i) => document.getElementById(i).hasAttribute('data-ad-highlighter'), id);

// Wait for one more scan: add an ad and wait until it is marked, then
// remove it. Use this before checking that something stayed unmarked.
async function waitForScan() {
  await tab.evaluate((html) => document.getElementById('feed').insertAdjacentHTML('beforeend', html), post('probe', { time: false, label: 'Ad' }));
  await tab.waitForSelector('#probe[data-ad-highlighter]');
  await tab.evaluate(() => document.getElementById('probe').remove());
}

const color = (selector, property = 'color') =>
  tab.evaluate(([s, p]) => getComputedStyle(document.querySelector(s))[p], [selector, property]);

// Load src/core.js on a plain page, then call run with that page and the
// list of console errors it shows.
async function withCore(run) {
  const other = await context.newPage();
  const consoleErrors = [];
  other.on('console', (message) => message.type() === 'error' && consoleErrors.push(message.text()));
  await other.goto('https://example.com/');
  await other.addScriptTag({ path: path.join(EXTENSION, 'src/core.js') });
  await other.evaluate(() => {
    window.nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    window.marked = () => [...document.querySelectorAll('[data-ad-highlighter]')].map((element) => element.id);
  });
  try {
    return await run(other, consoleErrors);
  } finally {
    await other.close();
  }
}

test('marks every ad and only the ads', async () => {
  const ads = await tab.evaluate(() => [...document.querySelectorAll('article[id^="ad"]')].map((a) => a.id).sort());
  assert.deepEqual(await markedIds(), ads);
  // No part of a normal post gets a mark of any kind.
  assert.equal(await tab.evaluate(() => document.querySelector('article[id^="normal"] [data-ad-highlighter-keep-colors]')), null);
});

test('paints an ad yellow with dark text and underlined links', async () => {
  assert.equal(await color('#ad', 'backgroundColor'), YELLOW);
  assert.equal(await color('#ad [lang] span'), DARK);
  assert.equal(await color('#ad .name span'), DARK);
  assert.equal(await color('#ad [lang] a', 'textDecorationLine'), 'underline');
});

test('paints an ad yellow even when the site gives the post its own background', async () => {
  assert.equal(await color('#ad-with-time', 'backgroundColor'), YELLOW);
});

test('keeps the site colors on text drawn on a photo or video', async () => {
  assert.equal(await color('#video-overlay'), WHITE);
  assert.equal(await color('#photo-overlay'), WHITE);
});

test('keeps the site colors on a part with a background that is at least half opaque', async () => {
  assert.equal(await color('#card-bar'), WHITE);
  assert.equal(await color('#image-label'), WHITE);
  assert.equal(await color('#p3-solid'), WHITE);
  assert.equal(await color('#faint-tint'), DARK);
  assert.equal(await color('#p3-faint'), DARK);
});

test('drops the site colors from a part that loses its own background', async () => {
  await tab.evaluate(() => { document.getElementById('card-bar').style.background = 'none'; });
  await waitForScan();
  assert.equal(await color('#card-bar'), DARK);
});

test('leaves a normal post exactly as it was', async () => {
  assert.equal(await color('#normal', 'backgroundColor'), 'rgba(0, 0, 0, 0)');
  assert.equal(await color('#normal [lang] span'), LIGHT);
  assert.equal(await color('#normal [lang] a', 'textDecorationLine'), 'none');
  assert.equal(await tab.evaluate(() => document.querySelector('#normal [data-ad-highlighter]')), null);
});

test('marks an ad that appears later', async () => {
  await tab.evaluate((html) => document.getElementById('feed').insertAdjacentHTML('beforeend', html), post('ad-late', { time: false, label: 'Ad' }));
  await tab.waitForSelector('#ad-late[data-ad-highlighter]');
});

test('unmarks a post, and every part of it, when the site reuses an ad element for a normal post', async () => {
  assert.equal(await isMarked('ad-to-normal'), true);
  await tab.evaluate(() => {
    const element = document.getElementById('ad-to-normal');
    element.querySelector('[dir="ltr"]').remove();
    element.querySelector('[data-testid="User-Name"]').insertAdjacentHTML('beforeend', '<a href="/author/status/2"><time>2h</time></a>');
  });
  await tab.waitForSelector('#ad-to-normal:not([data-ad-highlighter])');
  assert.equal(await tab.evaluate(() => document.querySelector('#ad-to-normal [data-ad-highlighter-keep-colors]')), null);
});

test('reacts when only the text of a post changes', async () => {
  const setSlot = (text) => tab.evaluate((t) => { document.querySelector('#normal-text-becomes-ad .slot').firstChild.nodeValue = t; }, text);
  await setSlot('Ad');
  await tab.waitForSelector('#normal-text-becomes-ad[data-ad-highlighter]');
  await setSlot('Hi');
  await tab.waitForSelector('#normal-text-becomes-ad:not([data-ad-highlighter])');
});

test('drops the site colors from a part that is no longer a photo or video', async () => {
  await tab.evaluate(() => document.querySelector('#ad [data-testid="videoPlayer"]').removeAttribute('data-testid'));
  await waitForScan();
  assert.equal(await color('#video-overlay'), DARK);
});

test('ignores a hidden label, even when the author line crosses the top of the window', async () => {
  const box = await tab.evaluate(() => {
    const name = document.querySelector('#normal-hidden-label [data-testid="User-Name"]');
    window.scrollBy(0, name.getBoundingClientRect().top + 4);
    const { top, bottom } = name.getBoundingClientRect();
    return { top, bottom };
  });
  // The test only means something when the author line crosses the top.
  assert.ok(box.top < 0 && box.bottom > 0, `author line at ${box.top} to ${box.bottom}`);
  await waitForScan();
  assert.equal(await isMarked('normal-hidden-label'), false);
});

test('uses the no-timestamp check only when some post shows a timestamp of its own', async () => {
  const other = await context.newPage();
  await other.goto('https://x.com/no-timestamps');
  // Check 1 still finds the ad whose label is on the author line.
  await other.waitForSelector('#ad-no-time-anywhere[data-ad-highlighter]');
  const marked = await other.evaluate(() => [...document.querySelectorAll('[data-ad-highlighter]')].map((element) => element.id));
  assert.deepEqual(marked, ['ad-no-time-anywhere']);
  await other.close();
});

test('the page shows no errors', () => {
  assert.deepEqual(errors, []);
});

test('core: only a result of exactly true counts as an ad', async () => {
  const marked = await withCore((other) =>
    other.evaluate(async () => {
      adHighlighter.watch({ posts: () => [...document.querySelectorAll('article')], isAd: (post) => (post.id === 'a' ? undefined : post) });
      const seen = [];
      for (let i = 0; i < 4; i++) {
        document.body.append(document.createElement('div'));
        await nextFrame();
        seen.push(marked().length);
      }
      return seen;
    }),
  );
  assert.deepEqual(marked, [0, 0, 0, 0]);
});

test('core: accepts posts as a NodeList', async () => {
  const marked = await withCore((other) =>
    other.evaluate(async () => {
      adHighlighter.watch({ posts: () => document.querySelectorAll('article'), isAd: (post) => post.id === 'a' });
      await nextFrame();
      return marked();
    }),
  );
  assert.deepEqual(marked, ['a']);
});

test('core: an error in one post does not stop the scan, and shows once', async () => {
  const [result, consoleErrors] = await withCore(async (other, consoleErrors) => [
    await other.evaluate(async () => {
      window.aIsAd = true;
      adHighlighter.watch({
        posts: () => [...document.querySelectorAll('article')],
        isAd(post) {
          if (post.id === 'b') throw new Error('broken site file');
          return window.aIsAd;
        },
      });
      await nextFrame();
      const first = marked();
      window.aIsAd = false;
      document.body.append(document.createElement('div'));
      await nextFrame();
      document.body.append(document.createElement('div'));
      await nextFrame();
      return { first, later: marked() };
    }),
    consoleErrors,
  ]);
  assert.deepEqual(result, { first: ['a'], later: [] });
  assert.equal(consoleErrors.length, 1);
  assert.match(consoleErrors[0], /broken site file/);
});

test('core: unmarks an element that is no longer one of the posts', async () => {
  const marked = await withCore((other) =>
    other.evaluate(async () => {
      window.postSelector = 'article';
      adHighlighter.watch({ posts: () => [...document.querySelectorAll(window.postSelector)], isAd: () => true });
      await nextFrame();
      const first = marked();
      window.postSelector = '#b';
      document.body.append(document.createElement('div'));
      await nextFrame();
      return { first, later: marked() };
    }),
  );
  assert.deepEqual(marked, { first: ['a', 'b'], later: ['b'] });
});

test('core: scans at most once per frame', async () => {
  const scans = await withCore((other) =>
    other.evaluate(async () => {
      let count = 0;
      adHighlighter.watch({ posts: () => { count += 1; return []; }, isAd: () => false });
      await nextFrame();
      const start = count;
      // Wait after each change, so the page reports each change on its own.
      for (let i = 0; i < 10; i++) {
        document.body.append(document.createElement('div'));
        await null;
      }
      const sameFrame = count - start;
      await nextFrame();
      return { sameFrame, total: count - start };
    }),
  );
  // No scan runs at the time of a change, and one runs in the next frame.
  assert.deepEqual(scans, { sameFrame: 0, total: 1 });
});
