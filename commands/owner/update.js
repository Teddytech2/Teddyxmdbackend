'use strict';

/**
 * Owner-only source updater for imteddytech/Teddyxmdbackend.
 * Usage: .update
 * Does not use eval or execute repository scripts. Runtime secrets, databases,
 * sessions, deployment config and package manifests are deliberately preserved.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const axios = require('axios');
const execFileAsync = promisify(execFile);

const OWNER = 'imteddytech';
const REPO = 'Teddyxmdbackend';
const BRANCH = 'main';
const ROOT = process.cwd();
const STATE_FILE = path.join(ROOT, '.teddy-update-state.json');
const ALLOWED_ROOT_FILES = new Set(['index.js', 'handler.js', 'database.js', 'obfuscator.js']);
const ALLOWED_DIRS = new Set(['commands', 'utils', 'docs', 'test']);
const SKIP_NAMES = new Set([
  'node_modules', '.git', '.github', '.env', '.env.local', '.env.production',
  'sessions', 'session', 'auth_info', 'auth_info_baileys', 'store', 'data',
  'logs', 'coverage', 'teddy.db', 'teddy.db-shm', 'teddy.db-wal',
  'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'config.js', 'app.json', 'Procfile'
]);
let running = false;

function safeTarget(root, relative) {
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Unsafe archive path');
  return target;
}

async function getLatestCommit() {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/commits/${BRANCH}`;
  const response = await axios.get(url, {
    timeout: 20000,
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'TeddyXMD-Updater' }
  });
  return response.data.sha;
}

function shouldSkip(relative) {
  const parts = relative.split(/[\\/]/);
  return parts.some(part => SKIP_NAMES.has(part)) || parts.some(part => part.startsWith('.env'));
}

async function copyAllowed(sourceRoot, destinationRoot, relative = '') {
  const entries = await fs.promises.readdir(sourceRoot, { withFileTypes: true });
  for (const entry of entries) {
    const rel = path.posix.join(relative, entry.name);
    if (shouldSkip(rel)) continue;
    const source = path.join(sourceRoot, entry.name);
    const destination = safeTarget(destinationRoot, rel);
    if (entry.isDirectory()) {
      // Only sync the known application source trees.
      if (!relative && !ALLOWED_DIRS.has(entry.name)) continue;
      await fs.promises.mkdir(destination, { recursive: true });
      await copyAllowed(source, destination, rel);
    } else if (entry.isFile()) {
      const top = rel.split('/')[0];
      if (relative === '' && !ALLOWED_ROOT_FILES.has(entry.name)) continue;
      if (relative !== '' && !ALLOWED_DIRS.has(top)) continue;
      await fs.promises.mkdir(path.dirname(destination), { recursive: true });
      await fs.promises.copyFile(source, destination);
    }
  }
}

module.exports = {
  name: 'update',
  aliases: ['upgrade', 'fetchupdate'],
  category: 'owner',
  description: 'Fetch the latest Teddy XMD backend source from GitHub',
  usage: '.update',
  // Deliberately enforce silently inside execute: non-owners must not receive
  // an owner-only warning or any information about this maintenance command.
  ownerOnly: false,
  async execute(sock, msg, args, extra) {
    if (!extra?.isOwner && !extra?.isSudo && !msg?.key?.fromMe) return;
    if (running) return extra.reply('⏳ An update check is already running.');
    running = true;
    let tempDir;
    try {
      if (extra.react) await extra.react('⏳').catch(() => {});
      const latestSha = await getLatestCommit();
      let installedSha = null;
      try { installedSha = JSON.parse(await fs.promises.readFile(STATE_FILE, 'utf8')).sha || null; } catch (_) {}

      // On the first run, compare against a saved baseline only after fetching
      // the latest archive; this allows the command to perform an initial sync.
      if (installedSha && installedSha === latestSha) {
        if (extra.react) await extra.react('✅').catch(() => {});
        return extra.reply('✅ Bot is up to date.');
      }

      const archiveUrl = `https://api.github.com/repos/${OWNER}/${REPO}/tarball/${BRANCH}`;
      const archive = await axios.get(archiveUrl, {
        responseType: 'arraybuffer', timeout: 60000,
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'TeddyXMD-Updater' }
      });
      tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'teddy-update-'));
      const archivePath = path.join(tempDir, 'source.tar.gz');
      const extractDir = path.join(tempDir, 'extract');
      await fs.promises.writeFile(archivePath, Buffer.from(archive.data));
      await fs.promises.mkdir(extractDir, { recursive: true });
      await execFileAsync('tar', ['-xzf', archivePath, '-C', extractDir, '--strip-components=1'], { timeout: 60000 });

      // Stage to a sibling directory, then copy only whitelisted source trees.
      await copyAllowed(extractDir, ROOT);
      await fs.promises.writeFile(STATE_FILE, JSON.stringify({ sha: latestSha, updatedAt: new Date().toISOString() }, null, 2));
      // Keep update details private: do not send a chat message announcing
      // fetched files or the restart. The owner can see the reaction only.
      if (extra.react) await extra.react('✅').catch(() => {});
      setTimeout(() => process.exit(1), 500);
    } catch (error) {
      console.error('[UPDATE] Failed:', error);
      if (extra.react) await extra.react('❌').catch(() => {});
      return extra.reply(`❌ Update failed: ${String(error.message || error).slice(0, 250)}`);
    } finally {
      running = false;
      if (tempDir) await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
};
