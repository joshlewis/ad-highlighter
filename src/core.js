// Ad Highlighter: the part every site shares.
//
// Each file in src/sites/ describes one site and passes that description to
// adHighlighter.watch(). The core then scans the page whenever it changes
// and marks each ad with the data-ad-highlighter attribute.
// src/highlight.css paints marked ads.
//
// The extension makes no network requests and stores nothing. It only reads
// the page it runs on and marks the ads it finds there.

const adHighlighter = (() => {
  'use strict';

  // The attribute that marks an ad. src/highlight.css styles it.
  const MARK = 'data-ad-highlighter';

  // The attribute that marks a part of an ad that keeps the site's own
  // colors, such as a button or text drawn on top of a photo or video.
  const KEEP_COLORS = 'data-ad-highlighter-keep-colors';

  // Start watching the page. site describes one site:
  //
  //   site.posts()       Returns the posts on the page now, as an array or
  //                      a NodeList.
  //   site.isAd(post)    Returns true when post is an ad. Any other value
  //                      means the post is not an ad.
  //   site.keepColors    Optional. A CSS selector for more parts of an ad
  //                      that keep the site's own colors, such as photos
  //                      and videos.
  function watch(site) {
    // Show the first error from the site file in the console, once, so a
    // broken site file is easy to find without filling the console.
    let errorShown = false;
    function showError(error) {
      if (errorShown) return;
      errorShown = true;
      console.error('Ad Highlighter:', error);
    }

    // Decide one post. A post that causes an error is not an ad, so an
    // error in one post cannot stop the scan of the others.
    function read(post) {
      try {
        const ad = site.isAd(post) === true;
        return { post, ad, parts: ad ? keepColorsParts(post, site.keepColors) : [] };
      } catch (error) {
        showError(error);
        return { post, ad: false, parts: [] };
      }
    }

    // The posts that the last scan marked as ads.
    let marked = new Set();

    // Sites often reuse the same page elements for different posts as you
    // scroll, so every scan marks ads AND unmarks everything else. All the
    // checks run first and all the changes after, so the browser lays out
    // the page only once per scan.
    function scan() {
      let posts = [];
      try {
        posts = Array.from(site.posts());
      } catch (error) {
        showError(error);
      }
      const ads = posts.map(read).filter((result) => result.ad);
      const adPosts = new Set(ads.map((result) => result.post));

      // Unmark each post that this scan did not find to be an ad, including
      // a post that is no longer one of the site's posts. Its parts lose
      // their keep-colors marks too, so a post that is not an ad keeps
      // nothing that this extension added.
      for (const post of marked) {
        if (adPosts.has(post)) continue;
        post.removeAttribute(MARK);
        for (const part of post.querySelectorAll(`[${KEEP_COLORS}]`)) part.removeAttribute(KEEP_COLORS);
      }
      marked = adPosts;
      for (const { post, parts } of ads) {
        post.toggleAttribute(MARK, true);
        for (const [part, keep] of parts) part.toggleAttribute(KEEP_COLORS, keep);
      }
    }

    // Scan again whenever the page changes, at most once per frame.
    let scanQueued = false;
    function queueScan() {
      if (scanQueued) return;
      scanQueued = true;
      requestAnimationFrame(() => {
        scanQueued = false;
        scan();
      });
    }

    new MutationObserver(queueScan).observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    scan();
  }

  // The elements in an ad, each paired with true when it keeps the site's
  // own colors. A part keeps them when it paints a background of its own
  // that is at least half opaque (a button, a bar under a link card, a label
  // on a photo), because dark text on that background would be hard to
  // read. A part also keeps them when it matches the site's keepColors
  // selector. Each scan decides again, because sites reuse page elements.
  function keepColorsParts(post, selector) {
    const parts = [];
    const walker = document.createTreeWalker(post, NodeFilter.SHOW_ELEMENT);
    let part = walker.nextNode();
    while (part !== null) {
      const keep = (selector !== undefined && part.matches(selector)) || hasOwnBackground(part);
      parts.push([part, keep]);
      // Everything inside a part that keeps its colors keeps them too, and
      // the inside of an icon has no text, so skip to the next part after it.
      if (keep || part instanceof SVGElement) {
        part = walker.nextSibling();
        while (part === null && walker.parentNode() !== null) part = walker.nextSibling();
      } else {
        part = walker.nextNode();
      }
    }
    return parts;
  }

  // True when element paints a background that is at least half opaque.
  function hasOwnBackground(element) {
    return backgroundOpacity(getComputedStyle(element).backgroundColor) >= 0.5;
  }

  // The opacity, from 0 to 1, of a computed CSS color such as
  // "rgba(0, 0, 0, 0.5)", "rgb(0, 0, 0)" or "color(display-p3 0 0 0 / 0.5)".
  // A color with no opacity value is fully opaque.
  function backgroundOpacity(color) {
    let alpha = null;
    if (color.includes('/')) alpha = color.slice(color.lastIndexOf('/') + 1);
    else if (color.startsWith('rgba(')) alpha = color.split(',')[3];
    if (alpha === null) return 1;
    const value = parseFloat(alpha);
    return alpha.includes('%') ? value / 100 : value;
  }

  // True when element is, or sits inside, a part of post that matches
  // selector. post itself does not count.
  function insideWithin(element, selector, post) {
    const match = element.closest(selector);
    return match !== null && match !== post && post.contains(match);
  }

  // Helpers for site files.

  // The elements that match selector and are not inside another match.
  // Use it when a site shows a post inside another post, such as a quote.
  function outermost(selector) {
    return [...document.querySelectorAll(selector)].filter(
      (element) => !(element.parentElement && element.parentElement.closest(selector)),
    );
  }

  // The first element in post that matches selector and is not inside a
  // part that matches the CSS selector inner, or null. Use inner for a post
  // shown inside this post, such as a quote, so that its parts do not count
  // as parts of this post.
  function findOwn(post, selector, inner) {
    for (const element of post.querySelectorAll(selector)) {
      if (!insideWithin(element, inner, post)) return element;
    }
    return null;
  }

  // The elements in post whose whole text is one of labels, a Set such as
  // new Set(['Ad']). An element inside a part that matches the CSS selector
  // notALabel is skipped. Use notALabel for the places where the same word
  // can be part of the post itself, such as the post's text or a link.
  function findLabels(post, labels, notALabel) {
    const found = [];
    const walker = document.createTreeWalker(post, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      // The first test is fast and rules out almost every piece of text.
      if (!labels.has(node.nodeValue.trim())) continue;
      const element = node.parentElement;
      if (labels.has(element.textContent.trim()) && !insideWithin(element, notALabel, post)) {
        found.push(element);
      }
    }
    return found;
  }

  // True when the vertical middle of element a lies within the height of
  // element b, so a reader sees the two on the same line.
  function onSameLine(a, b) {
    const boxA = a.getBoundingClientRect();
    const boxB = b.getBoundingClientRect();
    if (boxA.height === 0 || boxB.height === 0) return false;
    const middleA = boxA.top + boxA.height / 2;
    return middleA >= boxB.top && middleA <= boxB.bottom;
  }

  return { watch, outermost, findOwn, findLabels, onSameLine };
})();
