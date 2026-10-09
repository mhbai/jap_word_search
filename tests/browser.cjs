// Run with Playwright installed: node tests/browser.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.JAPANESE_GAME_PLAYWRIGHT || 'playwright');
const root = path.join(__dirname, '..');

function mockSpeech() {
    const mock = { calls: [], cancels: 0, fail: false, voices: [
        { name: 'English', lang: 'en-US', default: true },
        { name: 'Japanese', lang: 'ja-JP', default: false },
    ] };
    window.speechMock = mock;
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: class {
        constructor(text) { this.text = text; }
    }, configurable: true });
    Object.defineProperty(window, 'speechSynthesis', { value: {
        getVoices: () => mock.voices,
        cancel: () => { mock.cancels++; },
        speak: utterance => {
            if (mock.fail) throw new Error('Speech unavailable');
            mock.calls.push(utterance);
        },
    }, configurable: true });
}
const server = http.createServer((req, res) => {
    const name = req.url === '/' ? 'index.html' : req.url.slice(1);
    if (!['index.html', 'game.js', 'words_db.js', 'vendor/wanakana.min.js'].includes(name)) {
        res.writeHead(404); res.end(); return;
    }
    res.setHeader('Content-Type', name.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(root, name)));
});

async function solveByPointer(page, reading, reverse = false) {
    const positions = await page.evaluate(({ reading, reverse }) => {
        const path = [...solutionPaths[reading]];
        if (reverse) path.reverse();
        return path.map(p => {
            const r = document.getElementById(`cell-${p.r}-${p.c}`).getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
    }, { reading, reverse });
    await page.mouse.move(positions[0].x, positions[0].y);
    await page.mouse.down();
    for (const p of positions.slice(1)) await page.mouse.move(p.x, p.y);
    await page.mouse.up();
}

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true,
        ...(process.env.JAPANESE_GAME_CHROME ? { executablePath: process.env.JAPANESE_GAME_CHROME } : {}),
    });
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await page.addInitScript(mockSpeech);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const url = `http://127.0.0.1:${server.address().port}`;
        await page.goto(url, { waitUntil: 'networkidle' });
        await page.waitForFunction(() => currentWords.length > 0);
        assert.equal(await page.locator('#current-level-display').innerText(), 'N5 - 1');
        assert.equal(await page.locator('#level-select option').count(), 5);
        assert.ok(await page.evaluate(() => currentWords.every(w => document.getElementById(`word-${w.reading}`).querySelector('.word-text').textContent === w.meaning)));
        assert.equal(await page.locator('.romaji-text:not(.hidden)').count(), 0);
        const words = await page.evaluate(() => currentWords.map(w => ({ id: w.id, reading: w.reading, expression: w.expression, meaning: w.meaning })));
        assert.equal(await page.locator('.speech-btn').count(), words.length);
        await page.locator('.speech-btn').first().click();
        const spoken = await page.evaluate(() => {
            const u = speechMock.calls.at(-1);
            return { text: u.text, lang: u.lang, rate: u.rate, voice: u.voice.name };
        });
        assert.deepEqual(spoken, { text: words[0].reading, lang: 'ja-JP', rate: 1, voice: 'Japanese' });
        assert.equal(await page.locator('.speech-btn').first().getAttribute('aria-pressed'), 'true');
        assert.equal(await page.evaluate(() => foundWords.size), 0);
        await page.locator('.speech-btn').nth(1).click();
        // A late cancellation event from the old word must not change the new playback state.
        await page.evaluate(() => speechMock.calls[0].onerror({ error: 'interrupted' }));
        assert.equal(await page.locator('.speech-btn').nth(1).getAttribute('aria-pressed'), 'true');
        await page.evaluate(() => speechMock.calls.at(-1).onend());
        assert.equal(await page.locator('.speech-btn').nth(1).getAttribute('aria-pressed'), 'false');
        await page.locator('.star-btn').first().click();
        assert.ok(await page.evaluate(id => !!JSON.parse(localStorage.getItem('japaneseWordSearchV1DifficultWords'))[id], words[0].id));
        await solveByPointer(page, words[0].reading, true);
        assert.equal(await page.locator('.word-item.found').count(), 1);
        assert.ok((await page.locator('.word-item.found').innerText()).includes(words[0].expression));
        assert.ok((await page.locator('.word-item.found').innerText()).includes(words[0].meaning));
        assert.equal(await page.locator('.word-item.found .romaji-text').innerText(), await page.evaluate(reading => romajiText({reading}), words[0].reading));
        await page.locator('#btn-open-settings').click();
        await page.locator('#show-hints').uncheck();
        await page.locator('#speech-rate').selectOption('0.75');
        assert.equal(await page.locator('.word-item.found').count(), 1);
        assert.equal(await page.locator('.romaji-text:not(.hidden)').count(), 1);
        assert.ok((await page.locator('.hint-text').allTextContents()).every(t => !t.includes('…')));
        const downloadEvent = page.waitForEvent('download');
        await page.locator('#btn-download-difficult').click();
        const download = await downloadEvent;
        await download.saveAs('/tmp/japanese-game-difficult.txt');
        const exported = fs.readFileSync('/tmp/japanese-game-difficult.txt', 'utf8');
        assert.ok(exported.includes(words[0].expression) && exported.includes(words[0].meaning));
        assert.ok(exported.includes(await page.evaluate(reading => romajiText({reading}), words[0].reading)));
        await page.locator('#btn-back-game').click();
        await page.locator('.speech-btn').first().click();
        assert.equal(await page.evaluate(() => speechMock.calls.at(-1).rate), 0.75);
        for (const w of words.slice(1)) await solveByPointer(page, w.reading);
        assert.equal(await page.evaluate(() => foundWords.size), words.length);
        assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('japaneseWordSearchV1Progress'))), { level: 1, stage: 2 });
        await page.reload({ waitUntil: 'networkidle' });
        assert.equal(await page.locator('#current-level-display').innerText(), 'N5 - 2');
        assert.equal(await page.locator('#show-hints').isChecked(), false);
        assert.equal(await page.locator('#speech-rate').inputValue(), '0.75');
        await page.locator('#btn-giveup').click();
        assert.equal(await page.locator('.word-item.revealed').count(), await page.evaluate(() => currentWords.length));
        assert.equal(await page.locator('.romaji-text:not(.hidden)').count(), await page.evaluate(() => currentWords.length));
        await page.locator('#btn-restart').click();
        await page.waitForTimeout(900);
        assert.equal(await page.locator('#win-overlay').evaluate(e => e.classList.contains('hidden')), true);
        await page.locator('#btn-open-settings').click();
        await page.locator('#btn-simulation').click();
        assert.equal((await page.locator('#report-content').innerText()).match(/100% 放置成功/g).length, 5);
        await page.screenshot({ path: '/tmp/japanese-game-report.png' });
        await page.locator('#btn-close-report').click();
        await page.locator('#btn-back-game').click();
        await page.screenshot({ path: '/tmp/japanese-game-desktop.png' });

        // Final stage must never save a nonexistent sixth difficulty.
        await page.evaluate(() => {
            maxUnlocked = { level: 5, stage: getOrGenerateStages(5).length };
            levelSelect.value = 5; updateStageDropdown(5);
            stageSelect.value = maxUnlocked.stage; initGame();
            currentWords.forEach(w => foundWords.add(w.reading)); updateProgress();
        });
        assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('japaneseWordSearchV1Progress')).level <= 5));
        await page.waitForTimeout(550);
        assert.equal(await page.locator('#btn-next-level').isVisible(), false);

        const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        await mobile.addInitScript(mockSpeech);
        mobile.on('pageerror', error => errors.push(error.message));
        await mobile.goto(url, { waitUntil: 'networkidle' });
        await mobile.locator('.speech-btn').first().tap();
        assert.equal(await mobile.evaluate(() => speechMock.calls.at(-1).lang), 'ja-JP');
        assert.equal(await mobile.evaluate(() => foundWords.size), 0);
        await mobile.evaluate(() => {
            maxUnlocked = { level: 5, stage: 999 };
            levelSelect.value = 1;
            const stages = getOrGenerateStages(1);
            updateStageDropdown(1);
            stageSelect.value = stages.findIndex(s => s.words.some(w => w.reading.length === 1)) + 1;
            initGame();
        });
        const single = await mobile.evaluate(() => {
            const word = currentWords.find(w => w.reading.length === 1);
            const p = solutionPaths[word.reading][0];
            const cell = document.getElementById(`cell-${p.r}-${p.c}`);
            const r = cell.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2, reading: word.reading };
        });
        await mobile.touchscreen.tap(single.x, single.y);
        assert.ok(await mobile.evaluate(reading => foundWords.has(reading), single.reading));
        assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
        await mobile.screenshot({ path: '/tmp/japanese-game-mobile.png' });
        await mobile.locator('#btn-open-settings').click();
        assert.equal(await mobile.locator('#level-select').isVisible(), true);
        await mobile.screenshot({ path: '/tmp/japanese-game-mobile-settings.png' });
        await mobile.locator('#btn-back-game').click();
        await mobile.setViewportSize({ width: 320, height: 640 });
        await mobile.evaluate(() => {
            levelSelect.value = 5; updateStageDropdown(5);
            stageSelect.value = 25; initGame();
        });
        const touchPath = await mobile.evaluate(() => {
            const word = currentWords.find(w => w.reading.length > 1);
            return { reading: word.reading, points: solutionPaths[word.reading].map(p => {
                const r = document.getElementById(`cell-${p.r}-${p.c}`).getBoundingClientRect();
                return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
            }) };
        });
        const session = await mobile.context().newCDPSession(mobile);
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPath.points[0]] });
        for (const p of touchPath.points.slice(1)) {
            await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] });
        }
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        assert.ok(await mobile.evaluate(reading => foundWords.has(reading), touchPath.reading));
        assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
        assert.ok(await mobile.locator('#grid-container').evaluate(e => e.getBoundingClientRect().top >= 0));
        await mobile.screenshot({ path: '/tmp/japanese-game-small-mobile.png' });

        // Handle devices without Japanese voices and voice lists that load after the page.
        await page.evaluate(() => { speechMock.voices = [{ lang: 'en-US' }]; });
        const beforeMissing = await page.evaluate(() => speechMock.calls.length);
        await page.locator('.speech-btn').first().click();
        assert.equal(await page.evaluate(() => speechMock.calls.length), beforeMissing);
        assert.ok((await page.locator('#speech-status').innerText()).includes('日文語音'));
        await page.evaluate(() => { speechMock.voices = []; });
        await page.locator('.speech-btn').first().click();
        assert.equal(await page.evaluate(() => speechMock.calls.at(-1).lang), 'ja-JP');
        await page.evaluate(() => speechMock.calls.at(-1).onerror({ error: 'language-unavailable' }));
        assert.ok((await page.locator('#speech-status').innerText()).includes('無法播放'));
        await page.evaluate(() => { speechMock.voices = [{ name: 'Japanese', lang: 'ja_JP' }]; });
        await page.locator('.speech-btn').first().click();
        assert.equal(await page.evaluate(() => speechMock.calls.at(-1).voice.name), 'Japanese');
        await page.evaluate(() => { speechMock.fail = true; });
        await page.locator('.speech-btn').first().click();
        assert.ok((await page.locator('#speech-status').innerText()).includes('無法播放'));
        assert.equal(await page.locator('.speech-btn').first().getAttribute('aria-pressed'), 'false');

        const unsupported = await browser.newPage();
        await unsupported.addInitScript(() => Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true }));
        unsupported.on('pageerror', error => errors.push(error.message));
        await unsupported.goto(url, { waitUntil: 'networkidle' });
        assert.equal(await unsupported.locator('.speech-btn:not(:disabled)').count(), 0);
        assert.ok((await unsupported.locator('#speech-status').innerText()).includes('不支援'));
        assert.ok(await unsupported.evaluate(() => currentWords.length > 0));
        assert.deepEqual(errors, []);
        console.log('Browser checks passed: English clues, reverse drag, single-cell touch, hints, bookmarks, download, resume, give-up, restart, coverage, final stage, mobile layout; mocked speech: Japanese voice selection, slow rate, interruption, delayed voices, errors and unsupported devices.');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
