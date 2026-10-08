        const VERSION = "v2.0.0";
        console.log('VERSION:', VERSION);
        // === 核心工具 ===
        function mulberry32(a) {
            return function() {
                var t = a += 0x6D2B79F5;
                t = Math.imul(t ^ t >>> 15, t | 1);
                t ^= t + Math.imul(t ^ t >>> 7, t | 61);
                return ((t ^ t >>> 14) >>> 0) / 4294967296;
            }
        }

        function seededShuffle(array, seed) {
            const rng = mulberry32(seed);
            let m = array.length, t, i;
            while (m) {
                i = Math.floor(rng() * m--);
                t = array[m];
                array[m] = array[i];
                array[i] = t;
            }
            return array;
        }

        // === 遊戲資料與設定 ===
        const LEVEL_SETTINGS = Object.fromEntries([1, 2, 3, 4, 5].map(level => [level,
            { minGridSize: 6, maxGridSize: 12, minWords: 4, maxWords: 10 }
        ]));
        const levelLabel = level => `N${6 - level}`;
        const answerText = word => word.expression === word.reading
            ? word.expression : `${word.expression}（${word.reading}）`;
        let overlayTimer;
        let activeDirections = [[0, 1], [1, 0]];
        const hintToggle = document.getElementById('show-hints');
        try { hintToggle.checked = localStorage.getItem('japaneseWordSearchV1Hints') !== 'false'; } catch (_) {}
        hintToggle.addEventListener('change', () => {
            localStorage.setItem('japaneseWordSearchV1Hints', String(hintToggle.checked));
            renderWordList();
        });

        let GRID_SIZE = 12;
        let generatedStagesCache = {};
        const DIRECTIONS = [
            [0, 1], [1, 0], [1, 1], [-1, 1],
            [0, -1], [-1, 0], [-1, -1], [1, -1]
        ];

        let currentWords = [];
        let grid = [];
        let foundWords = new Set();
        let solutionPaths = {};
        let isGameActive = true;
        let maxUnlocked = { level: 1, stage: 1 };
        let globalSeed = 0; // 全域種子
        let difficultWordsMap = {}; // 難詞紀錄

        let isSelecting = false;
        let startCell = null;
        let currentSelectionLine = [];
        let foundCellCoordinates = new Set();

        const gridContainer = document.getElementById('grid-container');
        const highlightLayer = document.getElementById('highlight-layer');
        const wordListContainer = document.getElementById('word-list');
        // DOM - 將來從 Modal 獲取
        let levelSelect, stageSelect, btnDownloadDifficult, btnResetData, btnSimulation;

        const btnRestart = document.getElementById('btn-restart');
        const btnGiveUp = document.getElementById('btn-giveup');
        const btnHeaderNext = document.getElementById('btn-header-next');

        const btnPlayAgain = document.getElementById('btn-play-again');
        const btnNextLevel = document.getElementById('btn-next-level');
        const btnViewBoard = document.getElementById('btn-view-board');
        const btnCloseOverlay = document.getElementById('btn-close-overlay');

        const winOverlay = document.getElementById('win-overlay');
        const overlayIcon = document.getElementById('overlay-icon');
        const overlayTitle = document.getElementById('overlay-title');
        const overlayMessage = document.getElementById('overlay-message');
        const progressText = document.getElementById('progress-text');
        const currentLevelDisplay = document.getElementById('current-level-display'); // 新增

        // Modal
        const settingsModal = document.getElementById('settings-modal');
        const btnOpenSettings = document.getElementById('btn-open-settings');
        const btnCloseSettings = document.getElementById('btn-close-settings');
        const btnBackGame = document.getElementById('btn-back-game');

        // Report Modal
        const reportModal = document.getElementById('report-modal');
        const btnCloseReport = document.getElementById('btn-close-report');
        const reportContent = document.getElementById('report-content');

        // 在 DOM 載入後綁定 Modal 內元素
        levelSelect = document.getElementById('level-select');
        stageSelect = document.getElementById('stage-select');
        btnDownloadDifficult = document.getElementById('btn-download-difficult');
        btnResetData = document.getElementById('btn-reset-data');
        btnSimulation = document.getElementById('btn-simulation');

        // === 設定選單邏輯 ===
        function openSettings() {
            settingsModal.classList.remove('hidden');
        }
        function closeSettings() {
            settingsModal.classList.add('hidden');
        }
        btnOpenSettings.addEventListener('click', openSettings);
        btnCloseSettings.addEventListener('click', closeSettings);
        btnBackGame.addEventListener('click', closeSettings);

        // Report Logic
        btnCloseReport.addEventListener('click', () => reportModal.classList.add('hidden'));

        // === 進度與種子存取功能 ===
        function loadProgress() {
            try {
                const stored = localStorage.getItem('japaneseWordSearchV1Progress');
                const value = stored ? JSON.parse(stored) : null;
                return value && Number.isInteger(value.level) && value.level >= 1 && value.level <= 5
                    && Number.isInteger(value.stage) && value.stage >= 1
                    ? value : { level: 1, stage: 1 };
            } catch (e) {
                return { level: 1, stage: 1 };
            }
        }

        function loadGlobalSeed() {
            const stored = localStorage.getItem('japaneseWordSearchV1Seed');
            if (stored && Number.isInteger(Number(stored)) && Number(stored) >= 0) return Number(stored);
            const newSeed = Math.floor(Math.random() * 999999);
            localStorage.setItem('japaneseWordSearchV1Seed', newSeed);
            return newSeed;
        }

        // 載入難詞紀錄
        function loadDifficultWords() {
            try {
                const stored = localStorage.getItem('japaneseWordSearchV1DifficultWords');
                if (stored) {
                    difficultWordsMap = JSON.parse(stored);
                }
            } catch (e) {
                console.error("載入難詞失敗", e);
            }
        }

        function saveDifficultWords() {
            localStorage.setItem('japaneseWordSearchV1DifficultWords', JSON.stringify(difficultWordsMap));
        }

        // 切換難詞標記 (Global Scope)
        window.toggleDifficult = function(id, word, btn) {

            if (difficultWordsMap[id]) {
                delete difficultWordsMap[id];
                btn.classList.remove('active');
                btn.classList.add('inactive');
                // 設為空心星 (SVG path)
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z");
                path.setAttribute('fill', "none");
                path.setAttribute('stroke', "currentColor");
                path.setAttribute('stroke-width', "2");
                path.setAttribute('stroke-linejoin', "round");
                btn.innerHTML = '';
                btn.appendChild(path);
            } else {
                difficultWordsMap[id] = { id: word.id, jlpt: word.jlpt, expression: word.expression, reading: word.reading, meaning: word.meaning };
                btn.classList.add('active');
                btn.classList.remove('inactive');
                // 設為實心星
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z");
                path.setAttribute('stroke', "none");
                btn.innerHTML = '';
                btn.appendChild(path);
            }
            saveDifficultWords();
        };

        // 下載難詞
        function downloadDifficultWords() {
            const words = Object.keys(difficultWordsMap);
            if (words.length === 0) {
                alert("目前沒有標記任何難詞喔！\n請在遊戲中點擊單字旁的星星來標記。");
                return;
            }

            let content = "日文找字 難詞複習表\n====================\n\n";
            words.sort().forEach(id => {
                const word = difficultWordsMap[id];
                content += `[${word.jlpt}] ${answerText(word)} : ${word.meaning}\n`;
            });

            const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "japanese_difficult_words.txt";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        function saveProgress(level, stage) {
            if (level > maxUnlocked.level || (level === maxUnlocked.level && stage > maxUnlocked.stage)) {
                maxUnlocked = { level, stage };
                localStorage.setItem('japaneseWordSearchV1Progress', JSON.stringify(maxUnlocked));
                updateLevelDropdownState();
                updateStageDropdown(parseInt(levelSelect.value));
            }
        }

        function resetGameData() {
            if(!confirm('確定要清除所有過關紀錄並重置題目嗎？\n(這將無法復原，且題目順序會完全改變)\n註：您的「難詞紀錄」不會被清除。')) return;

            localStorage.removeItem('japaneseWordSearchV1Progress');
            maxUnlocked = { level: 1, stage: 1 };

            globalSeed = Math.floor(Math.random() * 999999);
            localStorage.setItem('japaneseWordSearchV1Seed', globalSeed);

            generatedStagesCache = {};

            updateLevelDropdownState();
            levelSelect.value = 1;
            updateStageDropdown(1);
            stageSelect.value = 1;

            initGame();
            closeSettings(); // 重置後關閉選單
        }

        function updateLevelDropdownState() {
            Array.from(levelSelect.options).forEach(opt => {
                const val = parseInt(opt.value);
                const originalText = opt.text.replace('🔒 ', '');
                if (val > maxUnlocked.level) {
                    opt.disabled = true;
                    opt.textContent = `🔒 ${originalText}`;
                } else {
                    opt.disabled = false;
                    opt.textContent = originalText;
                }
            });
        }

        // === 遊戲生成邏輯 ===

        function getOrGenerateStages(levelNum) {
            if (generatedStagesCache[levelNum]) return generatedStagesCache[levelNum];
            const settings = LEVEL_SETTINGS[levelNum];
            if (!settings || !WORDS_DB[levelNum]) return [];
            const remaining = seededShuffle([...WORDS_DB[levelNum]], levelNum + globalSeed);
            const stages = [];
            while (remaining.length) {
                const ratio = Math.min(stages.length / 20, 1);
                const count = Math.floor(settings.minWords + ratio * (settings.maxWords - settings.minWords));
                const words = [];
                const readings = new Set();
                for (let i = 0; i < remaining.length && words.length < count; i++) {
                    const reading = remaining[i].reading;
                    const reversed = Array.from(reading).reverse().join('');
                    // Reverse-equivalent readings also collide when dragging either way.
                    if (readings.has(reading) || readings.has(reversed)) continue;
                    words.push(remaining.splice(i--, 1)[0]);
                    readings.add(reading);
                }
                const size = Math.max(
                    Math.floor(settings.minGridSize + ratio * (settings.maxGridSize - settings.minGridSize)),
                    words.length, ...words.map(w => w.reading.length)
                );
                stages.push({ gridSize: size, words });
            }
            return generatedStagesCache[levelNum] = stages;
        }

        function updateStageDropdown(levelNum) {
            const stages = getOrGenerateStages(levelNum);
            const totalStages = stages.length || 1;

            let currentStageValue = parseInt(stageSelect.value) || 1;

            if (!stageSelect.value && levelNum === maxUnlocked.level) {
                 currentStageValue = maxUnlocked.stage;
            }

            stageSelect.innerHTML = '';
            for (let i = 1; i <= totalStages; i++) {
                const option = document.createElement('option');
                option.value = i;

                let isLocked = false;
                if (levelNum > maxUnlocked.level) {
                    isLocked = true;
                } else if (levelNum === maxUnlocked.level && i > maxUnlocked.stage) {
                    isLocked = true;
                }

                if (isLocked) {
                    option.disabled = true;
                    option.textContent = `🔒 第 ${i} 關`;
                } else {
                    option.textContent = `第 ${i} 關`;
                }

                if (i === currentStageValue) option.selected = true;
                stageSelect.appendChild(option);
            }
        }

        function initGame() {
            clearTimeout(overlayTimer);
            updateLevelDropdownState();
            const currentLevelNum = parseInt(levelSelect.value);

            if(stageSelect.options.length === 0 || !stageSelect.querySelector(`option[value="${stageSelect.value}"]`)) {
                 updateStageDropdown(currentLevelNum);
            }

            let currentStageNum = parseInt(stageSelect.value) || 1;
            if (currentLevelNum === maxUnlocked.level && currentStageNum > maxUnlocked.stage) {
                currentStageNum = maxUnlocked.stage;
                stageSelect.value = currentStageNum;
            }

            // 更新頂部顯示
            currentLevelDisplay.textContent = `${levelLabel(currentLevelNum)} - ${currentStageNum}`;

            const stages = getOrGenerateStages(currentLevelNum);
            if (!stages || stages.length === 0) return;

            const currentStageData = stages[currentStageNum - 1];

            GRID_SIZE = currentStageData.gridSize;

            // 使用 globalSeed 來影響每關的盤面配置
            const stageSeed = currentLevelNum * 10000 + currentStageNum + globalSeed;

            const wordsToFit = currentStageData.words.map(w => ({ ...w }));
            activeDirections = currentLevelNum === 1 && currentStageNum <= 5
                ? DIRECTIONS.slice(0, 2)
                : currentLevelNum === 1 && currentStageNum <= 15
                    ? DIRECTIONS.slice(0, 4) : DIRECTIONS;

            gridContainer.style.gridTemplateColumns = `repeat(${GRID_SIZE}, minmax(0, 1fr))`;

            const stageRng = mulberry32(stageSeed);

            const evolutionResult = runEvolutionaryPlacement(wordsToFit, stageRng);

            grid = evolutionResult.grid;
            currentWords = evolutionResult.placedWords;
            solutionPaths = evolutionResult.paths;

            foundWords.clear();
            foundCellCoordinates.clear();
            isGameActive = true;
            isSelecting = false;
            startCell = null;
            currentSelectionLine = [];

            highlightLayer.setAttribute('viewBox', `0 0 ${GRID_SIZE} ${GRID_SIZE}`);
            highlightLayer.innerHTML = '<line id="selection-line" stroke="#93c5fd" stroke-linecap="round" stroke-width="0.7" class="hidden" />';

            winOverlay.classList.add('hidden');
            btnGiveUp.classList.remove('hidden');
            btnGiveUp.disabled = false;
            btnGiveUp.classList.remove('opacity-50', 'cursor-not-allowed');
            btnHeaderNext.classList.add('hidden');

            fillEmptySpaces(stageRng);
            renderGrid();
            renderWordList();
            updateProgress();
        }

        // === 演化演算法核心 ===
        function runEvolutionaryPlacement(words, rng) {
            const MAX_GENERATIONS = 15;
            let bestGrid = null;
            let bestScore = -1;
            let bestPlacedWords = [];
            let bestPaths = {};

            let currentOrder = seededShuffle([...words], Math.floor(rng() * 10000));

            for (let gen = 0; gen < MAX_GENERATIONS; gen++) {
                const result = tryBuildGrid(currentOrder, rng);

                let score = result.placedWords.length * 1000 + result.intersections * 10;

                if (score > bestScore) {
                    bestScore = score;
                    bestGrid = result.grid;
                    bestPlacedWords = result.placedWords;
                    bestPaths = result.paths;
                }

                if (result.failedWords.length > 0) {
                    const successfulShuffled = seededShuffle(result.placedWords.map(w => w.originalObj), Math.floor(rng() * 10000));
                    currentOrder = [...result.failedWords, ...successfulShuffled];
                } else {
                    break;
                }
            }

            // A row for each word guarantees all scheduled entries are playable.
            if (bestPlacedWords.length !== words.length) {
                bestGrid = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(''));
                bestPaths = {};
                const rows = seededShuffle(Array.from({ length: GRID_SIZE }, (_, i) => i), Math.floor(rng() * 10000));
                words.forEach((word, i) => {
                    const column = Math.floor(rng() * (GRID_SIZE - word.reading.length + 1));
                    placeWordInGrid(bestGrid, word.reading, rows[i], column, 0, 1, bestPaths);
                });
                bestPlacedWords = words;
            }

            return {
                grid: bestGrid,
                placedWords: bestPlacedWords,
                paths: bestPaths
            };
        }

        function tryBuildGrid(orderedWords, rng) {
            let tempGrid = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(''));
            let placedWords = [];
            let failedWords = [];
            let paths = {};
            let intersections = 0;

            for (const wordObj of orderedWords) {
                const word = wordObj.reading;
                let placed = false;

                let attempts = 0;
                while (!placed && attempts < 50) {
                    const dir = activeDirections[Math.floor(rng() * activeDirections.length)];
                    const r = Math.floor(rng() * GRID_SIZE);
                    const c = Math.floor(rng() * GRID_SIZE);

                    if (canPlaceWordInGrid(tempGrid, word, r, c, dir[0], dir[1])) {
                        intersections += placeWordInGrid(tempGrid, word, r, c, dir[0], dir[1], paths);
                        placedWords.push(wordObj);
                        placedWords[placedWords.length-1].originalObj = wordObj;
                        placed = true;
                    }
                    attempts++;
                }

                if (!placed) {
                    const shuffledDirs = seededShuffle([...activeDirections], Math.floor(rng() * 10000));
                    for (let r = 0; r < GRID_SIZE; r++) {
                        for (let c = 0; c < GRID_SIZE; c++) {
                            for (const dir of shuffledDirs) {
                                if (canPlaceWordInGrid(tempGrid, word, r, c, dir[0], dir[1])) {
                                    intersections += placeWordInGrid(tempGrid, word, r, c, dir[0], dir[1], paths);
                                    placedWords.push(wordObj);
                                    placedWords[placedWords.length-1].originalObj = wordObj;
                                    placed = true;
                                    break;
                                }
                            }
                            if (placed) break;
                        }
                        if (placed) break;
                    }
                }

                if (!placed) {
                    failedWords.push(wordObj);
                }
            }

            return { grid: tempGrid, placedWords, failedWords, paths, intersections };
        }

        function canPlaceWordInGrid(g, word, r, c, dr, dc) {
            const endR = r + (word.length - 1) * dr;
            const endC = c + (word.length - 1) * dc;
            if (endR < 0 || endR >= GRID_SIZE || endC < 0 || endC >= GRID_SIZE) {
                return false;
            }
            for (let i = 0; i < word.length; i++) {
                const cell = g[r + i * dr][c + i * dc];
                if (cell !== '' && cell !== word[i]) return false;
            }
            return true;
        }

        function placeWordInGrid(g, word, r, c, dr, dc, paths) {
            let path = [];
            let intersectCount = 0;
            for (let i = 0; i < word.length; i++) {
                const curR = r + i * dr;
                const curC = c + i * dc;
                if (g[curR][curC] !== '') {
                    intersectCount++;
                }
                g[curR][curC] = word[i];
                path.push({r: curR, c: curC});
            }
            paths[word] = path;
            return intersectCount;
        }

        function fillEmptySpaces(rng) {
            const hiragana = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんがぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽっゃゅょー';
            const katakana = Array.from(hiragana, c => c === 'ー' ? c : String.fromCharCode(c.charCodeAt(0) + 0x60)).join('');
            const hasHiragana = currentWords.some(w => /[ぁ-ゖ]/.test(w.reading));
            const hasKatakana = currentWords.some(w => /[ァ-ヺ]/.test(w.reading));
            const letters = (hasHiragana ? hiragana : '') + (hasKatakana ? katakana : '');
            for (let r = 0; r < GRID_SIZE; r++) {
                for (let c = 0; c < GRID_SIZE; c++) {
                    if (grid[r][c] === '') {
                        grid[r][c] = letters[Math.floor(rng() * letters.length)];
                    }
                }
            }
        }

        // === 認輸功能 ===
        function giveUp() {
            if (!isGameActive) return;
            isGameActive = false;

            btnGiveUp.disabled = true;
            btnGiveUp.classList.add('opacity-50', 'cursor-not-allowed');

            btnHeaderNext.classList.add('hidden');

            currentWords.forEach(wordObj => {
                const word = wordObj.reading;
                if (!foundWords.has(word)) {
                    if (solutionPaths[word]) {
                        drawHighlightLine(solutionPaths[word], '#ef4444');
                    }

                    const li = document.getElementById(`word-${word}`);
                    if (li) {
                        li.classList.add('revealed');
                        // 揭示日文寫法及讀音
                        li.querySelector('.word-text').textContent = answerText(wordObj);
                        li.querySelector('small').classList.remove('hidden');
                        // 移除 title 以免干擾
                        li.removeAttribute('title');
                    }
                }
            });

            overlayTimer = setTimeout(() => {
                overlayIcon.textContent = '😢';
                overlayTitle.textContent = '挑戰失敗';
                overlayTitle.className = 'text-3xl font-bold text-red-500 mb-2';
                overlayMessage.textContent = '別氣餒，答案已經幫你標出來了。';

                btnNextLevel.classList.add('hidden');
                btnPlayAgain.classList.remove('hidden');
                winOverlay.classList.remove('hidden');
            }, 800);
        }

        function drawHighlightLine(path, color) {
            const startPos = path[0];
            const endPos = path[path.length - 1];

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', startPos.c + 0.5);
            line.setAttribute('y1', startPos.r + 0.5);
            line.setAttribute('x2', endPos.c + 0.5 + (path.length === 1 ? 0.01 : 0));
            line.setAttribute('y2', endPos.r + 0.5);
            line.setAttribute('stroke', color);
            line.setAttribute('stroke-linecap', 'round');
            line.setAttribute('stroke-width', '0.7');
            line.setAttribute('pathLength', '100');
            line.classList.add('highlight-line');
            highlightLayer.appendChild(line);
        }

        // === UI 渲染 ===

        function renderGrid() {
            gridContainer.querySelectorAll('.cell').forEach(cell => cell.remove());

            let fontSizeClass = 'text-lg md:text-xl';
            if (GRID_SIZE <= 8) {
                fontSizeClass = 'text-3xl md:text-4xl';
            } else if (GRID_SIZE <= 12) {
                fontSizeClass = 'text-lg md:text-2xl';
            } else if (GRID_SIZE > 16) {
                fontSizeClass = 'text-base md:text-lg';
            }

            for (let r = 0; r < GRID_SIZE; r++) {
                for (let c = 0; c < GRID_SIZE; c++) {
                    const cell = document.createElement('div');
                    cell.className = `cell flex items-center justify-center ${fontSizeClass} font-bold bg-slate-100 rounded cursor-pointer select-none`;
                    cell.textContent = grid[r][c];
                    cell.dataset.r = r;
                    cell.dataset.c = c;
                    cell.id = `cell-${r}-${c}`;
                    gridContainer.appendChild(cell);
                }
            }
        }

        function renderWordList() {
            wordListContainer.innerHTML = '';
            currentWords.forEach(wordObj => {
                const li = document.createElement('li');
                li.className = 'word-item flex items-start gap-2 relative'; // 調整對齊
                li.id = `word-${wordObj.reading}`;

                const fullText = wordObj.meaning;
                const solved = foundWords.has(wordObj.reading);
                const revealed = !isGameActive && !solved;
                li.classList.toggle('found', solved);
                li.classList.toggle('revealed', revealed);
                li.setAttribute('title', fullText);
                const chars = Array.from(wordObj.reading);
                const hintText = chars.length === 1 ? '1 格・點擊作答'
                    : hintToggle.checked ? `${chars[0]}…${chars[chars.length - 1]}（${chars.length} 格）`
                    : `${chars.length} 格`;
                const isDifficult = !!difficultWordsMap[wordObj.id];
                const starClass = isDifficult ? 'active' : 'inactive';

                // SVG Path Data
                const starD = "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z";

                const starBtn = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                starBtn.setAttribute('viewBox', '0 0 24 24');
                starBtn.setAttribute('class', `w-5 h-5 mt-1 flex-shrink-0 star-btn ${starClass}`);

                const starPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                starPath.setAttribute('d', starD);

                if (isDifficult) {
                    starPath.setAttribute('stroke', 'none');
                } else {
                    starPath.setAttribute('fill', 'none');
                    starPath.setAttribute('stroke', 'currentColor');
                    starPath.setAttribute('stroke-width', '2');
                    starPath.setAttribute('stroke-linejoin', 'round');
                }

                starBtn.appendChild(starPath);

                starBtn.onclick = function(e) {
                    e.stopPropagation();
                    toggleDifficult(wordObj.id, wordObj, this);
                };

                const checkIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                checkIcon.setAttribute('class', 'w-5 h-5 opacity-0 transition-opacity text-green-500 check-icon mt-1 flex-shrink-0');
                checkIcon.setAttribute('viewBox', '0 0 24 24');
                checkIcon.setAttribute('fill', 'none');
                checkIcon.setAttribute('stroke', 'currentColor');
                checkIcon.setAttribute('stroke-width', '3');
                checkIcon.setAttribute('stroke-linecap', 'round');
                checkIcon.setAttribute('stroke-linejoin', 'round');

                const checkPath = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
                checkPath.setAttribute('points', '20 6 9 17 4 12');
                checkIcon.appendChild(checkPath);

                const textDiv = document.createElement('div');
                textDiv.className = 'flex flex-col min-w-0 break-words';
                const mainText = document.createElement('span');
                mainText.className = 'word-text text-base leading-snug';
                mainText.textContent = solved || revealed ? answerText(wordObj) : fullText;
                const detail = document.createElement('small');
                detail.className = 'text-slate-500 text-xs leading-snug';
                detail.textContent = fullText;
                const hint = document.createElement('small');
                hint.className = 'text-slate-500 text-xs hint-text';
                hint.textContent = hintText;
                textDiv.appendChild(mainText);
                // Keep the meaning visible when the Japanese answer is revealed.
                detail.classList.toggle('hidden', !solved && !revealed);
                textDiv.appendChild(detail);
                textDiv.appendChild(hint);
                if (solved) checkIcon.classList.remove('opacity-0');

                li.appendChild(starBtn);
                li.appendChild(checkIcon);
                li.appendChild(textDiv);

                wordListContainer.appendChild(li);
            });
        }

        function updateProgress() {
            progressText.textContent = `${foundWords.size} / ${currentWords.length}`;

            if (foundWords.size === currentWords.length && isGameActive) {
                isGameActive = false;

                const currentLvl = parseInt(levelSelect.value);
                const currentStg = parseInt(stageSelect.value);
                const totalStages = getOrGenerateStages(currentLvl).length;

                let nextLvl = currentLvl;
                let nextStg = currentStg + 1;

                if (nextStg > totalStages) {
                    nextLvl++;
                    nextStg = 1;
                }

                if (nextLvl <= 5) saveProgress(nextLvl, nextStg);

                btnGiveUp.classList.add('hidden');

                if (!(currentLvl >= 5 && currentStg >= totalStages)) {
                    btnHeaderNext.classList.remove('hidden');
                }

                overlayTimer = setTimeout(() => {
                    overlayIcon.textContent = '🎉';
                    overlayTitle.textContent = '太厲害了！';
                    overlayTitle.className = 'text-3xl font-bold text-green-600 mb-2';
                    overlayMessage.textContent = '你找到了所有的單字！';

                    if (currentLvl >= 5 && currentStg >= totalStages) {
                        btnNextLevel.classList.add('hidden');
                    } else {
                        btnNextLevel.classList.remove('hidden');
                    }

                    btnPlayAgain.classList.add('hidden');
                    winOverlay.classList.remove('hidden');
                }, 500);
            }
        }

        // === 互動邏輯 ===

        function handlePointerDown(e) {
            if (!isGameActive) return;
            if (e.button !== undefined && e.button !== 0) return;
            const target = getCellFromEvent(e);
            if (!target) return;
            isSelecting = true;

            startCell = { r: parseInt(target.dataset.r), c: parseInt(target.dataset.c) };
            updateSelection(startCell.r, startCell.c);
        }

        function handlePointerMove(e) {
            if (!isGameActive || !isSelecting || !startCell) return;
            e.preventDefault();

            const target = getCellFromEvent(e);
            if (!target) return;

            const currentR = parseInt(target.dataset.r);
            const currentC = parseInt(target.dataset.c);
            updateSelection(currentR, currentC);
        }

        function handlePointerUp(e) {
            if (!isSelecting) return;
            isSelecting = false;
            checkSelection();
            clearSelectionUI();
            startCell = null;
        }

        function getCellFromEvent(e) {
            let clientX = e.clientX;
            let clientY = e.clientY;

            if (e.touches && e.touches.length > 0) {
                clientX = e.touches[0].clientX;
                clientY = e.touches[0].clientY;
            } else if (e.changedTouches && e.changedTouches.length > 0) {
                clientX = e.changedTouches[0].clientX;
                clientY = e.changedTouches[0].clientY;
            }

            const rect = gridContainer.getBoundingClientRect();
            if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
                return null;
            }

            const cellWidth = rect.width / GRID_SIZE;
            const cellHeight = rect.height / GRID_SIZE;

            const c = Math.floor((clientX - rect.left) / cellWidth);
            const r = Math.floor((clientY - rect.top) / cellHeight);

            if (r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE) {
                return document.getElementById(`cell-${r}-${c}`);
            }
            return null;
        }

        function updateSelection(endR, endC) {
            currentSelectionLine = calculateLine(startCell.r, startCell.c, endR, endC);

            const selectionLine = document.getElementById('selection-line');
            if (selectionLine && currentSelectionLine.length > 0) {
                const startPos = currentSelectionLine[0];
                const endPos = currentSelectionLine[currentSelectionLine.length - 1];

                selectionLine.setAttribute('x1', startPos.c + 0.5);
                selectionLine.setAttribute('y1', startPos.r + 0.5);
                selectionLine.setAttribute('x2', endPos.c + 0.5);
                selectionLine.setAttribute('y2', endPos.r + 0.5);
                selectionLine.classList.remove('hidden');
            }
        }

        function calculateLine(r1, c1, r2, c2) {
            const path = [];
            const dr = r2 - r1;
            const dc = c2 - c1;

            if (dr !== 0 && dc !== 0 && Math.abs(dr) !== Math.abs(dc)) {
                return [];
            }

            const stepR = dr === 0 ? 0 : dr / Math.abs(dr);
            const stepC = dc === 0 ? 0 : dc / Math.abs(dc);
            const steps = Math.max(Math.abs(dr), Math.abs(dc));

            for (let i = 0; i <= steps; i++) {
                path.push({ r: r1 + i * stepR, c: c1 + i * stepC });
            }
            return path;
        }

        function clearSelectionUI() {
            const selectionLine = document.getElementById('selection-line');
            if (selectionLine) selectionLine.classList.add('hidden');
        }

        function checkSelection() {
            if (currentSelectionLine.length === 0) return;

            let selectedWord = '';
            currentSelectionLine.forEach(coord => {
                selectedWord += grid[coord.r][coord.c];
            });

            const reversedWord = selectedWord.split('').reverse().join('');

            let foundMatch = null;

            const wordObj = currentWords.find(w => w.reading === selectedWord);
            const reversedWordObj = currentWords.find(w => w.reading === reversedWord);

            if (wordObj && !foundWords.has(selectedWord)) {
                foundMatch = selectedWord;
            } else if (reversedWordObj && !foundWords.has(reversedWord)) {
                foundMatch = reversedWord;
            }

            if (foundMatch) {
                foundWords.add(foundMatch);

                const startPos = currentSelectionLine[0];
                const endPos = currentSelectionLine[currentSelectionLine.length - 1];
                const highlightColors = ['#fde047', '#86efac', '#93c5fd', '#f9a8d4', '#d8b4fe', '#fdba74'];
                const color = highlightColors[(foundWords.size - 1) % highlightColors.length];

                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', startPos.c + 0.5);
                line.setAttribute('y1', startPos.r + 0.5);
                line.setAttribute('x2', endPos.c + 0.5 + (currentSelectionLine.length === 1 ? 0.01 : 0));
                line.setAttribute('y2', endPos.r + 0.5);
                line.setAttribute('stroke', color);
                line.setAttribute('stroke-linecap', 'round');
                line.setAttribute('stroke-width', '0.7');
                line.setAttribute('pathLength', '100');
                line.classList.add('highlight-line');
                highlightLayer.appendChild(line);

                currentSelectionLine.forEach(coord => {
                    const id = `cell-${coord.r}-${coord.c}`;
                    const cell = document.getElementById(id);
                    if (cell) cell.classList.add('scale-110');
                    foundCellCoordinates.add(`${coord.r},${coord.c}`);
                });

                const listItem = document.getElementById(`word-${foundMatch}`);
                if (listItem) {
                    listItem.classList.add('found');
                    listItem.querySelector('.check-icon').classList.remove('opacity-0');

                    const wordObj = currentWords.find(w => w.reading === foundMatch);
                    if(wordObj) {
                        listItem.querySelector('.word-text').textContent = answerText(wordObj);
                        listItem.querySelector('small').classList.remove('hidden');
                    }
                    // 移除 title
                    listItem.removeAttribute('title');
                }

                updateProgress();
            }
        }


function runSimulation() {
    const previousSize = GRID_SIZE;
    const previousDirections = activeDirections;
    let report = '日文詞彙覆蓋率（含實際盤面放置）\n================================\n';
    try {
        for (let level = 1; level <= 5; level++) {
            const stages = getOrGenerateStages(level);
            const ids = new Set();
            let failed = 0;
            stages.forEach((stage, index) => {
                GRID_SIZE = stage.gridSize;
                activeDirections = level === 1 && index < 5 ? DIRECTIONS.slice(0, 2)
                    : level === 1 && index < 15 ? DIRECTIONS.slice(0, 4) : DIRECTIONS;
                const result = runEvolutionaryPlacement(stage.words.map(w => ({ ...w })),
                    mulberry32(level * 10000 + index + 1 + globalSeed));
                result.placedWords.forEach(word => {
                    const path = result.paths[word.reading];
                    if (path && path.map(p => result.grid[p.r][p.c]).join('') === word.reading) ids.add(word.id);
                    else failed++;
                });
            });
            const missing = WORDS_DB[level].filter(w => !ids.has(w.id));
            report += `\n${levelLabel(level)}：${ids.size}/${WORDS_DB[level].length} 詞，${stages.length} 關`;
            report += missing.length || failed ? `；缺漏 ${missing.length}，錯誤 ${failed}\n` : '，100% 放置成功\n';
        }
    } finally {
        GRID_SIZE = previousSize;
        activeDirections = previousDirections;
    }
    reportContent.textContent = report;
    reportModal.classList.remove('hidden');
}

        // === 事件綁定與初始化 ===

        function initializeGameSystem() {
            maxUnlocked = loadProgress();
            globalSeed = loadGlobalSeed();
            loadDifficultWords();

            gridContainer.addEventListener('pointerdown', handlePointerDown);
            window.addEventListener('pointermove', handlePointerMove, { passive: false });
            window.addEventListener('pointerup', handlePointerUp);
            window.addEventListener('pointercancel', () => {
                isSelecting = false; startCell = null; clearSelectionUI();
            });

            btnRestart.addEventListener('click', initGame);
            btnPlayAgain.addEventListener('click', initGame);
            btnGiveUp.addEventListener('click', giveUp);
            btnResetData.addEventListener('click', resetGameData);
            btnDownloadDifficult.addEventListener('click', downloadDifficultWords);
            btnSimulation.addEventListener('click', runSimulation); // 綁定模擬按鈕

            const goToNextLevel = () => {
                const currentLevelNum = parseInt(levelSelect.value);
                const currentStageNum = parseInt(stageSelect.value);
                const totalStages = getOrGenerateStages(currentLevelNum).length;

                if (currentStageNum < totalStages) {
                    stageSelect.value = currentStageNum + 1;
                    initGame();
                } else if (currentLevelNum < 5) {
                    levelSelect.value = currentLevelNum + 1;
                    updateStageDropdown(currentLevelNum + 1);
                    stageSelect.value = 1;
                    initGame();
                }
            };

            btnNextLevel.addEventListener('click', goToNextLevel);
            btnHeaderNext.addEventListener('click', goToNextLevel);

            const hideOverlay = () => winOverlay.classList.add('hidden');
            btnCloseOverlay.addEventListener('click', hideOverlay);
            btnViewBoard.addEventListener('click', hideOverlay);

            levelSelect.addEventListener('change', (e) => {
                updateStageDropdown(parseInt(e.target.value));
                initGame();
            });

            stageSelect.addEventListener('change', initGame);

            updateLevelDropdownState();
            updateStageDropdown(1);

            if(maxUnlocked.level > 1 || maxUnlocked.stage > 1) {
                 levelSelect.value = maxUnlocked.level;
                 updateStageDropdown(maxUnlocked.level);
                 stageSelect.value = Math.min(maxUnlocked.stage, getOrGenerateStages(maxUnlocked.level).length);
            }

            // 真正開始第一局
            initGame();
                    // 超級模式觸發邏輯：點擊標題 5 次
        let clickCount = 0;
        let clickTimer = null;
        const gameTitle = document.getElementById('game-title');

        if (gameTitle) {
            gameTitle.addEventListener('click', () => {
                clickCount++;

                // 檢查是否達到 5 次
                // ... inside initializeGameSystem ...


                if(clickCount === 5) {
                    // === 啟動超級模式 ===
                    maxUnlocked = { level: 5, stage: 999 }; // 設定解鎖到最高等級

                    // 更新介面選單狀態
                    updateLevelDropdownState();
                    updateStageDropdown(parseInt(levelSelect.value));
                    // Show simulation button
                    btnSimulation.classList.remove('hidden');
                    alert('🔓 超級模式啟動！所有關卡已解鎖。\n設定選單已啟用「驗證單字覆蓋率」功能。');

                    // 重置計數器
                    clickCount = 0;
                    if(clickTimer) clearTimeout(clickTimer);
                }

                // 設定計時器：如果 1 秒內沒再點擊，計數歸零
                if(clickTimer) clearTimeout(clickTimer);
                clickTimer = setTimeout(() => {
                    clickCount = 0;
                }, 1000);
            });
        }

        }

        // 程式進入點
        initializeGameSystem();

