const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPteroLimitsFromPackage, isValidGitUrl, buildStartupCommand } = require('../utils/serverHelper');

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

test('keeps the startup command unchanged when no repository is configured', () => {
  const startupCommand = 'npm start';
  assert.equal(buildStartupCommand(startupCommand), startupCommand);
});

test('initializes a repository before running the original startup command', () => {
  const startupCommand = 'npm start';
  const repositoryStartup = buildStartupCommand(startupCommand, 'https://github.com/example/bot.git');

  assert.match(repositoryStartup, /git clone --depth=1/);
  assert.ok(repositoryStartup.endsWith('cd /home/container\nnpm start'));
});
