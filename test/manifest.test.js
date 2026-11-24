// Tests for manifest.json: the promises in the README's Privacy section, and
// the layout that every site's entry needs.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const manifest = require('../manifest.json');

const ROOT = path.join(__dirname, '..');

test('asks for no permissions and runs no code outside the pages', () => {
  for (const key of [
    'permissions',
    'optional_permissions',
    'host_permissions',
    'optional_host_permissions',
    'background',
    'web_accessible_resources',
    'externally_connectable',
  ]) {
    assert.equal(key in manifest, false, `manifest.json has "${key}"`);
  }
});

test('every site loads src/core.js first and src/highlight.css, and every listed file exists', () => {
  assert.ok(manifest.content_scripts.length > 0);
  for (const entry of manifest.content_scripts) {
    assert.equal(entry.js[0], 'src/core.js');
    assert.ok(entry.css.includes('src/highlight.css'));
    for (const file of [...entry.js, ...entry.css]) {
      assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} is missing`);
    }
  }
});
