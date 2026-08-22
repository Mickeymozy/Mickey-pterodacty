const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPteroLimitsFromPackage, isValidGitUrl } = require('../utils/serverHelper');

test('validates public git repository URLs', () => {
  assert.equal(isValidGitUrl('https://github.com/example/bot.git'), true);
  assert.equal(isValidGitUrl('https://github.com/example/bot'), true);
  assert.equal(isValidGitUrl('https://github.com/example/bot?token=secret'), false);
  assert.equal(isValidGitUrl('not-a-url'), false);
});

test('converts package resources to Pterodactyl limits', () => {
  assert.deepEqual(buildPteroLimitsFromPackage({ cpu: 1, ram: 512, disk: 2 }), {
    memory: 512,
    swap: 0,
    disk: 2048,
    io: 500,
    cpu: 100,
    oom_disabled: false
  });
});
