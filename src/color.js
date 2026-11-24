// Ad Highlighter: the highlight color.
//
// A person picks the color in the popup (src/popup/), and the extension
// keeps it with chrome.storage.local, on this computer only. The popup and
// the content scripts both load this file.

const adHighlighterColor = (() => {
  'use strict';

  // The color of an ad until a person picks another. src/highlight.css
  // repeats it, and DARK_TEXT, for the moment before the saved color is
  // read. test/color.test.js checks that the two files agree.
  const DEFAULT = '#ffe500';

  // The two text colors an ad can get: dark on a light color, white on a
  // dark one.
  const DARK_TEXT = '#0f1419';
  const LIGHT_TEXT = '#ffffff';

  // Where chrome.storage.local keeps the color.
  const KEY = 'highlightColor';

  // A color in the form "#rrggbb", in lowercase.
  const FORM = /^#[0-9a-f]{6}$/;

  // color in the form "#rrggbb", in lowercase. Anything else becomes
  // DEFAULT, so a broken saved value can never reach the page's CSS.
  function normalize(color) {
    return typeof color === 'string' && FORM.test(color.toLowerCase()) ? color.toLowerCase() : DEFAULT;
  }

  // The color a person typed as a hex code, as "#rrggbb", or null when the
  // text is not a color. The "#" is optional, and three digits are short
  // for six, so "fe0" means "#ffee00".
  function parseHex(text) {
    const digits = text.trim().replace(/^#/, '').toLowerCase();
    const long = digits.length === 3 ? [...digits].map((digit) => digit + digit).join('') : digits;
    return FORM.test(`#${long}`) ? `#${long}` : null;
  }

  // The "#rrggbb" color for a hue (0 to 360), a saturation (0 to 100) and a
  // lightness (0 to 100).
  function hslToHex(hue, saturation, lightness) {
    const s = saturation / 100;
    const l = lightness / 100;
    const reach = s * Math.min(l, 1 - l);
    const channel = (offset) => {
      const step = (offset + hue / 30) % 12;
      const value = l - reach * Math.max(-1, Math.min(step - 3, 9 - step, 1));
      return Math.round(value * 255).toString(16).padStart(2, '0');
    };
    return `#${channel(0)}${channel(8)}${channel(4)}`;
  }

  // The hue, saturation and lightness of a "#rrggbb" color, each rounded to
  // a whole number: the opposite of hslToHex.
  function hexToHsl(color) {
    const [red, green, blue] = channels(color);
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const lightness = (max + min) / 2;
    const range = max - min;
    if (range === 0) return [0, 0, Math.round(lightness * 100)];
    const saturation = range / (1 - Math.abs(2 * lightness - 1));
    let hue;
    if (max === red) hue = ((green - blue) / range + 6) % 6;
    else if (max === green) hue = (blue - red) / range + 2;
    else hue = (red - green) / range + 4;
    return [Math.round(hue * 60) % 360, Math.round(saturation * 100), Math.round(lightness * 100)];
  }

  // The red, green and blue of a "#rrggbb" color, each from 0 to 1.
  function channels(color) {
    return [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16) / 255);
  }

  // How bright a "#rrggbb" color looks, from 0 (black) to 1 (white). This
  // is the relative luminance that the WCAG accessibility rules define.
  function luminance(color) {
    const [red, green, blue] = channels(color).map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  }

  // The contrast between two "#rrggbb" colors, from 1 (none) to 21 (black
  // on white), as the WCAG accessibility rules define it.
  function contrast(a, b) {
    const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (lighter + 0.05) / (darker + 0.05);
  }

  // The text color for an ad painted color: DARK_TEXT or LIGHT_TEXT,
  // whichever has more contrast with it. A bright color gets dark text, and
  // a deep color gets white text. The contrast is never less than 4.3 to 1,
  // which a mid-tone teal gets.
  // (WCAG asks for 4.5 to 1 for normal text and 3 to 1 for large text.)
  function textFor(color) {
    return contrast(color, DARK_TEXT) >= contrast(color, LIGHT_TEXT) ? DARK_TEXT : LIGHT_TEXT;
  }

  // The saved color, or DEFAULT when there is none.
  async function load() {
    const saved = await chrome.storage.local.get(KEY);
    return normalize(saved[KEY]);
  }

  // Save color, in the form "#rrggbb", as the highlight color. Anything
  // else is a mistake in the caller, so it throws.
  function save(color) {
    if (typeof color !== 'string' || !FORM.test(color)) throw new TypeError(`Not a color in the form "#rrggbb": ${color}`);
    return chrome.storage.local.set({ [KEY]: color });
  }

  // Call show(color) with the saved color, and again each time it changes.
  function follow(show) {
    // A change can arrive before the first read finishes. The change is
    // newer, so the first read must not undo it.
    let changed = false;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !(KEY in changes)) return;
      changed = true;
      show(normalize(changes[KEY].newValue));
    });
    load().then(
      (color) => changed || show(color),
      (error) => console.error('Ad Highlighter (highlight color):', error),
    );
  }

  return Object.freeze({
    DEFAULT,
    DARK_TEXT,
    LIGHT_TEXT,
    normalize,
    parseHex,
    hslToHex,
    hexToHsl,
    contrast,
    textFor,
    load,
    save,
    follow,
  });
})();
