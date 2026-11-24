// Tests for src/sites/facebook.js.
//
// The suite loads the extension into Chromium once and serves sample posts
// at https://www.facebook.com. The tests share one page and run in the
// order of this file, so a test that changes a post uses a post of its own.
//
// Run: npm install, then npx playwright install chromium, then npm test.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

const EXTENSION = path.join(__dirname, '..');
const CORE = path.join(EXTENSION, 'src', 'core.js');
const FACEBOOK = path.join(EXTENSION, 'src', 'sites', 'facebook.js');
const PAGE_URL = 'https://www.facebook.com/';
// The same sample page at an address where the extension does not run.
const PLAIN_URL = 'https://example.com/';
const YELLOW = 'rgb(255, 229, 0)';
const DARK = 'rgb(15, 20, 25)';
const GRAY = 'rgb(240, 242, 245)';
const TEXT = 'rgb(5, 5, 5)';
const WHITE = 'rgb(255, 255, 255)';
// Facebook's colors in dark mode: text, the card, and the bar under a link.
const LIGHT = 'rgb(228, 230, 235)';
const DARK_CARD = 'rgb(36, 37, 38)';
const DARK_BAR = 'rgb(58, 59, 60)';
const BUTTON = 'rgb(226, 229, 233)';
const DARK_BUTTON = 'rgb(80, 82, 84)';
// The yellow layer that src/highlight.css paints over a full-width part.
const YELLOW_LAYER = `linear-gradient(${YELLOW}, ${YELLOW})`;

// Facebook keeps the words it draws in hidden elements at the end of the
// page, and points to them from SVG <use> elements and aria-labelledby. Each
// word here has a chain of two SVGs that leads to it, like Facebook's. The
// chain for "Sponsored" ends at a group around the <text>, and the others
// end at the <text> itself.
const WORDS = { ad: 'Ad', sponsored: 'Sponsored', time: '5 days ago', ads: 'Ads', dot: ' · ' };
const hiddenWords = `
  <div aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">
    ${Object.entries(WORDS)
      .map(
        ([key, word]) => `
          <svg id="word-${key}-1"><use xlink:href="#word-${key}-2"></use></svg>
          <svg id="word-${key}-2"><use href="#word-${key}-text"></use></svg>
          ${key === 'sponsored' ? `<svg><g id="word-${key}-text"><text y="0">${word}</text></g></svg>` : `<svg><text id="word-${key}-text" y="0">${word}</text></svg>`}`,
      )
      .join('')}
  </div>
  <div hidden>
    ${Object.entries(WORDS)
      .map(([key, word]) => `<span id="word-${key}-label">${word}</span>`)
      .join('')}
  </div>`;

// The forms the line under the author's name can take.
//   svgWord(key)     An SVG that draws a word through a chain of SVGs.
//   hiddenWord(key)  An empty icon with aria-labelledby that names a word.
const svgWord = (key) => `<a href="?story"><svg width="40" height="16"><use href="#word-${key}-1"></use></svg></a>`;
const hiddenWord = (key) => `<a href="?story"><span aria-labelledby="word-${key}-label"><svg width="40" height="16"></svg></span></a>`;

// One sample post, built like a post in Facebook's feed.
//   subtitle  HTML for the line under the author's name.
//   author    The author's name, or null for no name heading.
//   beside    HTML on the author's line, after the name.
//   above     HTML above the author's line.
//   text      HTML for the post's text.
//   extra     More HTML in the post, after its text.
//   wrapper   The attributes of the element around the post.
function post(id, options = {}) {
  const {
    subtitle = svgWord('time'),
    author = 'Author',
    beside = '',
    above = '',
    text = '<span>Hello</span>',
    extra = '',
    wrapper = 'data-virtualized="false"',
  } = options;
  return `
    <div ${wrapper} id="${id}">
      <div class="card">
        ${above}
        <div class="author-line">${author === null ? '' : `<h4><a href="/author"><span>${author}</span></a></h4>`}${beside}</div>
        <div class="subtitle">${subtitle}</div>
        <div dir="auto" class="text">${text}</div>
        ${extra}
      </div>
    </div>`;
}

// The bar under a link, with a button, as Facebook shows it under most ads.
const linkBar = '<div id="link-bar" class="bar"><span>EXAMPLE.COM</span><div role="button" id="shop-now" class="button">Shop now</div></div>';

// An author line long enough to take two lines.
const LONG_NAME = 'Author is with Example Brand and 12 others at Example Place in Example City, with a long list of friends';

// A label that a reader cannot see, in each way that CSS can hide it.
const INVISIBLE = {
  'normal-invisible-hidden': '<span style="visibility:hidden">Sponsored</span>',
  'normal-invisible-see-through': '<span style="opacity:0"><span>Sponsored</span></span>',
  'normal-invisible-tiny': '<span style="position:absolute;width:1px;height:1px;overflow:hidden">Sponsored</span>',
  'normal-invisible-outside': '<span style="position:absolute;left:-9999px">Sponsored</span>',
  'normal-invisible-svg': `<span style="visibility:hidden">${svgWord('ad')}</span>`,
  'normal-invisible-hidden-label': `<span style="visibility:hidden">${hiddenWord('ad')}</span>`,
};

// The sample feed. Ids that start with "ad" are ads; all others are not.
const FEED = [
  post('normal'),
  post('ad', {
    subtitle: svgWord('ad'),
    text: '<div data-ad-rendering-role="story_message"><span>Hello <a id="link-in-ad-text" href="/tag">#tag</a></span></div>',
    extra: `
      <div id="photo-box" class="photo-box">
        <img id="photo" alt="" width="40" height="40">
        <div id="more" class="more">+3</div>
        <div id="caption" class="caption"><div id="caption-inner" class="caption-inner">Caption</div></div>
      </div>
      <video id="video" width="40" height="40"></video>${linkBar}`,
  }),
  // A video ad: the box around the video is as wide as the ad, and layers
  // on the video have no background of their own.
  post('ad-video', {
    subtitle: svgWord('ad'),
    extra: '<div id="video-box" class="video-box"><video style="display:block; width:100%; height:120px"></video><div id="time" class="time">0:15</div><span id="mute" class="mute"><svg width="16" height="16"><rect width="16" height="16" fill="currentColor"></rect></svg></span></div>',
  }),
  post('ad-svg-sponsored', { subtitle: svgWord('sponsored') }),
  post('ad-svg-with-text', { subtitle: '<a href="?story"><svg width="60" height="16"><text y="12">Sponsored</text></svg></a>' }),
  post('ad-hidden-label', { subtitle: hiddenWord('ad') }),
  post('ad-aria-label', { subtitle: '<a href="?story" aria-label="Sponsored"><svg width="60" height="16"></svg></a>' }),
  post('ad-text', { subtitle: '<a href="?story"><span>\u200bSponsored\u200b</span></a>' }),
  post('ad-paid-for', { subtitle: '<div role="button"><span>Sponsored ·</span><span>Paid for by Example</span></div>' }),
  post('ad-paid-for-one-text', { subtitle: '<span>Sponsored · Paid for by Example</span>' }),
  post('ad-label-beside-name', { subtitle: '', beside: '<span>Sponsored</span>' }),
  post('ad-old-wrapper', { subtitle: '<span>Sponsored</span>', wrapper: 'role="article" aria-posinset="3"' }),
  post('ad-pagelet', { subtitle: '<span>Sponsored</span>', wrapper: 'data-pagelet="FeedUnit_4"' }),
  post('ad-to-normal', { subtitle: svgWord('ad') }),
  post('ad-card-narrows', { subtitle: svgWord('ad'), extra: '<div id="narrows-bar" class="bar">Bar</div>' }),
  post('ad-hidden-label-two-ids', { subtitle: '<a href="?story"><span aria-labelledby="word-dot-label word-sponsored-label"><svg width="40" height="16"></svg></span></a>' }),
  post('ad-hidden-label-fallback', { subtitle: '<a href="?story"><span aria-labelledby="no-such-id" aria-label="Sponsored"><svg width="40" height="16"></svg></span></a>' }),
  // An ad in dark mode, with an emoji in its text, drawn as a picture.
  post('ad-dark', {
    subtitle: svgWord('ad'),
    wrapper: 'data-virtualized="false" class="dark"',
    text: '<span id="dark-text">Big sale <img alt="" width="16" height="16"> today</span>',
    extra: '<div id="dark-bar" class="bar"><span id="dark-link">EXAMPLE.COM</span><div role="button" id="dark-button" class="button">Shop now</div></div>',
  }),
  post('normal-hidden-time', { subtitle: hiddenWord('time') }),
  post('normal-ads', { subtitle: svgWord('ads') }),
  post('normal-word-split-across-elements', { subtitle: '<span>Ad<span>vertising</span></span>' }),
  post('normal-sponsored-in-a-longer-part', { subtitle: '<span>Not Sponsored · 2 days ago</span>' }),
  post('normal-author-named-ad', { author: 'Ad' }),
  post('normal-svg-in-name', { author: `Author <svg width="40" height="16"><use href="#word-ad-1"></use></svg>` }),
  post('normal-no-author', { author: null, subtitle: svgWord('ad') }),
  post('normal-label-above-author', { above: svgWord('ad') }),
  post('normal-ad-in-text', { extra: '<div dir="auto" class="text"><span>Ad</span></div>' }),
  post('normal-svg-ad-in-video', { extra: `<div class="media">${svgWord('ad')}</div>` }),
  post('normal-hidden-ad-in-video', { extra: `<div class="media">${hiddenWord('ad')}</div>` }),
  post('normal-hidden-label-missing', { subtitle: '<a href="?story"><span aria-labelledby="no-such-id"><svg width="40" height="16"></svg></span></a>' }),
  post('normal-hidden-label', { subtitle: '<span style="display:none">Sponsored</span>' }),
  ...Object.entries(INVISIBLE).map(([id, subtitle]) => post(id, { subtitle })),
  post('normal-two-line-author', { author: LONG_NAME, subtitle: '', text: '<span>Ad · Use code JANE for 20% off</span>' }),
  // The same, when the heading's line-height is "normal" and the text sits
  // closer to the name.
  post('normal-two-line-author-normal-line-height', {
    author: LONG_NAME,
    subtitle: '',
    text: '<span>Ad · Use code JANE for 20% off</span>',
    wrapper: 'data-virtualized="false" class="normal-line-height"',
  }),
  // A page named "Sponsored": its profile picture link repeats the name.
  post('normal-page-named-sponsored', { author: 'Sponsored', beside: '<a href="/page" aria-label="Sponsored"><svg width="40" height="40"></svg></a>' }),
  post('normal-hidden-label-aria-hidden', { subtitle: `<span aria-hidden="true">${hiddenWord('ad')}</span>` }),
  post('normal-hidden-label-labelledby-wins', {
    subtitle: '<a href="?story"><span aria-labelledby="word-time-label" aria-label="Sponsored"><svg width="40" height="16"></svg></span></a>',
  }),
  post('normal-label-in-story-message', { subtitle: '', beside: '<div data-ad-rendering-role="story_message"><span>Sponsored</span></div>' }),
  post('normal-label-in-preview-message', { subtitle: '', beside: '<div data-ad-preview="message"><span>Sponsored</span></div>' }),
  post('normal-svg-loop', { subtitle: '<a href="?story"><svg width="40" height="16"><use href="#loop-1"></use></svg></a>' }),
  // A post shared inside another post: only the outermost post counts.
  post('normal-sharing-an-ad', { extra: post('inner-ad', { subtitle: svgWord('ad') }) }),
  // The same, when the outer post has no name heading of its own.
  post('normal-sharing-without-author', {
    author: null,
    subtitle: '',
    extra: post('inner-ad-2', { subtitle: svgWord('ad'), wrapper: 'aria-posinset="1"' }),
  }),
].join('');

const SIDE = `
  <aside>
    <section id="ad-sponsored-box"><h3><span>Sponsored\u200b</span></h3><a href="https://example.com" class="side-ad"><img alt="" width="40" height="40"><span>An ad</span></a></section>
    <section id="normal-birthdays"><h3>Birthdays</h3><span>Two birthdays today</span></section>
    <section id="normal-section-of-posts">${post('normal-post-by-ad', { author: 'Ad' })}</section>
    <section id="normal-hidden-sponsored-heading"><h3 style="visibility:hidden">Sponsored</h3><span>Text</span></section>
    <section id="normal-tiny-sponsored-heading"><h3 style="position:absolute;width:1px;height:1px;overflow:hidden">Sponsored</h3><span>Text</span></section>
    <section id="rail">
      <section id="ad-box-in-rail"><h3>Sponsored</h3><span>Another ad</span></section>
      <section id="normal-contacts"><h3>Contacts</h3><span>Jane</span></section>
    </section>
  </aside>`;

const page = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><style>
  body { background: ${GRAY}; color: ${TEXT}; font: 15px sans-serif; margin: 0; display: flex; gap: 16px }
  main { width: 600px; padding-bottom: 100vh }
  main > div { margin: 12px 0 }
  .card { background: ${WHITE}; border-radius: 12px; padding: 12px 0 }
  .card > * { padding: 0 12px }
  .author-line { display: flex; gap: 8px; align-items: center }
  h4 { margin: 0; font-size: 15px; line-height: 20px }
  .subtitle { min-height: 16px }
  .text { margin-top: 12px; line-height: 20px }
  .media { margin-top: 12px; height: 200px; background: rgb(0, 0, 0) }
  .card > .bar { background: ${GRAY}; padding: 12px }
  .button { display: inline-block; background: ${BUTTON}; padding: 8px }
  .photo-box { background: ${WHITE}; text-align: center; position: relative }
  .caption { position: absolute; left: 0; right: 0; bottom: 0; background: rgb(0, 0, 0); color: ${WHITE} }
  .caption-inner { background: rgb(20, 20, 20) }
  .more { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.4); color: ${WHITE} }
  .video-box { position: relative; background: rgb(0, 0, 0); color: ${WHITE} }
  .time, .mute { position: absolute; bottom: 4px }
  .time { right: 4px }
  .mute { left: 4px }
  .normal-line-height h4 { line-height: normal }
  .normal-line-height .text { margin-top: 0 }
  a { color: rgb(0, 100, 209); text-decoration: none }
  .dark { color: ${LIGHT} }
  .dark .card { background: ${DARK_CARD} }
  .dark .card > .bar { background: ${DARK_BAR} }
  .dark .button { background: ${DARK_BUTTON} }
</style></head>
<body>
  <main id="feed">${FEED}</main>
  ${SIDE}
  <svg id="loop-1"><use href="#loop-2"></use></svg><svg id="loop-2"><use href="#loop-1"></use></svg>
  ${hiddenWords}
</body>
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
  await context.route(PAGE_URL, (route) => route.fulfill({ contentType: 'text/html', body: page }));
  await context.route(PLAIN_URL, (route) => route.fulfill({ contentType: 'text/html', body: page }));
  tab = await context.newPage();
  tab.on('pageerror', (error) => errors.push(String(error)));
  tab.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await tab.goto(PAGE_URL);
  await tab.waitForSelector('#ad[data-ad-highlighter]');
});

after(async () => {
  await context?.close();
});

const isMarked = (id) => tab.evaluate((i) => document.getElementById(i).hasAttribute('data-ad-highlighter'), id);

const addPost = (html) => tab.evaluate((h) => document.getElementById('feed').insertAdjacentHTML('beforeend', h), html);

// Wait for one more scan: add an ad and wait until it is marked, then
// remove it. Use this before checking that something stayed unmarked.
async function waitForScan() {
  await addPost(post('probe', { subtitle: svgWord('ad') }));
  await tab.waitForSelector('#probe[data-ad-highlighter]');
  await tab.evaluate(() => document.getElementById('probe').remove());
}

const markedIds = () =>
  tab.evaluate(() => [...document.querySelectorAll('[data-ad-highlighter]')].map((element) => element.id).sort());

// A computed style property of the first element that matches selector.
const computed = (selector, property = 'color') =>
  tab.evaluate(([s, p]) => getComputedStyle(document.querySelector(s))[p], [selector, property]);

test('marks every ad and only the ads', async () => {
  const ads = await tab.evaluate(() => [...document.querySelectorAll('[id^="ad"]')].map((element) => element.id).sort());
  assert.ok(ads.length >= 10);
  assert.deepEqual(await markedIds(), ads);
  // No part of a normal post gets a mark of any kind.
  assert.equal(
    await tab.evaluate(() =>
      document.querySelector(
        '[id^="normal"] :is([data-ad-highlighter], [data-ad-highlighter-keep-colors], [data-ad-highlighter-full-width], [data-ad-highlighter-around-kept])',
      ),
    ),
    null,
  );
});

test('paints the white card an ad sits on yellow, with dark text', async () => {
  // The card is painted with an image layer, so its own color stays white.
  assert.equal(await computed('#ad .card', 'backgroundImage'), `linear-gradient(${YELLOW}, ${YELLOW})`);
  assert.equal(await computed('#ad .card', 'backgroundColor'), WHITE);
  assert.equal(await computed('#ad h4 span'), DARK);
  assert.equal(await computed('#ad .text span'), DARK);
  assert.equal(await computed('#ad-sponsored-box', 'backgroundColor'), YELLOW);
  assert.equal(await computed('#ad-sponsored-box .side-ad span'), DARK);
});

test('keeps the site colors on photos, videos, buttons and captions on photos', async () => {
  const kept = (id) => tab.evaluate((i) => document.getElementById(i).hasAttribute('data-ad-highlighter-keep-colors'), id);
  assert.equal(await kept('photo'), true);
  assert.equal(await kept('video'), true);
  assert.equal(await kept('shop-now'), true);
  assert.equal(await computed('#shop-now', 'backgroundImage'), 'none');
  assert.equal(await computed('#shop-now', 'backgroundColor'), BUTTON);
  // The button's text color comes from around it, so it stays the site's.
  assert.equal(await computed('#shop-now'), TEXT);
  // The caption spans the photo, but it lies on top of it, so it keeps its
  // colors and the yellow never covers the photo.
  assert.equal(await kept('caption'), true);
  assert.equal(await computed('#caption', 'backgroundImage'), 'none');
  assert.equal(await computed('#caption'), WHITE);
  // Everything inside a kept layer keeps its colors too, even a part as
  // wide as the ad.
  assert.equal(await computed('#caption-inner', 'backgroundImage'), 'none');
  // A see-through layer on a photo keeps its colors.
  assert.equal(await kept('more'), true);
  assert.equal(await computed('#more'), WHITE);
});

test('keeps the colors of layers on a video, and paints the box around the video yellow', async () => {
  assert.equal(await computed('#video-box', 'backgroundImage'), YELLOW_LAYER);
  assert.equal(await computed('#time'), WHITE);
  assert.equal(await computed('#mute'), WHITE);
});

test('underlines links in the text of an ad', async () => {
  assert.equal(await computed('#link-in-ad-text', 'textDecorationLine'), 'underline');
});

test('paints the bar under a link and the space beside a photo yellow, with dark text', async () => {
  assert.equal(await computed('#link-bar', 'backgroundImage'), YELLOW_LAYER);
  assert.equal(await computed('#link-bar span'), DARK);
  assert.equal(await computed('#photo-box', 'backgroundImage'), YELLOW_LAYER);
});

test('in dark mode, keeps text on yellow dark, and a button light', async () => {
  // The emoji is a picture, so it keeps its colors, but the text next to it
  // must not keep Facebook's light text color on yellow.
  assert.equal(await computed('#dark-text'), DARK);
  assert.equal(await computed('#dark-bar', 'backgroundImage'), YELLOW_LAYER);
  assert.equal(await computed('#dark-link'), DARK);
  // The button keeps its dark background, so its text must stay light.
  assert.equal(await computed('#dark-button', 'backgroundColor'), DARK_BUTTON);
  assert.equal(await computed('#dark-button'), LIGHT);
});

test('each way finds the ads in its own form, and no way finds a normal post', async () => {
  // The way, by its place in the list in facebook.js, that finds each ad.
  const FOUND_BY = {
    ad: [0],
    'ad-svg-sponsored': [0],
    'ad-svg-with-text': [0],
    'ad-to-normal': [0],
    'ad-card-narrows': [0],
    'ad-dark': [0],
    'ad-video': [0],
    'ad-hidden-label': [1],
    'ad-aria-label': [1],
    'ad-hidden-label-two-ids': [1],
    'ad-hidden-label-fallback': [1],
    'ad-text': [2],
    'ad-paid-for': [2],
    'ad-paid-for-one-text': [2],
    'ad-label-beside-name': [2],
    'ad-old-wrapper': [2],
    'ad-pagelet': [2],
    'ad-sponsored-box': [3],
    'ad-box-in-rail': [3],
  };
  // Load the site file on a page without the extension, and keep the site
  // it passes to watch() instead of starting to watch.
  const plain = await context.newPage();
  const plainErrors = [];
  plain.on('pageerror', (error) => plainErrors.push(String(error)));
  try {
    await plain.goto(PLAIN_URL);
    await plain.addScriptTag({ path: CORE });
    await plain.evaluate(() => {
      adHighlighter.watch = (site) => {
        window.site = site;
      };
    });
    await plain.addScriptTag({ path: FACEBOOK });
    const found = await plain.evaluate(() => {
      const result = {};
      window.site.ways.forEach((way, index) => {
        for (const post of way.posts()) {
          result[post.id] ??= [];
          if (way.isAd(post) === true) result[post.id].push(index);
        }
      });
      return result;
    });
    const expected = Object.fromEntries(Object.keys(found).map((id) => [id, FOUND_BY[id] ?? []]));
    assert.deepEqual(found, expected);
    // Every ad above is among the posts the ways check.
    assert.deepEqual(Object.keys(FOUND_BY).filter((id) => !(id in found)), []);
    assert.deepEqual(plainErrors, []);
  } finally {
    await plain.close();
  }
});

test('a name on two lines does not make the line under it taller', async () => {
  for (const id of ['normal-two-line-author', 'normal-two-line-author-normal-line-height']) {
    const shape = await tab.evaluate((i) => {
      const name = document.querySelector(`#${i} h4`).getBoundingClientRect();
      const text = document.querySelector(`#${i} .text span`).getBoundingClientRect();
      // How far the text's middle sits inside a window as tall as the name.
      return { height: name.height, inside: name.bottom + name.height - (text.top + text.height / 2) };
    }, id);
    // The test only means something when the name takes two lines, and the
    // text under it sits inside a window as tall as the whole name.
    assert.ok(shape.height >= 30, `${id}: name is ${shape.height}px tall`);
    assert.ok(shape.inside >= 0, `${id}: text is ${-shape.inside}px below a window as tall as the name`);
    assert.equal(await isMarked(id), false, id);
  }
});

test('leaves a normal post exactly as it was', async () => {
  assert.equal(await computed('#normal .card', 'backgroundColor'), WHITE);
  assert.equal(await computed('#normal .text span'), TEXT);
});

test('marks an ad that appears later, and unmarks a post when its label turns into a time', async () => {
  await addPost(post('ad-late', { subtitle: svgWord('ad') }));
  await tab.waitForSelector('#ad-late[data-ad-highlighter]');
  await tab.evaluate((html) => { document.querySelector('#ad-to-normal .subtitle').innerHTML = html; }, svgWord('time'));
  await tab.waitForSelector('#ad-to-normal:not([data-ad-highlighter])');
  assert.equal(await tab.evaluate(() => document.querySelector('#ad-to-normal [data-ad-highlighter-full-width]')), null);
});

test('drops the full-width mark from a part that no longer spans the post', async () => {
  const card = () =>
    tab.evaluate(() => {
      const element = document.querySelector('#ad-card-narrows .card');
      return [element.hasAttribute('data-ad-highlighter-full-width'), element.hasAttribute('data-ad-highlighter-keep-colors')];
    });
  assert.deepEqual(await card(), [true, false]);
  assert.equal(await computed('#narrows-bar', 'backgroundImage'), YELLOW_LAYER);
  await tab.evaluate(() => {
    document.querySelector('#ad-card-narrows .card').style.width = '50%';
  });
  await waitForScan();
  assert.equal(await isMarked('ad-card-narrows'), true);
  assert.deepEqual(await card(), [false, true]);
  // The bar is now inside a part that keeps its colors, so it loses its
  // mark from the earlier scan.
  assert.equal(await tab.evaluate(() => document.getElementById('narrows-bar').attributes.length), 2);
  assert.equal(await computed('#narrows-bar', 'backgroundImage'), 'none');
});

test('ignores a hidden label, even when the author line crosses the top of the window', async () => {
  const box = await tab.evaluate(() => {
    const name = document.querySelector('#normal-hidden-label h4');
    window.scrollBy(0, name.getBoundingClientRect().top + 4);
    const { top, bottom } = name.getBoundingClientRect();
    return { top, bottom };
  });
  // The test only means something when the author line crosses the top.
  assert.ok(box.top < 0 && box.bottom > 0, `author line at ${box.top} to ${box.bottom}`);
  await waitForScan();
  assert.equal(await isMarked('normal-hidden-label'), false);
});

test('the page shows no errors', () => {
  assert.deepEqual(errors, []);
});

test('makes no network requests', () => {
  assert.deepEqual(requests.filter((url) => url !== PAGE_URL && url !== PLAIN_URL), []);
});
