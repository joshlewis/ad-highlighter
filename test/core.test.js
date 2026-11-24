// Tests for src/core.js, the part every site shares.
//
// Each test loads src/core.js on a plain page with no extension, calls
// adHighlighter.watch() with a small test site, and checks what it marks.
//
// Run: npm install, then npx playwright install chromium, then npm test.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

const CORE = path.join(__dirname, '..', 'src', 'core.js');
const PAGE = `<!doctype html>
<html lang="en">
<body><main id="feed"><article id="a">A</article><article id="b">B</article></main></body>
</html>`;

let context;

before(async () => {
  context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true });
  await context.route('**', (route) => route.abort());
  await context.route('https://example.com/', (route) => route.fulfill({ contentType: 'text/html', body: PAGE }));
});

after(async () => {
  await context?.close();
});

// Load src/core.js on a fresh page, then call run with that page and the
// list of errors the page shows, both logged and uncaught.
async function withCore(run) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await page.goto('https://example.com/');
  await page.addScriptTag({ path: CORE });
  await page.evaluate(() => {
    // Wait until the frame after the next one, so a scan queued now has run.
    window.nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    // Change the page, so the core queues a scan.
    window.change = () => document.body.append(document.createElement('div'));
    window.markedIds = () => [...document.querySelectorAll('[data-ad-highlighter]')].map((element) => element.id);
    window.articles = () => [...document.querySelectorAll('article')];
  });
  try {
    return await run(page, errors);
  } finally {
    await page.close();
  }
}

test('only a result of exactly true counts as an ad', async () => {
  const result = await withCore((page) =>
    page.evaluate(() => {
      document.getElementById('feed').insertAdjacentHTML('beforeend', '<article id="c">C</article><article id="d">D</article><article id="e">E</article>');
      const answers = { a: true, b: 1, c: 'true', d: 'post', e: undefined };
      adHighlighter.watch({ posts: articles, isAd: (post) => (answers[post.id] === 'post' ? post : answers[post.id]) });
      // watch() scans once before it returns.
      return markedIds();
    }),
  );
  assert.deepEqual(result, ['a']);
});

test('accepts posts as a NodeList', async () => {
  const result = await withCore((page) =>
    page.evaluate(() => {
      adHighlighter.watch({ posts: () => document.querySelectorAll('article'), isAd: (post) => post.id === 'a' });
      return markedIds();
    }),
  );
  assert.deepEqual(result, ['a']);
});

test('an error in one post does not stop the scan of the others, and shows once', async () => {
  const [result, errors] = await withCore(async (page, errors) => [
    await page.evaluate(async () => {
      window.bIsAd = true;
      adHighlighter.watch({
        posts: articles,
        isAd(post) {
          // The first post throws, so the scan must go on to the second.
          if (post.id === 'a') throw new Error('broken site file');
          return window.bIsAd;
        },
      });
      const first = markedIds();
      window.bIsAd = false;
      change();
      await nextFrame();
      change();
      await nextFrame();
      return { first, later: markedIds() };
    }),
    errors,
  ]);
  assert.deepEqual(result, { first: ['b'], later: [] });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /broken site file/);
});

test('an error in posts() unmarks every post, shows once, and the next good scan marks them again', async () => {
  const [result, errors] = await withCore(async (page, errors) => [
    await page.evaluate(async () => {
      window.postsBroken = false;
      adHighlighter.watch({
        posts() {
          if (window.postsBroken) throw new Error('broken posts');
          return articles();
        },
        isAd: () => true,
      });
      const first = markedIds();
      window.postsBroken = true;
      change();
      await nextFrame();
      change();
      await nextFrame();
      const broken = markedIds();
      window.postsBroken = false;
      change();
      await nextFrame();
      return { first, broken, fixed: markedIds() };
    }),
    errors,
  ]);
  assert.deepEqual(result, { first: ['a', 'b'], broken: [], fixed: ['a', 'b'] });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /broken posts/);
});

test('unmarks an element that is no longer one of the posts', async () => {
  const result = await withCore((page) =>
    page.evaluate(async () => {
      window.postSelector = 'article';
      adHighlighter.watch({ posts: () => [...document.querySelectorAll(window.postSelector)], isAd: () => true });
      const first = markedIds();
      window.postSelector = '#b';
      change();
      await nextFrame();
      return { first, later: markedIds() };
    }),
  );
  assert.deepEqual(result, { first: ['a', 'b'], later: ['b'] });
});

test('scans at most once per frame, even when changes come in separate tasks', async () => {
  const result = await withCore((page) =>
    page.evaluate(async () => {
      let scans = 0;
      adHighlighter.watch({ posts: () => { scans += 1; return []; }, isAd: () => false });
      await nextFrame();
      let frames = 0;
      let counting = true;
      const countFrames = () => {
        if (!counting) return;
        frames += 1;
        requestAnimationFrame(countFrames);
      };
      requestAnimationFrame(countFrames);
      const start = scans;
      // Make each change in a task of its own, the way a site's own code
      // often changes the page several times within one frame.
      const channel = new MessageChannel();
      for (let i = 0; i < 20; i++) {
        change();
        await new Promise((resolve) => {
          channel.port1.onmessage = resolve;
          channel.port2.postMessage(null);
        });
      }
      await nextFrame();
      counting = false;
      return { scans: scans - start, frames };
    }),
  );
  assert.ok(result.scans >= 1 && result.scans <= result.frames, `${result.scans} scans in ${result.frames} frames`);
});

test('reads no styles from a post that is not an ad', async () => {
  const calls = await withCore((page) =>
    page.evaluate(() => {
      document.getElementById('a').innerHTML = '<div><span>A</span></div>';
      let count = 0;
      const original = window.getComputedStyle;
      window.getComputedStyle = (...args) => {
        count += 1;
        return original(...args);
      };
      adHighlighter.watch({ posts: articles, isAd: () => false, keepColors: 'span' });
      return count;
    }),
  );
  assert.equal(calls, 0);
});

test('helpers ignore a match outside the post, such as <html lang>', async () => {
  const result = await withCore((page) =>
    page.evaluate(() => {
      const post = document.getElementById('a');
      post.innerHTML = '<span>Ad</span>';
      return {
        labels: adHighlighter.findLabels(post, new Set(['Ad']), '[lang]').length,
        own: adHighlighter.findOwn(post, 'span', 'main') !== null,
      };
    }),
  );
  assert.deepEqual(result, { labels: 1, own: true });
});
