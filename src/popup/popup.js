// Ad Highlighter: the popup, where a person picks the highlight color.
//
// Each change shows on every open X and Facebook tab at once:
// src/page-color.js follows the saved color.

(() => {
  'use strict';

  const color = adHighlighterColor;

  // The colors a person can pick with one click. The first is the default.
  // The last row is deep colors, which get white text.
  const SWATCHES = [
    ['Yellow', color.DEFAULT],
    ['Orange', '#ffa53a'],
    ['Coral', '#ff6f61'],
    ['Pink', '#ff8ad8'],
    ['Lavender', '#c4a5ff'],
    ['Sky blue', '#6cc4ff'],
    ['Mint', '#5ef2b0'],
    ['Lime', '#c5f230'],
    ['Red', '#c62828'],
    ['Purple', '#6a1b9a'],
    ['Blue', '#1d4ed8'],
    ['Green', '#1b5e20'],
  ];

  const preview = document.getElementById('preview');
  const textNote = document.getElementById('text-note');
  const swatches = document.getElementById('swatches');
  const hue = document.getElementById('hue');
  const saturation = document.getElementById('saturation');
  const lightness = document.getElementById('lightness');
  const hex = document.getElementById('hex');
  const hexHelp = document.getElementById('hex-help');
  const reset = document.getElementById('reset');
  const status = document.getElementById('status');

  for (const [name, swatchColor] of SWATCHES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'swatch';
    button.dataset.color = swatchColor;
    button.title = name;
    button.setAttribute('aria-label', name);
    button.style.backgroundColor = swatchColor;
    button.addEventListener('click', () => pick(swatchColor, { save: 'now' }));
    swatches.append(button);
  }

  // The color on show, in the form "#rrggbb".
  let current = color.DEFAULT;

  // Show picked everywhere in the popup, except in the control it came from,
  // so that control does not jump while a person uses it.
  function show(picked, from) {
    current = picked;
    const text = color.textFor(picked);
    preview.style.backgroundColor = picked;
    preview.style.color = text;
    textNote.textContent = `Ads get ${text === color.DARK_TEXT ? 'dark' : 'white'} text on this color.`;
    for (const button of swatches.children) {
      button.setAttribute('aria-pressed', String(button.dataset.color === picked));
    }
    if (from !== 'sliders') {
      [hue.value, saturation.value, lightness.value] = color.hexToHsl(picked);
    }
    if (from !== 'hex') {
      hex.value = picked;
      markHex(true);
    }
    paintTracks();
  }

  // The color waiting to be saved, or null.
  let unsaved = null;
  // True when a frame is already asked to save it.
  let frameAsked = false;

  // Show picked and save it. A slider sends many changes a second while a
  // person drags it, so its changes are saved at most once a frame.
  function pick(picked, { from, save }) {
    show(picked, from);
    unsaved = picked;
    if (save === 'now') saveNow();
    else if (!frameAsked) {
      frameAsked = true;
      requestAnimationFrame(() => {
        frameAsked = false;
        saveNow();
      });
    }
  }

  function saveNow() {
    if (unsaved === null) return;
    const picked = unsaved;
    unsaved = null;
    color.save(picked).then(
      () => {
        status.textContent = '';
      },
      (error) => {
        status.textContent = 'Ad Highlighter could not save this color.';
        console.error('Ad Highlighter (highlight color):', error);
      },
    );
  }

  // Each slider's track shows the colors that slider can make, with the
  // other two sliders where they are.
  function paintTracks() {
    const [h, s, l] = [hue.value, saturation.value, lightness.value];
    hue.style.setProperty(
      '--track',
      `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360].map((at) => `hsl(${at} ${s}% ${l}%)`).join(', ')})`,
    );
    saturation.style.setProperty('--track', `linear-gradient(to right, hsl(${h} 0% ${l}%), hsl(${h} 100% ${l}%))`);
    lightness.style.setProperty('--track', `linear-gradient(to right, hsl(${h} ${s}% 0%), hsl(${h} ${s}% 50%), hsl(${h} ${s}% 100%))`);
  }

  function markHex(valid) {
    hex.setAttribute('aria-invalid', String(!valid));
    hexHelp.classList.toggle('error', !valid);
  }

  function fromSliders() {
    return color.hslToHex(Number(hue.value), Number(saturation.value), Number(lightness.value));
  }

  for (const slider of [hue, saturation, lightness]) {
    slider.addEventListener('input', () => pick(fromSliders(), { from: 'sliders' }));
    // A slider sends "change" when a person lets go of it.
    slider.addEventListener('change', () => pick(fromSliders(), { from: 'sliders', save: 'now' }));
  }

  // A full code shows at once. A code of three digits waits until the person
  // presses Enter or leaves the field, because it may be the start of six.
  hex.addEventListener('input', () => {
    const typed = color.parseHex(hex.value);
    const full = hex.value.trim().replace(/^#/, '').length === 6;
    if (typed !== null && full) {
      markHex(true);
      pick(typed, { from: 'hex', save: 'now' });
    }
  });
  hex.addEventListener('change', () => {
    const typed = color.parseHex(hex.value);
    if (typed === null) {
      markHex(false);
      return;
    }
    pick(typed, { save: 'now' });
  });

  reset.addEventListener('click', () => pick(color.DEFAULT, { save: 'now' }));

  // The popup closes as soon as a person clicks outside it. Save a change
  // that is still waiting for its frame.
  addEventListener('pagehide', saveNow);

  show(current);
  color.load().then(
    (saved) => show(saved),
    (error) => {
      status.textContent = 'Ad Highlighter could not read the saved color.';
      console.error('Ad Highlighter (highlight color):', error);
    },
  );
})();
