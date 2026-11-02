'use strict';

/**
 * GitHub repository command.
 * Rebuilt as readable JavaScript from the original commands/tools/git.js.
 * Keeps the original command aliases and target repository.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const { sendButtons } = require('gifted-btns');
const { applyFont } = require('../../utils/fontConverter');
const database = require('../../database');

const GITHUB_USER = 'TEDDY-XMD';
const GITHUB_REPO = 'Teddyxmd';
const REPO_URL = `https://github.com/${GITHUB_USER}/${GITHUB_REPO}`;
const API_URL = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}`;
const REQUEST_TIMEOUT_MS = 10_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const LISTENER_TTL_MS = 120_000;

const getSetting = (key, fallback = '') => {
    try {
        const value = database.getBotSetting(key);
        return value == null || value === '' ? fallback : value;
    } catch {
        return fallback;
    }
};

function extractButtonResponseId(message) {
    const content = message?.message;
    if (!content) return null;

    const buttonId = content.buttonsResponseMessage?.selectedButtonId;
    if (buttonId) return buttonId;

    const templateId = content.templateButtonReplyMessage?.selectedId;
    if (templateId) return templateId;

    const nativeParams = content.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
    if (nativeParams) {
        try {
            const parsed = JSON.parse(nativeParams);
            return parsed.id || parsed.selectedId || parsed.button_id || null;
        } catch {
            return nativeParams;
        }
    }

    return null;
}

function getResponseSender(message) {
    return message?.key?.participant || message?.participant || message?.key?.remoteJid;
}

function buildMainButtons(repoUrl, prefix, requestId) {
    return [
        {
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
                display_text: '🔗 Open Repo',
                url: repoUrl,
            }),
        },
        {
            name: 'cta_copy',
            buttonParamsJson: JSON.stringify({
                display_text: '📋 Copy Repo URL',
                copy_code: repoUrl,
            }),
        },
        {
            id: `${prefix}ghzip_${requestId}`,
            text: '📦 Download ZIP',
        },
    ];
}

function formatRepositoryInfo(repo, branch) {
    const owner = repo.owner?.login || GITHUB_USER;
    const language = repo.language || 'N/A';
    const license = repo.license?.name || 'N/A';
    const visibility = repo.private ? '🔒 Private' : '🔓 Public';
    const sizeMb = (Number(repo.size || 0) / 1024).toFixed(2);

    return [
        '╭━━━〔 🐙 GITHUB REPOSITORY 〕━━━╮',
        `✧ Repository: ${repo.name || GITHUB_REPO}`,
        `✧ Owner: ${owner}`,
        `✧ Description: ${repo.description || 'N/A'}`,
        `✧ Language: ${language}`,
        `✧ License: ${license}`,
        `✧ Branch: ${branch}`,
        `✧ Visibility: ${visibility}`,
        '',
        '⿻ STATISTICS',
        `✧ Stars: ${Number(repo.stargazers_count || 0).toLocaleString()}`,
        `✧ Forks: ${Number(repo.forks_count || 0).toLocaleString()}`,
        `✧ Watchers: ${Number(repo.subscribers_count ?? repo.watchers_count ?? 0).toLocaleString()}`,
        `✧ Size: ${sizeMb} MB`,
        `✧ Open issues: ${Number(repo.open_issues_count || 0).toLocaleString()}`,
        '',
        'Choose an option below to open the repository or download its ZIP.',
        '╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯',
    ].join('\n');
}

function formatRepositoryFallback(botName) {
    return [
        '╭━━━〔 🐙 GITHUB REPOSITORY 〕━━━╮',
        `✧ Bot: ${botName}`,
        `✧ Repository: ${GITHUB_REPO}`,
        `✧ Owner: ${GITHUB_USER}`,
        `🔗 URL: ${REPO_URL}`,
        '',
        'GitHub statistics could not be loaded right now.',
        'You can still open the repository using the link above.',
        '╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯',
    ].join('\n');
}

function getQuotedChatId(message, chatId) {
    return chatId || message?.key?.remoteJid;
}

function listenForDownload(sock, originalMessage, chatId, sender, prefix, requestId, repoUrl, branch, botName) {
    if (!sock.ev?.on || !sock.ev?.removeListener) return;

    const expectedId = `${prefix}ghzip_${requestId}`;
    let finished = false;

    const cleanup = () => {
        if (finished) return;
        finished = true;
        clearTimeout(expiryTimer);
        sock.ev.removeListener('messages.upsert', onMessages);
    };

    const expiryTimer = setTimeout(cleanup, LISTENER_TTL_MS);
    expiryTimer.unref?.();

    const onMessages = async (update) => {
        const responseMessage = update?.messages?.[0];
        if (!responseMessage?.message) return;
        if (extractButtonResponseId(responseMessage) !== expectedId) return;
        if (responseMessage.key?.remoteJid !== chatId) return;
        if (getResponseSender(responseMessage) !== sender) return;

        cleanup();
        let tempFile;

        try {
            await sock.sendMessage(chatId, {
                react: { text: '⏳', key: originalMessage.key },
            });

            const downloadUrl = `${repoUrl}/archive/refs/heads/${encodeURIComponent(branch)}.zip`;
            tempFile = path.join(os.tmpdir(), `${GITHUB_REPO}-${requestId}.zip`);

            const response = await axios.get(downloadUrl, {
                responseType: 'stream',
                timeout: DOWNLOAD_TIMEOUT_MS,
                maxRedirects: 5,
                headers: { 'User-Agent': 'TEDDY-XMD-ULTRA-GitHub-Command' },
            });

            await new Promise((resolve, reject) => {
                const output = fs.createWriteStream(tempFile);
                response.data.on('error', reject);
                output.on('error', reject);
                output.on('finish', resolve);
                response.data.pipe(output);
            });

            const stat = await fs.promises.stat(tempFile);
            if (!stat.size) throw new Error('GitHub returned an empty ZIP archive.');

            await sock.sendMessage(chatId, {
                document: await fs.promises.readFile(tempFile),
                mimetype: 'application/zip',
                fileName: `${GITHUB_REPO}.zip`,
                caption: applyFont([
                    '╭━━━〔 📦 REPOSITORY ZIP 〕━━━╮',
                    `📁 Repository: ${GITHUB_REPO}`,
                    `🌿 Branch: ${branch}`,
                    `📦 Size: ${(stat.size / (1024 * 1024)).toFixed(2)} MB`,
                    '',
                    'Powered by',
                    `> ${botName}`,
                    '╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯',
                ].join('\n')),
            }, { quoted: responseMessage });

            await sock.sendMessage(chatId, {
                react: { text: '✅', key: originalMessage.key },
            });
        } catch (error) {
            console.error('[GitHub] ZIP download error:', error?.message || error);
            try {
                await sock.sendMessage(chatId, {
                    react: { text: '❌', key: originalMessage.key },
                });
                await sock.sendMessage(chatId, {
                    text: applyFont(
                        'Unable to download the repository ZIP right now.\n\n' +
                        `Reason: ${error?.message || 'Unknown error'}\n\n` +
                        'Try opening the repository link instead:\n' + REPO_URL
                    ),
                }, { quoted: responseMessage });
            } catch (sendError) {
                console.error('[GitHub] Could not send download error:', sendError?.message || sendError);
            }
        } finally {
            if (tempFile) {
                try {
                    await fs.promises.rm(tempFile, { force: true });
                } catch (cleanupError) {
                    console.error('[GitHub] Temporary file cleanup failed:', cleanupError?.message || cleanupError);
                }
            }
        }
    };

    sock.ev.on('messages.upsert', onMessages);
}

module.exports = {
    name: 'github',
    aliases: ['repo', 'git', 'source', 'rp', 'script'],
    category: 'tools',
    description: 'Show bot GitHub repository and statistics',
    usage: '.github',
    ownerOnly: false,

    async execute(sock, message, args, context) {
        const chatId = getQuotedChatId(message, context?.chat);
        if (!chatId) throw new Error('Could not determine the chat for the GitHub command.');

        const prefix = getSetting('prefix', '.');
        const botName = getSetting('botName', 'TEDDY-XMD-ULTRA');
        const sender = getResponseSender(message);
        const requestId = Date.now().toString();

        let repoUrl = REPO_URL;
        let branch = 'main';
        let text;

        try {
            const response = await axios.get(API_URL, {
                headers: { 'User-Agent': 'TEDDY-XMD-ULTRA-GitHub-Command' },
                timeout: REQUEST_TIMEOUT_MS,
            });
            const repo = response.data || {};
            repoUrl = repo.html_url || REPO_URL;
            branch = repo.default_branch || 'main';
            text = formatRepositoryInfo(repo, branch);
        } catch (error) {
            console.error('[GitHub] API error:', error?.message || error);
            text = formatRepositoryFallback(botName);
        }

        const imagePath = path.join(__dirname, 'git.jpg');
        let imageBuffer;
        try {
            if (fs.existsSync(imagePath)) imageBuffer = await fs.promises.readFile(imagePath);
        } catch (error) {
            console.warn('[GitHub] Optional image could not be loaded:', error?.message || error);
        }

        await sendButtons(sock, chatId, {
            image: imageBuffer ? { buffer: imageBuffer, mimetype: 'image/jpeg' } : undefined,
            text: applyFont(text),
            footer: `Powered by ${botName}`,
            buttons: buildMainButtons(repoUrl, prefix, requestId),
        }, { quoted: message });

        listenForDownload(sock, message, chatId, sender, prefix, requestId, repoUrl, branch, botName);
    },
};
