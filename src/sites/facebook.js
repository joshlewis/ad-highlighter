// Facebook (facebook.com)
//
// Facebook works hard to stop scripts from reading its ad label. Today the
// "Ad" under an advertiser's name is an SVG picture. The SVG points through
// a chain of other SVGs to a hidden <text> element that holds the word.
// Facebook has also shown the label in other forms, and it often tries new
// page markup on some users before others. So this file has several ways
// to find ads, and a post is an ad when any one of them finds it. It never
// uses Facebook's generated class names.
//
// The ways for posts in the feed each read the label ("Ad" or "Sponsored")
// in a different form. Facebook splits the line under a name with dots, and
// sometimes the label shares its element with the rest of the line, as in
// "Sponsored · Paid for by Example" on ads about social issues or politics.
// So each part between dots counts on its own.
//
//   1. An SVG that draws the label.
//   2. A hidden label that screen readers read.
//   3. Plain text.
//
// Each of these counts the label only when a reader can see it on the
// author's line or the line just under it, where Facebook shows the label.
// The same word anywhere else, such as in the post's text or a shared post,
// never counts. If Facebook moves the label, these ways stop finding ads
// instead of marking normal posts.
//
// A fourth way finds the "Sponsored" box at the side of the page.

(() => {
  'use strict';

  // The exact text of Facebook's ad label, in English. If your Facebook is
  // in another language, add the words it shows on ads here.
  const AD_LABELS = new Set(['Ad', 'Sponsored']);

  // The element around each post in the feed. Facebook has used each of
  // these, so all of them count. A post inside another post is part of that
  // post, so only the outermost count.
  const FEED_POST = '[data-virtualized], [aria-posinset], [data-pagelet^="FeedUnit"]';

  // Headings. The first heading in a post, outside a post shared inside it,
  // is the author's name.
  const HEADING = 'h1, h2, h3, h4, h5, h6';

  // The parts of a post that hold the text its author wrote. Facebook tags
  // them with these attributes. The label's word inside them is part of the
  // post, not the label.
  const POST_TEXT = '[data-ad-rendering-role="story_message"], [data-ad-preview="message"]';

  // Photos and videos.
  const MEDIA = 'img, video';

  // The dots that Facebook puts between the parts of a line.
  const DOTS = /[·•]/;

  function feedPosts() {
    return adHighlighter.outermost(FEED_POST);
  }

  // True when a reader can see some element in labels on the author's line
  // or the line just under it. A label inside a heading is part of a name,
  // and a label in the post's text is part of the post, so those never
  // count. A shared post's label sits far below this post's name, so it
  // never counts either.
  function labelUnderAuthor(post, labels) {
    if (labels.length === 0) return false;
    const author = adHighlighter.findOwn(post, HEADING, FEED_POST);
    if (author === null) return false;
    // When the name is itself a label word, a label could be a copy of the
    // name, such as on the profile picture, so nothing counts.
    if (AD_LABELS.has(adHighlighter.visibleText(author.textContent))) return false;
    const name = author.getBoundingClientRect();
    const line = lineHeight(author);
    return labels.some((label) => {
      if (adHighlighter.insideWithin(label, `${HEADING}, ${POST_TEXT}`, post)) return false;
      if (!adHighlighter.isVisible(label, post)) return false;
      const box = label.getBoundingClientRect();
      const middle = box.top + box.height / 2;
      return middle >= name.top && middle <= name.bottom + line;
    });
  }

  // The height of one line of text in heading, measured on the page, or 0
  // when the heading has no text. A long name can take two lines, and the
  // line under the name must not grow with it.
  function lineHeight(heading) {
    const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (adHighlighter.visibleText(node.nodeValue) === '') continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getClientRects()[0]?.height ?? 0;
    }
    return 0;
  }

  // True when text is Facebook's ad label, alone or as one part of a line
  // split with dots.
  function isLabel(text) {
    return adHighlighter.isLabelText(text, AD_LABELS, DOTS);
  }

  // The element that a <use> element points to, or null.
  function useTarget(use) {
    const link = use.getAttribute('href') ?? use.getAttribute('xlink:href') ?? '';
    return link.startsWith('#') ? document.getElementById(link.slice(1)) : null;
  }

  // The text that an SVG draws, including text that it shows through <use>
  // elements, however many steps the chain of <use> elements takes.
  function svgText(svg) {
    const visited = new Set();
    function textOf(element) {
      if (element === null || visited.has(element)) return '';
      visited.add(element);
      if (element.tagName === 'text') return element.textContent;
      let text = '';
      for (const part of element.querySelectorAll('text, use')) {
        text += part.tagName === 'text' ? part.textContent : textOf(useTarget(part));
      }
      return text;
    }
    return textOf(svg);
  }

  // The text that screen readers read for element. Like a screen reader, it
  // reads the elements that aria-labelledby names, and when none of them
  // exists, aria-label. It is empty when element has neither.
  function hiddenLabel(element) {
    const ids = (element.getAttribute('aria-labelledby') ?? '').trim().split(/\s+/);
    const named = ids.map((id) => document.getElementById(id)).filter((found) => found !== null);
    if (named.length > 0) return named.map((found) => found.textContent).join(' ');
    return element.getAttribute('aria-label') ?? '';
  }

  adHighlighter.watch({
    ways: [
      // 1. An SVG that draws the label.
      {
        posts: feedPosts,
        isAd(post) {
          const labels = [...post.querySelectorAll('svg')].filter((svg) => isLabel(svgText(svg)));
          return labelUnderAuthor(post, labels);
        },
      },

      // 2. A hidden label that screen readers read. Screen readers skip a
      // part marked aria-hidden, so a label there does not count.
      {
        posts: feedPosts,
        isAd(post) {
          const labels = [...post.querySelectorAll('[aria-labelledby], [aria-label]')].filter(
            (element) => !adHighlighter.insideWithin(element, '[aria-hidden="true"]', post) && isLabel(hiddenLabel(element)),
          );
          return labelUnderAuthor(post, labels);
        },
      },

      // 3. Plain text. Text inside an SVG is the first way's job.
      {
        posts: feedPosts,
        isAd: (post) => labelUnderAuthor(post, adHighlighter.findLabels(post, AD_LABELS, 'svg', DOTS)),
      },

      // 4. The box at the side of the page whose heading is "Sponsored". The
      // heading must be the section's own, not one in a section inside it,
      // and a reader must see it. The box never holds feed posts, so a
      // section that does is never the box.
      {
        posts: () => document.getElementsByTagName('section'),
        isAd(section) {
          if (section.querySelector(FEED_POST) !== null) return false;
          const heading = adHighlighter.findOwn(section, HEADING, 'section');
          return (
            heading !== null &&
            AD_LABELS.has(adHighlighter.visibleText(heading.textContent)) &&
            adHighlighter.isVisible(heading, section)
          );
        },
      },
    ],

    // Photos and videos keep Facebook's colors. (The core also keeps the
    // colors of a smaller part with its own background, such as a "Shop
    // now" button, and of a layer on a photo or video. It paints a part
    // with its own background that is as wide as the ad, such as the bar
    // under a link, like the ad.)
    keepColors: MEDIA,
  });
})();
