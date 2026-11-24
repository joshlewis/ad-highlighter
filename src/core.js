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

  // The attribute that marks a part with its own background that spans the
  // full width of the ad, such as the card the site draws the post on, the
  // bar under a link, or the space beside a photo. src/highlight.css paints
  // it like the ad, because otherwise it would hide the highlight color.
  const FULL_WIDTH = 'data-ad-highlighter-full-width';

  // The attribute that marks an element around a part that keeps its colors
  // and holds text. The element has no text of its own. src/highlight.css
  // lets it keep the site's text color. Text in a kept part often takes its
  // color from around it, so this way it gets the site's color.
  const AROUND_KEPT = 'data-ad-highlighter-around-kept';

  // Every attribute that core.js puts on a part of an ad.
  const PART_MARKS = [KEEP_COLORS, FULL_WIDTH, AROUND_KEPT];

  // What happens to one part of an ad. Each kind lists the marks it gives
  // the part.
  const PART = Object.freeze({
    // Takes the ad's text color.
    AD_TEXT: Object.freeze({ keepColors: false, fullWidth: false }),
    // Keeps the site's colors.
    KEEP_COLORS: Object.freeze({ keepColors: true, fullWidth: false }),
    // Spans the full width of the ad, and is painted like the ad.
    FULL_WIDTH: Object.freeze({ keepColors: false, fullWidth: true }),
  });

  // Start watching the page. site describes one site:
  //
  //   site.ways          The ways the site shows ads, as an array. A site
  //                      often shows ads in more than one way at the same
  //                      time, for example while it tests new page markup
  //                      on some of its users. Each way is an object:
  //
  //                        posts()     Returns the posts on the page now
  //                                    that this way checks, as an array,
  //                                    a NodeList or an HTMLCollection.
  //                        isAd(post)  Returns true when post is an ad.
  //                                    Any other value means it is not.
  //
  //                      A post is an ad when any way finds that it is one.
  //                      An error in one way does not stop the others.
  //   site.keepColors    Optional. A CSS selector for more parts of an ad
  //                      that keep the site's own colors, such as photos
  //                      and videos.
  //
  // watch() throws, before it starts, when site is not in this form.
  function watch(site) {
    checkSite(site);
    // Copies, so a later change to site cannot undo the checks above.
    const ways = Object.freeze([...site.ways]);
    const keepColors = site.keepColors;

    // Show the first error from each part of the site file in the console,
    // once, so a broken part is easy to find without filling the console.
    const errorsShown = new Set();
    function showError(where, error) {
      if (errorsShown.has(where)) return;
      errorsShown.add(where);
      console.error(`Ad Highlighter (${where}):`, error);
    }

    // The posts on the page now that one way finds to be ads. A post that
    // causes an error is not an ad, so an error in one post cannot stop the
    // scan of the others. Ways often share one posts() function, so
    // postsFrom keeps each function's posts for the rest of the scan.
    function adsFoundBy(way, index, postsFrom) {
      const where = `site.ways[${index}]`;
      let posts = postsFrom.get(way.posts);
      if (posts === undefined) {
        posts = [];
        try {
          const found = way.posts();
          if (typeof found?.[Symbol.iterator] !== 'function') {
            throw new TypeError('posts() must return an array, a NodeList or an HTMLCollection.');
          }
          posts = Array.from(found);
        } catch (error) {
          showError(where, error);
        }
        postsFrom.set(way.posts, posts);
      }
      return posts.filter((post) => {
        if (!(post instanceof Element)) {
          showError(where, new TypeError('posts() returned something that is not an element.'));
          return false;
        }
        try {
          return way.isAd(post) === true;
        } catch (error) {
          showError(where, error);
          return false;
        }
      });
    }

    // The posts that the last scan marked as ads.
    let marked = new Set();

    // Sites often reuse the same page elements for different posts as you
    // scroll, so every scan marks ads AND unmarks everything else. All the
    // checks run first and all the changes after, so the browser lays out
    // the page only once per scan.
    function scan() {
      const postsFrom = new Map();
      const adPosts = new Set(ways.flatMap((way, index) => adsFoundBy(way, index, postsFrom)));
      const ads = [...adPosts].map((post) => {
        const parts = adParts(post, keepColors);
        return [post, parts, aroundKept(post, parts)];
      });

      // Unmark each post that this scan did not find to be an ad, including
      // a post that is no longer one of the site's posts. Its parts lose
      // their marks too, so a post that is not an ad keeps nothing that this
      // extension added.
      for (const post of marked) {
        if (adPosts.has(post)) continue;
        post.removeAttribute(MARK);
        unmarkParts(post, new Set());
      }
      marked = adPosts;
      for (const [post, parts, around] of ads) {
        post.toggleAttribute(MARK, true);
        // A part that this scan did not reach, such as one inside a part
        // that now keeps its colors, loses the marks of an earlier scan.
        unmarkParts(post, new Set(parts.map(([part]) => part)));
        for (const [part, kind] of parts) {
          part.toggleAttribute(KEEP_COLORS, kind.keepColors);
          part.toggleAttribute(FULL_WIDTH, kind.fullWidth);
          part.toggleAttribute(AROUND_KEPT, around.has(part));
        }
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

  // Remove every part mark inside post, except from the elements in keep.
  function unmarkParts(post, keep) {
    for (const part of post.querySelectorAll(PART_MARKS.map((mark) => `[${mark}]`).join(', '))) {
      if (keep.has(part)) continue;
      for (const mark of PART_MARKS) part.removeAttribute(mark);
    }
  }

  // Throw when site is not in the form that watch() describes.
  function checkSite(site) {
    if (!Array.isArray(site?.ways) || site.ways.length === 0) {
      throw new TypeError('Ad Highlighter: site.ways must be an array with at least one way.');
    }
    site.ways.forEach((way, index) => {
      if (typeof way?.posts !== 'function' || typeof way.isAd !== 'function') {
        throw new TypeError(`Ad Highlighter: site.ways[${index}] needs the functions posts() and isAd(post).`);
      }
    });
    if (site.keepColors === undefined) return;
    try {
      document.createDocumentFragment().querySelector(site.keepColors);
    } catch {
      throw new SyntaxError(`Ad Highlighter: site.keepColors is not a CSS selector: ${site.keepColors}`);
    }
  }

  // The elements in an ad, each paired with what happens to it (a value
  // of PART). Each scan decides again, because sites reuse page elements.
  function adParts(post, selector) {
    // The boxes of the parts that match selector, such as photos and videos.
    const keptBoxes = selector === undefined ? [] : [...post.querySelectorAll(selector)].map((kept) => kept.getBoundingClientRect());
    const parts = [];
    const walker = document.createTreeWalker(post, NodeFilter.SHOW_ELEMENT);
    let part = walker.nextNode();
    while (part !== null) {
      const kind = partKind(part, post, selector, keptBoxes);
      parts.push([part, kind]);
      // Everything inside a part that keeps its colors keeps them too, and
      // the inside of an icon has no text, so skip to the next part after it.
      if (kind.keepColors || part instanceof SVGElement) {
        part = walker.nextSibling();
        while (part === null && walker.parentNode() !== null) part = walker.nextSibling();
      } else {
        part = walker.nextNode();
      }
    }
    return parts;
  }

  // What happens to one part of post. keptBoxes holds the boxes of the
  // parts that match selector. These parts keep the site's colors:
  //
  //   - a part that matches the site's keepColors selector, such as a photo;
  //   - a layer placed on top of one of those, such as a time label on a
  //     video, because the ad's text color on a photo would be hard to read;
  //   - a part that draws a picture as its background, like a photo does.
  //
  // A part that paints a background color of its own, at least half
  // opaque, is painted like the ad when it spans the full width of the
  // post, such as the card or the bar under a link. A narrower part with a
  // background, such as a button, keeps the site's colors, and so does any
  // other layer, so that the highlight color never covers a photo.
  function partKind(part, post, selector, keptBoxes) {
    if (selector !== undefined && part.matches(selector)) return PART.KEEP_COLORS;
    const style = getComputedStyle(part);
    const onTop = style.position === 'absolute' || style.position === 'fixed';
    if (onTop && overlapsAny(part.getBoundingClientRect(), keptBoxes)) return PART.KEEP_COLORS;
    if (style.backgroundImage.includes('url(')) return PART.KEEP_COLORS;
    // src/highlight.css paints a full-width part with an image layer, never
    // a background color, so this reads the site's color, not the
    // highlight color.
    if (colorOpacity(style.backgroundColor) < 0.5) return PART.AD_TEXT;
    return spansWidth(part, post) && !onTop ? PART.FULL_WIDTH : PART.KEEP_COLORS;
  }

  // True when box overlaps one of boxes.
  function overlapsAny(box, boxes) {
    return boxes.some(
      (other) => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top,
    );
  }

  // The elements between post and each part in parts that keeps its colors
  // and holds text, leaving out elements with text of their own. A photo
  // holds no text, so the elements around it need no mark. An element with
  // text of its own takes the ad's text color, so its text stays readable.
  function aroundKept(post, parts) {
    const around = new Set();
    for (const [part, kind] of parts) {
      if (!kind.keepColors || visibleText(part.textContent) === '') continue;
      for (let element = part.parentElement; element !== post; element = element.parentElement) {
        if (!hasOwnText(element)) around.add(element);
      }
    }
    return around;
  }

  // True when element itself holds text, not only its children.
  function hasOwnText(element) {
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && visibleText(node.nodeValue) !== '') return true;
    }
    return false;
  }

  // True when element is as wide as post, to within one pixel.
  function spansWidth(element, post) {
    return Math.abs(element.getBoundingClientRect().width - post.getBoundingClientRect().width) <= 1;
  }

  // The opacity, from 0 to 1, of a computed CSS color such as
  // "rgba(0, 0, 0, 0.5)", "rgb(0, 0, 0)" or "color(display-p3 0 0 0 / 0.5)".
  // A color with no opacity value is fully opaque. The browser always
  // writes the opacity of a computed color as a number, never a percent.
  function colorOpacity(color) {
    if (color.includes('/')) return parseFloat(color.slice(color.lastIndexOf('/') + 1));
    if (color.startsWith('rgba(')) return parseFloat(color.split(',')[3]);
    return 1;
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

  // The elements in post that a reader can see (see isVisible) and whose
  // whole text is a label, as isLabelText decides. labels is a Set such as
  // new Set(['Ad']), and separators is optional. An element inside a part
  // that matches the CSS selector notALabel is skipped. Use notALabel for
  // the places where the same word can be part of the post itself, such as
  // the post's text or a link.
  function findLabels(post, labels, notALabel, separators) {
    const found = [];
    const walker = document.createTreeWalker(post, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      // The first test is fast and rules out almost every piece of text.
      if (!isLabelText(node.nodeValue, labels, separators)) continue;
      const element = node.parentElement;
      if (
        isLabelText(element.textContent, labels, separators) &&
        !insideWithin(element, notALabel, post) &&
        isVisible(element, post)
      ) {
        found.push(element);
      }
    }
    return found;
  }

  // True when text is one of labels, a Set such as new Set(['Ad']), after
  // visibleText cleans it. separators is optional: a regular expression such
  // as /[·•]/. With it, text also counts when one of its parts between
  // separators is a label, as in "Sponsored · Paid for by Example".
  function isLabelText(text, labels, separators) {
    if (separators === undefined) return labels.has(visibleText(text));
    return text.split(separators).some((part) => labels.has(visibleText(part)));
  }

  // text without spaces at either end and without characters that never
  // show, such as zero-width spaces. Sites hide those inside labels to stop
  // scripts from reading them.
  function visibleText(text) {
    return text.replace(/\p{Default_Ignorable_Code_Point}/gu, '').trim();
  }

  // True when a reader can see element inside container. The element must
  // be at least 2 pixels wide and high and lie inside the container's box,
  // and CSS must not hide it or make it fully see-through. A site can hide a
  // copy of its ad label in a normal post to confuse scripts, so a label
  // that nobody can see must never count.
  function isVisible(element, container) {
    const box = element.getBoundingClientRect();
    const outer = container.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) return false;
    const inside =
      box.left >= outer.left - 1 &&
      box.right <= outer.right + 1 &&
      box.top >= outer.top - 1 &&
      box.bottom <= outer.bottom + 1;
    return inside && element.checkVisibility({ opacityProperty: true, visibilityProperty: true });
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

  return { watch, outermost, findOwn, insideWithin, findLabels, isLabelText, visibleText, isVisible, onSameLine };
})();
