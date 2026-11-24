// Tests for src/sites/x.js and the CSS files.
//
// The suite loads the extension into Chromium once and serves sample posts
// at https://x.com. The tests share one page and run in the order of this
// file, so a test that changes a post uses a post of its own.
// test/core.test.js tests src/core.js on its own.
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

// The pages the tests open. Any other request comes from the extension.
const PAGES = ['https://x.com/home', 'https://x.com/no-timestamps'];

// One sample post, built like a post on X.
//   time        The post shows a timestamp of its own.
//   label       Text placed where X puts its ad label, or null for none.
//   labelPlace  'author-line' (beside the author's name), 'top' (on a line
//               above it) or 'bottom'.
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
    extra = '',
  } = options;
  const timeHtml = time ? '<a href="/author/status/1" role="link"><time datetime="2026-11-23T00:00:00Z">1h</time></a>' : '';
  const labelHtml = label === null ? '' : `<div><div dir="ltr"><span style="${labelStyle}">${label}</span></div></div>`;
  return `
    <article data-testid="tweet" id="${id}" style="${style}">
      ${labelPlace === 'top' ? labelHtml : ''}
      <div class="header">
        <div ${userName ? 'data-testid="User-Name"' : ''} class="name"><a href="/author"><span>${author}</span></a><span>@author</span>${timeHtml}</div>
        ${labelPlace === 'author-line' ? labelHtml : ''}
        <span class="slot">Hi</span>
        <button data-testid="caret">More</button>
      </div>
      <div data-testid="tweetText" lang="en"><span>Hello</span> <a href="https://example.com" style="text-decoration:none">example.com</a></div>
      ${extra}
      ${labelPlace === 'bottom' ? labelHtml : ''}
    </article>`;
}

// Text drawn on a photo or video, with no background of its own.
const overlay = (testid, id) => `<div data-testid="${testid}"><div id="${id}" style="color:${WHITE}">Watch now</div></div>`;

// A part with a background of its own, such as the "Shop now" bar under a
// link card.
const bar = (id, background) => `<div id="${id}" style="background:${background};color:${WHITE}">Shop now</div>`;

// Parts of a link card, each with a background of a different opacity. The
// bar is the last part inside the card, so the parts after the card only get
// checked if the scan climbs back out of it.
const cardParts = `
  <div data-testid="card.wrapper">${bar('card-bar', 'rgb(0, 0, 0)')}</div>
  ${bar('image-label', 'rgba(0, 0, 0, 0.77)')}
  ${bar('half-tint', 'rgba(0, 0, 0, 0.5)')}
  ${bar('p3-solid', 'color(display-p3 0 0 0)')}
  <div id="faint-tint" style="background:rgba(255, 255, 255, 0.1);color:${LIGHT}">Tinted</div>
  <div id="p3-faint" style="background:color(display-p3 0 0 0 / 0.2);color:${LIGHT}">Faint</div>`;

const quotedPost = '<div role="link"><div data-testid="User-Name"><span>Other</span><time>2h</time></div><div lang="en">Quoted text</div></div>';

// The sample feed. Ids that start with "ad" are ads; all others are not.
const FEED = [
  post('normal'),
  post('ad', { time: false, label: 'Ad', extra: overlay('videoPlayer', 'video-overlay') }),
  post('ad-with-photo', { time: false, label: 'Ad', extra: overlay('tweetPhoto', 'photo-overlay') }),
  post('ad-with-card', { time: false, label: 'Ad', extra: cardParts }),
  post('ad-with-time', { label: 'Ad', style: 'background-color: rgb(0, 0, 0)' }), // check 1 alone
  post('ad-label-at-bottom', { time: false, label: '\n  Promoted\n', labelPlace: 'bottom' }), // check 2 alone
  post('ad-quoting-a-post', { time: false, label: 'Ad', labelPlace: 'bottom', extra: quotedPost }),
  post('ad-to-normal', { time: false, label: 'Ad', extra: overlay('tweetPhoto', 'reused-overlay') }),
  post('ad-loses-colors', { time: false, label: 'Ad', extra: overlay('videoPlayer', 'lost-overlay') + bar('lost-bar', 'rgb(0, 0, 0)') }),
  post('normal-label-at-bottom', { label: 'Ad', labelPlace: 'bottom' }),
  post('normal-label-above-author', { label: 'Ad', labelPlace: 'top' }),
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
  // only where it is part of the post, so none of them is an ad. Each of
  // these places matches exactly one entry of NOT_A_LABEL in src/sites/x.js.
  post('normal-ad-in-text', { time: false, extra: '<div lang="en"><span>Ad</span></div>' }),
  post('normal-ad-in-post-text', { time: false, extra: '<div data-testid="tweetText"><span>Ad</span></div>' }),
  post('normal-ad-in-link', { time: false, extra: '<a href="/ad">Ad</a>' }),
  post('normal-ad-in-other-link', { time: false, extra: '<span role="link">Ad</span>' }),
  post('normal-ad-in-name', { time: false, extra: '<div data-testid="User-Name"><span>Ad</span></div>' }),
  post('normal-ad-in-card', { time: false, extra: '<div data-testid="card.wrapper"><span>Ad</span></div>' }),
  post('normal-ad-in-video', { time: false, extra: '<div data-testid="videoPlayer"><span>Ad</span></div>' }),
  post('normal-ad-in-video-component', { time: false, extra: '<div data-testid="videoComponent"><span>Ad</span></div>' }),
  post('normal-ad-in-photo', { time: false, extra: '<div data-testid="tweetPhoto"><span>Ad</span></div>' }),
  post('normal-ad-in-inner-post', { time: false, extra: '<article id="inner-post"><span>Ad</span></article>' }),
  // A quoted post on X, which two entries of NOT_A_LABEL cover.
  post('normal-ad-in-quote', { time: false, extra: '<div role="link"><span>Ad</span></div>' }),
  // The label must be the whole text of its element.
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
const requests = [];

before(async () => {
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  });
  context.on('request', (request) => requests.push(request.url()));
  // Keep the tests off the real network. Routes added later win.
  await context.route('**', (route) => route.abort());
  await context.route('https://x.com/home', (route) => route.fulfill({ contentType: 'text/html', body: page(FEED) }));
  // A page where no post shows a timestamp of its own. Only posts inside
  // other posts, and parts of the page outside every post, show one.
  await context.route('https://x.com/no-timestamps', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: page(
        '<aside><div role="link"><time>5m</time></div><time>6m</time></aside>' +
          post('ad-no-time-anywhere', { time: false, label: 'Ad' }) +
          post('normal-no-time-anywhere', { time: false, label: 'Ad', labelPlace: 'bottom' }) +
          post('normal-only-quote-has-time', { time: false, label: 'Ad', labelPlace: 'bottom', extra: quotedPost }) +
          post('normal-only-inner-article-has-time', { time: false, label: 'Ad', labelPlace: 'bottom', extra: '<article><time>3h</time></article>' }),
      ),
    }),
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

// The ids of the marked posts on a page.
const markedIds = (page = tab) =>
  page.evaluate(() => [...document.querySelectorAll('[data-ad-highlighter]')].map((element) => element.id).sort());

const isMarked = (id) => tab.evaluate((i) => document.getElementById(i).hasAttribute('data-ad-highlighter'), id);

const addPost = (html) => tab.evaluate((h) => document.getElementById('feed').insertAdjacentHTML('beforeend', h), html);

// A computed style property of the first element that matches selector.
const computed = (selector, property = 'color') =>
  tab.evaluate(([s, p]) => getComputedStyle(document.querySelector(s))[p], [selector, property]);

// Wait for one more scan: add an ad and wait until it is marked, then
// remove it. Use this before checking that something stayed unmarked. It
// works only while new ads get marked, which the test 'marks an ad that
// appears later' checks first.
async function waitForScan() {
  await addPost(post('probe', { time: false, label: 'Ad' }));
  await tab.waitForSelector('#probe[data-ad-highlighter]');
  await tab.evaluate(() => document.getElementById('probe').remove());
}

test('marks every ad and only the ads', async () => {
  const ads = await tab.evaluate(() => [...document.querySelectorAll('article[id^="ad"]')].map((a) => a.id).sort());
  assert.deepEqual(await markedIds(), ads);
  // No part of a normal post gets a mark of any kind.
  assert.equal(
    await tab.evaluate(() =>
      document.querySelector(
        'article[id^="normal"] :is([data-ad-highlighter], [data-ad-highlighter-keep-colors], [data-ad-highlighter-full-width], [data-ad-highlighter-around-kept])',
      ),
    ),
    null,
  );
});

test('paints an ad yellow with dark text and underlined links', async () => {
  // This ad has a black background of its own, so the yellow must win.
  assert.equal(await computed('#ad-with-time', 'backgroundColor'), YELLOW);
  assert.equal(await computed('#ad [lang] span'), DARK);
  assert.equal(await computed('#ad .name span'), DARK);
  // The link in the text has text-decoration:none of its own. The author's
  // name is a link too, but it is not in the post's text.
  assert.equal(await computed('#ad [lang] a', 'textDecorationLine'), 'underline');
  assert.equal(await computed('#ad .name a', 'textDecorationLine'), 'none');
});

test('keeps the site colors on text drawn on a photo or video', async () => {
  assert.equal(await computed('#video-overlay'), WHITE);
  assert.equal(await computed('#photo-overlay'), WHITE);
});

test('keeps the site colors on a part with a background that is at least half opaque', async () => {
  assert.equal(await computed('#card-bar'), WHITE);
  assert.equal(await computed('#image-label'), WHITE);
  assert.equal(await computed('#half-tint'), WHITE);
  assert.equal(await computed('#p3-solid'), WHITE);
  assert.equal(await computed('#faint-tint'), DARK);
  assert.equal(await computed('#p3-faint'), DARK);
});

test('leaves a normal post exactly as it was', async () => {
  assert.equal(await computed('#normal', 'backgroundColor'), 'rgba(0, 0, 0, 0)');
  assert.equal(await computed('#normal [lang] span'), LIGHT);
  assert.equal(await computed('#normal [lang] a', 'textDecorationLine'), 'none');
});

test('marks an ad that appears later', async () => {
  await addPost(post('ad-late', { time: false, label: 'Ad' }));
  await tab.waitForSelector('#ad-late[data-ad-highlighter]');
});

test('drops the site colors from a part that no longer keeps them', async () => {
  assert.equal(await computed('#lost-overlay'), WHITE);
  assert.equal(await computed('#lost-bar'), WHITE);
  await tab.evaluate(() => {
    document.querySelector('#ad-loses-colors [data-testid="videoPlayer"]').removeAttribute('data-testid');
    document.getElementById('lost-bar').style.background = 'none';
  });
  await waitForScan();
  assert.equal(await computed('#lost-overlay'), DARK);
  assert.equal(await computed('#lost-bar'), DARK);
});

test('unmarks a post, and every part of it, when the site reuses an ad element for a normal post', async () => {
  assert.equal(await isMarked('ad-to-normal'), true);
  assert.equal(await computed('#reused-overlay'), WHITE);
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

test('uses check 2 only when some post shows a timestamp of its own', async () => {
  const other = await context.newPage();
  try {
    await other.goto('https://x.com/no-timestamps');
    // Check 1 still finds the ad whose label is on the author line.
    await other.waitForSelector('#ad-no-time-anywhere[data-ad-highlighter]');
    assert.deepEqual(await markedIds(other), ['ad-no-time-anywhere']);
  } finally {
    await other.close();
  }
});

test('the page shows no errors', () => {
  assert.deepEqual(errors, []);
});

test('makes no network requests', () => {
  assert.deepEqual(requests.filter((url) => !PAGES.includes(url)), []);
});
