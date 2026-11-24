// Tests for src/color.js on its own, with a stand-in for chrome.storage.
// test/color-setting.test.js tests the popup and the pages with the real
// extension loaded.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'color.js'), 'utf8');
const KEY = 'highlightColor';

// Load src/color.js. saved is what chrome.storage.local holds. When
// readLater is true, a read waits until the test calls finishRead(), so a
// test can send a change before the first read finishes.
function loadColor({ saved = {}, readLater = false, readFails = false } = {}) {
  const listeners = [];
  const writes = [];
  const errors = [];
  let finishRead = () => {};
  const chrome = {
    storage: {
      local: {
        get(key) {
          if (readFails) return Promise.reject(new Error('storage is broken'));
          const result = { [key]: saved[key] };
          if (!readLater) return Promise.resolve(result);
          return new Promise((resolve) => {
            finishRead = () => resolve(result);
          });
        },
        set(items) {
          writes.push(items);
          return Promise.resolve();
        },
      },
      onChanged: { addListener: (listener) => listeners.push(listener) },
    },
  };
  const console = { error: (...parts) => errors.push(parts.join(' ')) };
  const color = new Function('chrome', 'console', `${SOURCE}\nreturn adHighlighterColor;`)(chrome, console);
  const change = (newValue, { area = 'local', key = KEY } = {}) => {
    for (const listener of listeners) listener({ [key]: { newValue } }, area);
  };
  return { color, writes, errors, change, finishRead: () => finishRead() };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function hex(red, green, blue) {
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

// Every 17th value of each channel, 4096 colors from black to white.
function grid() {
  const colors = [];
  for (let red = 0; red < 256; red += 17) {
    for (let green = 0; green < 256; green += 17) {
      for (let blue = 0; blue < 256; blue += 17) colors.push(hex(red, green, blue));
    }
  }
  return colors;
}

const { color } = loadColor();

test('normalize keeps a color in the form "#rrggbb" and turns anything else into the default', () => {
  assert.equal(color.normalize('#1d4ed8'), '#1d4ed8');
  assert.equal(color.normalize('#1D4ED8'), '#1d4ed8');
  for (const broken of [undefined, null, 12, '', 'red', '#fff', 'ffe500', '#ffe5001', '#ggg000', ' #ffe500', 'red; } body { display: none']) {
    assert.equal(color.normalize(broken), color.DEFAULT, String(broken));
  }
});

test('parseHex reads a typed code with or without "#", with three or six digits', () => {
  assert.equal(color.parseHex('#1d4ed8'), '#1d4ed8');
  assert.equal(color.parseHex('1D4ED8'), '#1d4ed8');
  assert.equal(color.parseHex('  #1d4ed8 '), '#1d4ed8');
  assert.equal(color.parseHex('#fe0'), '#ffee00');
  assert.equal(color.parseHex('ABC'), '#aabbcc');
  for (const broken of ['', '#', '#ffe50', '#ffe5001', 'red', '#ggg', '##ffe500', '#ff e500']) {
    assert.equal(color.parseHex(broken), null, broken);
  }
});

test('hslToHex and hexToHsl turn colors from one form into the other', () => {
  const pairs = [
    [[0, 0, 0], '#000000'],
    [[0, 0, 100], '#ffffff'],
    [[0, 0, 50], '#808080'],
    [[0, 100, 50], '#ff0000'],
    [[120, 100, 50], '#00ff00'],
    [[240, 100, 50], '#0000ff'],
    [[300, 100, 25], '#800080'],
    [[54, 100, 50], '#ffe600'],
  ];
  for (const [hsl, code] of pairs) {
    assert.equal(color.hslToHex(...hsl), code, hsl.join(' '));
    assert.deepEqual(color.hexToHsl(code), hsl, code);
  }
  assert.deepEqual(color.hexToHsl(color.DEFAULT), [54, 100, 50]);
  // A hue of 360 is the same as 0.
  assert.equal(color.hslToHex(360, 100, 50), '#ff0000');
  // The sliders hold whole numbers, so a color can move a little on the way
  // through them and back, but never far.
  for (const code of grid()) {
    const back = color.hslToHex(...color.hexToHsl(code));
    for (const start of [1, 3, 5]) {
      const moved = Math.abs(parseInt(code.slice(start, start + 2), 16) - parseInt(back.slice(start, start + 2), 16));
      assert.ok(moved <= 5, `${code} came back as ${back}`);
    }
  }
});

test('contrast follows the WCAG accessibility rules', () => {
  assert.equal(color.contrast('#000000', '#ffffff'), 21);
  assert.equal(color.contrast('#ffffff', '#000000'), 21);
  assert.equal(color.contrast('#1d4ed8', '#1d4ed8'), 1);
  // WCAG's own example: #777777 on white is 4.48 to 1.
  assert.equal(color.contrast('#777777', '#ffffff').toFixed(2), '4.48');
});

test('textFor gives bright colors dark text and deep colors white text', () => {
  for (const bright of [color.DEFAULT, '#ffffff', '#ffa53a', '#ff6f61', '#6cc4ff', '#5ef2b0', '#ff0000']) {
    assert.equal(color.textFor(bright), color.DARK_TEXT, bright);
  }
  for (const deep of ['#000000', '#c62828', '#6a1b9a', '#1d4ed8', '#1b5e20', '#0000ff', '#777777']) {
    assert.equal(color.textFor(deep), color.LIGHT_TEXT, deep);
  }
});

test('textFor always picks the text color with more contrast, and never less than 4.3 to 1', () => {
  for (const code of [...grid(), '#058791']) {
    const text = color.textFor(code);
    const other = text === color.DARK_TEXT ? color.LIGHT_TEXT : color.DARK_TEXT;
    const contrast = color.contrast(code, text);
    assert.ok(contrast >= color.contrast(code, other), `${code} got ${text}`);
    assert.ok(contrast >= 4.3, `${code} gets ${contrast.toFixed(2)} to 1`);
  }
});

test('src/highlight.css falls back to the same default colors as src/color.js', () => {
  const css = fs.readFileSync(path.join(ROOT, 'src', 'highlight.css'), 'utf8');
  const fallbacks = (name) => [...css.matchAll(new RegExp(`var\\(--${name}, ([^)]+)\\)`, 'g'))].map((match) => match[1]);
  assert.deepEqual(fallbacks('ad-highlighter-color'), [color.DEFAULT, color.DEFAULT, color.DEFAULT]);
  assert.deepEqual(fallbacks('ad-highlighter-text'), [color.DARK_TEXT]);
  // And the CSS uses nothing but the variables for the highlight colors.
  assert.equal(css.match(/#[0-9a-f]{6}/gi).length, 4);
});

test('load reads the saved color, and gives the default when there is none or it is broken', async () => {
  assert.equal(await loadColor().color.load(), color.DEFAULT);
  assert.equal(await loadColor({ saved: { [KEY]: '#1d4ed8' } }).color.load(), '#1d4ed8');
  assert.equal(await loadColor({ saved: { [KEY]: 'red; } body { display: none' } }).color.load(), color.DEFAULT);
});

test('save writes a color in the form "#rrggbb", and throws for anything else', async () => {
  const { color: saving, writes } = loadColor();
  await saving.save('#1d4ed8');
  assert.deepEqual(writes, [{ [KEY]: '#1d4ed8' }]);
  for (const broken of [undefined, 'red', '#fe0', '#1D4ED8', 'red; } body { display: none']) {
    assert.throws(() => saving.save(broken), TypeError, String(broken));
  }
  assert.equal(writes.length, 1);
});

test('follow shows the saved color, then each change to it, and nothing else', async () => {
  const { color: following, change } = loadColor({ saved: { [KEY]: '#1d4ed8' } });
  const shown = [];
  following.follow((code) => shown.push(code));
  await settle();
  change('#c62828');
  // A change to another setting, or to another storage area, is not the color.
  change('#6a1b9a', { key: 'other' });
  change('#6a1b9a', { area: 'sync' });
  change('red; } body { display: none');
  // The color was removed.
  change(undefined);
  assert.deepEqual(shown, ['#1d4ed8', '#c62828', color.DEFAULT, color.DEFAULT]);
});

test('follow keeps a change that arrives before the first read finishes', async () => {
  const { color: following, change, finishRead } = loadColor({ saved: { [KEY]: '#1d4ed8' }, readLater: true });
  const shown = [];
  following.follow((code) => shown.push(code));
  change('#c62828');
  finishRead();
  await settle();
  assert.deepEqual(shown, ['#c62828']);
});

test('follow reports a read that fails, and leaves the page on the default', async () => {
  const { color: following, errors } = loadColor({ readFails: true });
  const shown = [];
  following.follow((code) => shown.push(code));
  await settle();
  assert.deepEqual(shown, []);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Ad Highlighter \(highlight color\):.*storage is broken/);
});
