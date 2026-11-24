// Tests for manifest.json: the promises in the README's Privacy section, and
// the layout that every site's entry needs.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const manifest = require('../manifest.json');

const ROOT = path.join(__dirname, '..');

test('asks only for storage, to keep the highlight color, and runs no code outside the pages and the popup', () => {
  assert.deepEqual(manifest.permissions, ['storage']);
  for (const key of [
    'optional_permissions',
    'host_permissions',
    'optional_host_permissions',
    'background',
    'web_accessible_resources',
    'externally_connectable',
    'options_page',
    'options_ui',
  ]) {
    assert.equal(key in manifest, false, `manifest.json has "${key}"`);
  }
});

test('every site loads src/core.js, then the highlight color, then its own file, and every listed file exists', () => {
  assert.ok(manifest.content_scripts.length > 0);
  for (const entry of manifest.content_scripts) {
    assert.deepEqual(entry.js.slice(0, 3), ['src/core.js', 'src/color.js', 'src/page-color.js']);
    assert.equal(entry.js.length, 4);
    assert.equal(entry.css[0], 'src/highlight.css');
    for (const file of [...entry.js, ...entry.css]) {
      assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} is missing`);
    }
  }
});

test('the toolbar button opens the popup, and every file the popup loads exists', () => {
  const popup = manifest.action.default_popup;
  assert.equal(popup, 'src/popup/popup.html');
  for (const icon of Object.values(manifest.action.default_icon)) {
    assert.ok(fs.existsSync(path.join(ROOT, icon)), `${icon} is missing`);
  }
  const html = fs.readFileSync(path.join(ROOT, popup), 'utf8');
  const files = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(files, ['popup.css', '../color.js', 'popup.js']);
  for (const file of files) {
    assert.ok(fs.existsSync(path.join(ROOT, path.dirname(popup), file)), `${file} is missing`);
  }
});
