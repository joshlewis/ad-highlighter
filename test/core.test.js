// Tests for src/core.js, the part every site shares.
//
// Each test loads src/core.js on a plain page with no extension, calls
// adHighlighter.watch() with a small test site, and checks what it marks.
// window.way(posts, isAd, keepColors) builds a site with that one way.
//
// Run: npm install, then npx playwright install chromium, then npm test.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');

const CORE = path.join(__dirname, '..', 'src', 'core.js');
const CSS = path.join(__dirname, '..', 'src', 'highlight.css');
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
    window.way = (posts, isAd, keepColors) => ({ ways: [{ posts, isAd }], keepColors });
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
      adHighlighter.watch(way(articles, (post) => (answers[post.id] === 'post' ? post : answers[post.id])));
      // watch() scans once before it returns.
      return markedIds();
    }),
  );
  assert.deepEqual(result, ['a']);
});

test('accepts posts as a NodeList', async () => {
  const result = await withCore((page) =>
    page.evaluate(() => {
      adHighlighter.watch(way(() => document.querySelectorAll('article'), (post) => post.id === 'a'));
      return markedIds();
    }),
  );
  assert.deepEqual(result, ['a']);
});

test('an error in one post does not stop the scan of the others, and shows once', async () => {
  const [result, errors] = await withCore(async (page, errors) => [
    await page.evaluate(async () => {
      window.bIsAd = true;
      adHighlighter.watch(
        way(articles, (post) => {
          // The first post throws, so the scan must go on to the second.
          if (post.id === 'a') throw new Error('broken site file');
          return window.bIsAd;
        }),
      );
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
      adHighlighter.watch(
        way(
          () => {
            if (window.postsBroken) throw new Error('broken posts');
            return articles();
          },
          () => true,
        ),
      );
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
      adHighlighter.watch(way(() => [...document.querySelectorAll(window.postSelector)], () => true));
      const first = markedIds();
      window.postSelector = '#b';
      change();
      await nextFrame();
      return { first, later: markedIds() };
    }),
  );
  assert.deepEqual(result, { first: ['a', 'b'], later: ['b'] });
});

test('a change to the site after watch() starts does not reach the scans', async () => {
  const [result, errors] = await withCore(async (page, errors) => [
    await page.evaluate(async () => {
      const site = way(articles, () => true, 'img');
      adHighlighter.watch(site);
      site.keepColors = '[[not a selector';
      site.ways.push({ posts: null, isAd: null });
      change();
      await nextFrame();
      return markedIds();
    }),
    errors,
  ]);
  assert.deepEqual(result, ['a', 'b']);
  assert.deepEqual(errors, []);
});

test('skips a post that is not an element, and posts() that returns one element, with one error each', async () => {
  const [result, errors] = await withCore(async (page, errors) => [
    await page.evaluate(async () => {
      adHighlighter.watch({
        ways: [
          { posts: () => [null, document.createTextNode('x'), ...articles()], isAd: () => true },
          { posts: () => document.querySelector('article'), isAd: () => true },
        ],
      });
      const first = markedIds();
      change();
      await nextFrame();
      return { first, later: markedIds() };
    }),
    errors,
  ]);
  assert.deepEqual(result, { first: ['a', 'b'], later: ['a', 'b'] });
  assert.equal(errors.length, 2, errors.join('\n'));
  assert.match(errors[0], /site\.ways\[0\].*not an element/);
  assert.match(errors[1], /site\.ways\[1\].*must return an array/);
});

test('scans at most once per frame, even when changes come in separate tasks', async () => {
  const result = await withCore((page) =>
    page.evaluate(async () => {
      let scans = 0;
      adHighlighter.watch(way(() => { scans += 1; return []; }, () => false));
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
      adHighlighter.watch(way(articles, () => false, 'span'));
      return count;
    }),
  );
  assert.equal(calls, 0);
});

test('a post is an ad when any way finds it, and ways can check different posts', async () => {
  const result = await withCore((page) =>
    page.evaluate(() => {
      document.getElementById('feed').insertAdjacentHTML('beforeend', '<section id="s">S</section>');
      adHighlighter.watch({
        ways: [
          { posts: articles, isAd: (post) => post.id === 'a' },
          { posts: articles, isAd: (post) => post.id === 'b' },
          { posts: () => document.querySelectorAll('section'), isAd: () => true },
        ],
      });
      return markedIds();
    }),
  );
  assert.deepEqual(result, ['a', 'b', 's']);
});

test('an error in one way does not stop the other ways, and each way shows its first error once', async () => {
  const [result, errors] = await withCore(async (page, errors) => [
    await page.evaluate(async () => {
      window.goodId = 'b';
      adHighlighter.watch({
        ways: [
          {
            posts() {
              throw new Error('broken posts in way 0');
            },
            isAd: () => true,
          },
          {
            posts: articles,
            isAd() {
              throw new Error('broken isAd in way 1');
            },
          },
          { posts: articles, isAd: (post) => post.id === window.goodId },
        ],
      });
      const first = markedIds();
      // A different answer proves that the second scan ran.
      window.goodId = 'a';
      change();
      await nextFrame();
      return { first, later: markedIds() };
    }),
    errors,
  ]);
  assert.deepEqual(result, { first: ['b'], later: ['a'] });
  assert.equal(errors.length, 2);
  assert.match(errors[0], /site\.ways\[0\].*broken posts in way 0/);
  assert.match(errors[1], /site\.ways\[1\].*broken isAd in way 1/);
});

test('ways that share one posts() function call it once per scan', async () => {
  const calls = await withCore((page) =>
    page.evaluate(() => {
      let count = 0;
      const posts = () => {
        count += 1;
        return articles();
      };
      adHighlighter.watch({ ways: [{ posts, isAd: () => false }, { posts, isAd: (post) => post.id === 'a' }] });
      return count;
    }),
  );
  assert.equal(calls, 1);
});

test('paints full-width parts, keeps colors on narrower parts and on layers, and unmarks both', async () => {
  const result = await withCore((page) =>
    page.evaluate(async () => {
      document.getElementById('a').style.position = 'relative';
      document.getElementById('a').innerHTML = `
        <div id="card" style="background:rgb(255, 255, 255)">
          <div id="text">Text</div>
          <div id="bar" style="background:rgb(240, 242, 245)">Bar</div>
          <div id="button" style="background:rgb(0, 0, 0); display:inline-block">Shop now</div>
          <div id="layer" style="background:rgb(0, 0, 0); position:absolute; left:0; right:0; top:0">Caption</div>
        </div>`;
      window.aIsAd = true;
      adHighlighter.watch(way(articles, (post) => post.id === 'a' && window.aIsAd));
      const marks = () =>
        ['card', 'text', 'bar', 'button', 'layer'].map((id) => {
          const element = document.getElementById(id);
          return [id, element.hasAttribute('data-ad-highlighter-full-width'), element.hasAttribute('data-ad-highlighter-keep-colors')];
        });
      const first = marks();
      window.aIsAd = false;
      change();
      await nextFrame();
      return { first, later: marks() };
    }),
  );
  assert.deepEqual(result.first, [
    ['card', true, false],
    ['text', false, false],
    ['bar', true, false],
    ['button', false, true],
    // A layer on top of other parts keeps its colors, even at full width.
    ['layer', false, true],
  ]);
  assert.deepEqual(result.later, [
    ['card', false, false],
    ['text', false, false],
    ['bar', false, false],
    ['button', false, false],
    ['layer', false, false],
  ]);
});

test('findLabels ignores spaces and characters that never show around a label', async () => {
  const count = await withCore((page) =>
    page.evaluate(() => {
      const post = document.getElementById('a');
      post.innerHTML = `
        <span>\u200bSponsored\u200b</span>
        <span> Ad\ufeff </span>
        <span>\u200c\u00adSponsored\u2060\u200d</span>
        <span>\u200eAd\ufe0f</span>
        <span>Ad\u200bs</span>`;
      return adHighlighter.findLabels(post, new Set(['Ad', 'Sponsored']), 'h4').length;
    }),
  );
  assert.equal(count, 4);
});

test('findLabels finds only a label that a reader can see inside the post', async () => {
  const ids = await withCore((page) =>
    page.evaluate(() => {
      const post = document.getElementById('a');
      post.style.position = 'relative';
      post.innerHTML = `
        <span id="shown">Ad</span>
        <span id="hidden" style="visibility:hidden">Ad</span>
        <span style="opacity:0"><span id="see-through">Ad</span></span>
        <span id="tiny" style="position:absolute;width:1px;height:1px;overflow:hidden">Ad</span>
        <span id="gone" style="display:none">Ad</span>
        <span id="outside" style="position:absolute;left:-9999px">Ad</span>`;
      return adHighlighter.findLabels(post, new Set(['Ad']), 'h4').map((element) => element.id);
    }),
  );
  assert.deepEqual(ids, ['shown']);
});

test('findLabels reads a label between separators only when given them', async () => {
  const result = await withCore((page) =>
    page.evaluate(() => {
      const post = document.getElementById('a');
      post.innerHTML = '<span id="one">Sponsored · Paid for by Example</span><span id="two">Not Sponsored · 2 days ago</span>';
      const ids = (separators) =>
        adHighlighter.findLabels(post, new Set(['Sponsored']), 'h4', separators).map((element) => element.id);
      return { withDots: ids(/[·•]/), without: ids(undefined) };
    }),
  );
  assert.deepEqual(result, { withDots: ['one'], without: [] });
});

test('watch() throws before it starts for a site in the wrong form', async () => {
  const [result, errors] = await withCore(async (page, errors) => [
    await page.evaluate(async () => {
      const sites = [
        {},
        { ways: [] },
        { ways: [{ posts: articles }] },
        { ways: [{ isAd: () => true }] },
        way(articles, () => true, '[[not a selector'),
      ];
      const messages = sites.map((site) => {
        try {
          adHighlighter.watch(site);
          return 'no error';
        } catch (error) {
          return error.message;
        }
      });
      change();
      await nextFrame();
      return { messages, marked: markedIds() };
    }),
    errors,
  ]);
  assert.match(result.messages[0], /site\.ways must be an array/);
  assert.match(result.messages[1], /site\.ways must be an array/);
  assert.match(result.messages[2], /site\.ways\[0\] needs/);
  assert.match(result.messages[3], /site\.ways\[0\] needs/);
  assert.match(result.messages[4], /site\.keepColors is not a CSS selector/);
  // No watch started: the last site would mark both posts, and the page
  // change caused no scans and no errors.
  assert.deepEqual(result.marked, []);
  assert.deepEqual(errors, []);
});

test('marks the elements around a kept part with text, but never one with text of its own', async () => {
  const result = await withCore((page) =>
    page.evaluate(async () => {
      document.getElementById('a').innerHTML = `
        <div id="text">Big sale <img id="emoji" width="16" height="16"> today</div>
        <div id="wrap"><div id="bar" style="background:rgb(0, 0, 0); display:inline-block"><span>Bar text</span></div></div>
        <div id="mixed">Mixed <div id="button" style="background:rgb(0, 0, 0); display:inline-block">Shop now</div></div>
        <div id="photo-wrap"><img id="photo" width="16" height="16"></div>`;
      window.aIsAd = true;
      adHighlighter.watch(way(articles, (post) => post.id === 'a' && window.aIsAd, 'img'));
      const marks = () =>
        ['text', 'emoji', 'wrap', 'bar', 'mixed', 'button', 'photo-wrap', 'photo'].map((id) => {
          const element = document.getElementById(id);
          return [id, element.hasAttribute('data-ad-highlighter-keep-colors'), element.hasAttribute('data-ad-highlighter-around-kept')];
        });
      const first = marks();
      window.aIsAd = false;
      change();
      await nextFrame();
      return { first, later: marks() };
    }),
  );
  assert.deepEqual(result.first, [
    // The emoji holds no text, so the text around it takes the dark text.
    ['text', false, false],
    ['emoji', true, false],
    ['wrap', false, true],
    ['bar', true, false],
    // This element has text of its own, so it takes the dark text.
    ['mixed', false, false],
    ['button', true, false],
    // A photo holds no text, so the element around it needs no mark.
    ['photo-wrap', false, false],
    ['photo', true, false],
  ]);
  assert.ok(result.later.every(([, keep, around]) => !keep && !around), JSON.stringify(result.later));
});

test('full-width parts: a part a fraction narrower counts, fixed layers and picture backgrounds keep colors, and the yellow fills the part', async () => {
  const result = await withCore(async (page) => {
    await page.addStyleTag({ path: CSS });
    return page.evaluate(() => {
      const post = document.getElementById('a');
      post.style.width = '600.5px';
      post.innerHTML = `
        <div id="near" style="box-sizing:border-box; width:600px; padding:8px; background:rgb(255, 255, 255); background-size:10px 10px; background-repeat:no-repeat; background-clip:content-box">Near</div>
        <div id="fixed" style="position:fixed; left:0; width:600.5px; background:rgb(0, 0, 0)">Fixed</div>
        <div id="picture" style="background:rgb(255, 255, 255) url(data:image/gif;base64,R0lGODlhAQABAAAAACw=)">Picture</div>`;
      adHighlighter.watch(way(articles, (element) => element.id === 'a'));
      const marks = (id) => {
        const element = document.getElementById(id);
        return [element.hasAttribute('data-ad-highlighter-full-width'), element.hasAttribute('data-ad-highlighter-keep-colors')];
      };
      const near = getComputedStyle(document.getElementById('near'));
      return {
        near: marks('near'),
        fixed: marks('fixed'),
        picture: marks('picture'),
        layer: [near.backgroundSize, near.backgroundRepeat, near.backgroundClip],
      };
    });
  });
  assert.deepEqual(result, {
    near: [true, false],
    fixed: [false, true],
    picture: [false, true],
    layer: ['auto', 'repeat', 'border-box'],
  });
});

test('keeps the colors of a layer on a photo or video, even with no background, but not of other layers', async () => {
  const result = await withCore((page) =>
    page.evaluate(() => {
      document.getElementById('a').innerHTML = `
        <div id="video-box" style="position:relative; background:rgb(0, 0, 0)">
          <video style="display:block; width:100%; height:50px"></video>
          <div id="time" style="position:absolute; right:0; bottom:0">0:15</div>
          <div id="elsewhere" style="position:absolute; top:-100px">Above</div>
        </div>`;
      adHighlighter.watch(way(articles, (element) => element.id === 'a', 'video'));
      return ['video-box', 'time', 'elsewhere'].map((id) => {
        const element = document.getElementById(id);
        return [id, element.hasAttribute('data-ad-highlighter-full-width'), element.hasAttribute('data-ad-highlighter-keep-colors')];
      });
    }),
  );
  assert.deepEqual(result, [
    ['video-box', true, false],
    ['time', false, true],
    ['elsewhere', false, false],
  ]);
});

test('removes the marks of a part that a scan no longer reaches', async () => {
  const result = await withCore((page) =>
    page.evaluate(async () => {
      document.getElementById('a').innerHTML =
        '<div id="card" style="background:rgb(255, 255, 255)"><div id="bar" style="background:rgb(240, 242, 245)">Bar</div></div>';
      adHighlighter.watch(way(articles, (element) => element.id === 'a'));
      const names = (id) => [...document.getElementById(id).attributes].map((attribute) => attribute.name).filter((name) => name.startsWith('data-'));
      const first = { card: names('card'), bar: names('bar') };
      // The card now keeps its colors, so the scan skips everything in it.
      document.getElementById('card').style.width = '50%';
      change();
      await nextFrame();
      return { first, later: { card: names('card'), bar: names('bar') } };
    }),
  );
  assert.deepEqual(result, {
    first: { card: ['data-ad-highlighter-full-width'], bar: ['data-ad-highlighter-full-width'] },
    later: { card: ['data-ad-highlighter-keep-colors'], bar: [] },
  });
});

test('reads the site background color of a full-width part, not the yellow it paints', async () => {
  const result = await withCore(async (page) => {
    await page.addStyleTag({ path: CSS });
    return page.evaluate(async () => {
      document.getElementById('a').innerHTML = '<div id="card" style="background:rgb(255, 255, 255)">Text</div>';
      adHighlighter.watch(way(articles, (post) => post.id === 'a'));
      const marks = () => {
        const card = document.getElementById('card');
        return [card.hasAttribute('data-ad-highlighter-full-width'), card.hasAttribute('data-ad-highlighter-keep-colors')];
      };
      const first = marks();
      // The site takes away the card's background. The card is now plain
      // text, so it takes the dark text.
      document.getElementById('card').style.background = 'none';
      change();
      await nextFrame();
      return { first, later: marks() };
    });
  });
  assert.deepEqual(result, { first: [true, false], later: [false, false] });
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
