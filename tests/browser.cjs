// Run with Playwright installed: node tests/browser.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.JAPANESE_GAME_PLAYWRIGHT || 'playwright');
const root = path.join(__dirname, '..');
const server = http.createServer((req, res) => {
    const name = req.url === '/' ? 'index.html' : req.url.slice(1);
    if (!['index.html', 'game.js', 'words_db.js'].includes(name)) {
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
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const url = `http://127.0.0.1:${server.address().port}`;
        await page.goto(url, { waitUntil: 'networkidle' });
        await page.waitForFunction(() => currentWords.length > 0);
        assert.equal(await page.locator('#current-level-display').innerText(), 'N5 - 1');
        assert.equal(await page.locator('#level-select option').count(), 5);
        assert.ok(await page.evaluate(() => currentWords.every(w => document.getElementById(`word-${w.reading}`).querySelector('.word-text').textContent === w.meaning)));
        const words = await page.evaluate(() => currentWords.map(w => ({ id: w.id, reading: w.reading, expression: w.expression, meaning: w.meaning })));
        await page.locator('.star-btn').first().click();
        assert.ok(await page.evaluate(id => !!JSON.parse(localStorage.getItem('japaneseWordSearchV1DifficultWords'))[id], words[0].id));
        await solveByPointer(page, words[0].reading, true);
        assert.equal(await page.locator('.word-item.found').count(), 1);
        assert.ok((await page.locator('.word-item.found').innerText()).includes(words[0].expression));
        assert.ok((await page.locator('.word-item.found').innerText()).includes(words[0].meaning));
        await page.locator('#btn-open-settings').click();
        await page.locator('#show-hints').uncheck();
        assert.equal(await page.locator('.word-item.found').count(), 1);
        assert.ok((await page.locator('.hint-text').allTextContents()).every(t => !t.includes('…')));
        const downloadEvent = page.waitForEvent('download');
        await page.locator('#btn-download-difficult').click();
        const download = await downloadEvent;
        await download.saveAs('/tmp/japanese-game-difficult.txt');
        const exported = fs.readFileSync('/tmp/japanese-game-difficult.txt', 'utf8');
        assert.ok(exported.includes(words[0].expression) && exported.includes(words[0].meaning));
        await page.locator('#btn-back-game').click();
        for (const w of words.slice(1)) await solveByPointer(page, w.reading);
        assert.equal(await page.evaluate(() => foundWords.size), words.length);
        assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('japaneseWordSearchV1Progress'))), { level: 1, stage: 2 });
        await page.reload({ waitUntil: 'networkidle' });
        assert.equal(await page.locator('#current-level-display').innerText(), 'N5 - 2');
        assert.equal(await page.locator('#show-hints').isChecked(), false);
        await page.locator('#btn-giveup').click();
        assert.equal(await page.locator('.word-item.revealed').count(), await page.evaluate(() => currentWords.length));
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
        mobile.on('pageerror', error => errors.push(error.message));
        await mobile.goto(url, { waitUntil: 'networkidle' });
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
        assert.deepEqual(errors, []);
        console.log('Browser checks passed: English clues, reverse drag, single-cell touch, hints, bookmarks, download, resume, give-up, restart, coverage, final stage, mobile layout.');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
