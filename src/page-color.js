// Ad Highlighter: shows the highlight color on the page.
//
// This keeps one <style> element in the page that sets two CSS variables:
// the highlight color, and the text color that is easiest to read on it.
// src/highlight.css paints ads with them. The color is always in the form
// "#rrggbb" (see adHighlighterColor.normalize), so no other CSS can get in.

(() => {
  'use strict';

  const style = document.createElement('style');
  adHighlighterColor.follow((color) => {
    style.textContent = `:root {
      --ad-highlighter-color: ${color};
      --ad-highlighter-text: ${adHighlighterColor.textFor(color)};
    }`;
    if (!style.isConnected) (document.head ?? document.documentElement).append(style);
  });
})();
