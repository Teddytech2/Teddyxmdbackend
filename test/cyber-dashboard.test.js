'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// This utility test stubs the existing status-card module so it can test the
// renderer's pure HTML helpers without opening SQLite or starting a browser.
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === './statusCard' && parent && parent.filename.endsWith('/utils/cyberDashboard.js')) {
    return { getMenuImageBuffer: () => Buffer.from(''), getSystemReport: async () => ({}), formatDuration: () => '1s', formatBytes: () => '1 MB' };
  }
  return originalLoad.apply(this, arguments);
};
const dashboard = require('../utils/cyberDashboard');
Module._load = originalLoad;

test('dashboard escapes dynamic HTML content', () => {
  assert.equal(dashboard.escapeHtml('<script>"x" & \'y\'</script>'), '&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;');
});

test('dashboard HTML includes brand, status, and dynamic uptime', () => {
  const stats = { uptime: '2d 3h 4m 5s', cpu: '4.2%', systemRam: '2 GB / 4 GB', ramFree: '2 GB', botRam: '100 MB', botHeap: '50 MB / 90 MB', node: 'v20.19.5', platform: 'Linux', hostPlatform: 'Heroku', load: '0.1 / 0.2 / 0.3', cpuCount: 2, startTime: 'test', time: 'Nov 18 2026' };
  const html = dashboard.dashboardHtml({ type: 'uptime', title: 'BOT UPTIME', detail: 'running', stats, menuImage: null });
  assert.match(html, /TEDDY-XMD/);
  assert.match(html, /ONLINE/);
  assert.match(html, /2d 3h 4m 5s/);
  assert.match(html, /Heroku/);
  assert.match(html, /Nov 18 2026/);
});
