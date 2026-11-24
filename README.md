# Ad Highlighter

A Chrome extension that paints ads bright yellow, so you can tell at a glance what is an ad and what isn't.

![Without Ad Highlighter, an ad on X looks like the posts around it. With Ad Highlighter, the same ad is bright yellow with dark text, and the posts around it stay as they were.](screenshots/before-after.png)

**Works on:** X (x.com)

## What it does

On a supported site, Ad Highlighter finds the posts that the site labels as ads and paints each one bright yellow with dark text. Every other post stays exactly as it was. Inside an ad, photos, videos and parts with their own background (such as a "Shop now" button) keep their own colors, so their text stays readable.

That is all it does. There are no settings.

## Privacy

Ad Highlighter never phones home and stores nothing about you.

- It makes no network requests of any kind.
- It saves nothing: no settings, no history, no cookies, no data.
- It asks Chrome for no permissions beyond access to the sites it supports, and runs nowhere else.
- On those sites, it reads the page as it loads and as new posts appear, finds the ads, and colors them. Nothing else.

The code is short, so you can check this yourself in [`src/`](src/).

## Performance

It has no noticeable effect on speed. Measured on a live X feed with about 20 posts loaded:

- While you scroll, it scans the page about 9 times a second. A scan takes about 0.8 ms on average and 3 ms at most. One frame on a 60 Hz screen lasts 16.7 ms.
- In all, it uses less than 1% of the browser's time while you scroll, and less than 0.2% while the page sits still.
- The yellow coloring adds no cost that could be measured when the browser redraws the page.

## Install

Ad Highlighter is not in the Chrome Web Store, so you load it from a folder.

1. Download this repository: click **Code**, then **Download ZIP**, and unzip it. Or clone it with git.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the folder.
5. Reload any open x.com tab.

It also works in Brave, and it should work in other browsers built on Chrome, such as Edge and Arc.

## How it finds ads on X

X marks each ad with the word "Ad" on the same line as the author's name (older ads say "Promoted"), and ads show no timestamp. A post is highlighted only when it has that label and at least one of these two checks agrees:

1. The label is on the same line as the author's name.
2. The post has no timestamp of its own.

If X changes one of these, the other check still finds ads. Each check fails safe: if a change on X stops a check from working, that check stops finding ads instead of marking normal posts.

The label counts only when the word stands alone. Inside a post's text, a name, a link, a quoted post, a link card, a photo or a video, it never counts.

The extension reads X's English labels. If your X is in another language, add the word X shows on ads to `AD_LABELS` in [`src/sites/x.js`](src/sites/x.js).

## Adding a site

Each site is one small file in `src/sites/`. To add one:

1. Copy `src/sites/x.js` to a new file, such as `src/sites/example.js`.
2. In it, write `posts()`, which returns the posts on the page, and `isAd(post)`, which returns true for an ad. The helpers in `src/core.js` cover the common cases.
3. Add an entry for the site to `content_scripts` in `manifest.json`. List `src/core.js` before the new file, and include `src/highlight.css`.
4. Add tests for the site to `test/`, like `test/x.test.js`. The shared code already has its own tests in `test/core.test.js`.

A site can also have its own CSS file for small changes to the look, like `src/sites/x.css`.

To run the tests, you need Node.js:

```sh
npm install
npx playwright install chromium
npm test
```

## License

MIT. See [LICENSE](LICENSE).
