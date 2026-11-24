// X (x.com, formerly Twitter)
//
// X changes its page markup often, so this file never uses X's generated
// class names and does not depend on one exact page structure. A post counts
// as an ad only when it shows X's ad label ("Ad" or "Promoted") AND one of
// two separate checks agrees:
//
//   1. The label sits on the same line as the author's name.
//      (This is where X puts the label today.)
//   2. The post has no timestamp of its own. (Normal posts show one. Ads
//      do not.)
//
// If X changes one of these things, the other check still works. Each check
// fails safe: if X changes its page so that a check no longer works, that
// check stops finding ads instead of marking normal posts.

(() => {
  'use strict';

  // The exact text of X's ad label, in English. If your X is in another
  // language, add the word it shows on ads here.
  const AD_LABELS = new Set(['Ad', 'Promoted']);

  // A post that X shows inside this post, such as a quoted post.
  const INNER_POST = 'div[role="link"], article';

  // The photos and videos in a post.
  const MEDIA = [
    '[data-testid="videoPlayer"]',
    '[data-testid="videoComponent"]',
    '[data-testid="tweetPhoto"]',
  ];

  // Places where the word "Ad" can be part of the post itself instead of
  // X's label. Text inside any of these is never treated as the label.
  const NOT_A_LABEL = [
    '[lang]', // text the author wrote (X tags it with its language)
    'a[href]', // names, handles, hashtags, links and link cards
    '[role="link"]', // other links
    INNER_POST,
    '[data-testid="tweetText"]',
    '[data-testid="User-Name"]',
    '[data-testid="card.wrapper"]',
    ...MEDIA,
  ].join(',');

  // True when at least one post on the page shows a timestamp of its own
  // with <time>. Check 2 counts only then: if X stopped using <time> for
  // timestamps, every post would pass it. A <time> is a post's own when the
  // nearest post around it is an outermost <article>, not a quoted post.
  // The loop stops at the first one it finds, so it is fast.
  function pageShowsOwnTimestamps() {
    for (const time of document.getElementsByTagName('time')) {
      const holder = time.closest(INNER_POST);
      if (holder?.matches('article') && holder.parentElement?.closest('article') === null) return true;
    }
    return false;
  }

  adHighlighter.watch({
    // X shows ads in one way today. Add a way here if X starts to show ads
    // in another way.
    ways: [
      {
        // X shows each post as an <article>. A post shown inside another
        // post is part of that post, so only the outermost articles count.
        posts: () => adHighlighter.outermost('article'),

        isAd(post) {
          const labels = adHighlighter.findLabels(post, AD_LABELS, NOT_A_LABEL);
          if (labels.length === 0) return false;

          // Check 2: the post shows no timestamp of its own.
          const ownTime = adHighlighter.findOwn(post, 'time', INNER_POST);
          if (ownTime === null && pageShowsOwnTimestamps()) return true;

          // Check 1: the label sits on the same line as the author's name.
          const author = adHighlighter.findOwn(post, '[data-testid="User-Name"]', INNER_POST);
          return author !== null && labels.some((label) => adHighlighter.onSameLine(label, author));
        },
      },
    ],

    // Photos and videos keep X's colors, so text drawn on top of them stays
    // readable. (The core also keeps the colors of a smaller part with its
    // own background, such as a "Watch now" button. It paints a part with
    // its own background that is as wide as the post like the ad.)
    keepColors: MEDIA.join(','),
  });
})();
