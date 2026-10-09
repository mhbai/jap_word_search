// Run: node --test tests/vocabulary.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');

function engine() {
    const element = { checked: true, addEventListener() {} };
    const context = vm.createContext({
        document: { getElementById: () => element },
        localStorage: { getItem: () => null }, window: {}, console,
    });
    vm.runInContext(fs.readFileSync(path.join(root, 'words_db.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(root, 'vendor/wanakana.min.js'), 'utf8'), context);
    const source = fs.readFileSync(path.join(root, 'game.js'), 'utf8')
        .replace(/^\s*initializeGameSystem\(\);\s*$/m, '');
    vm.runInContext(source, context);
    return { context, run: code => vm.runInContext(code, context) };
}

test('all 7,734 source entries have unique IDs, valid kana, meanings and correct levels', () => {
    const { run } = engine();
    const levels = run('WORDS_DB');
    const ids = new Set();
    for (const [level, expected] of [[1, 667], [2, 630], [3, 1647], [4, 1737], [5, 3053]]) {
        assert.equal(levels[level].length, expected);
        for (const word of levels[level]) {
            assert.equal(word.jlpt, `N${6 - level}`);
            assert.match(word.reading, /^[\u3041-\u3096\u30a1-\u30faー]+$/u);
            assert.equal(word.reading, word.reading.normalize('NFC'));
            assert.ok(word.meaning);
            assert.ok(!ids.has(word.id));
            ids.add(word.id);
        }
    }
    assert.equal(ids.size, 7734);
    for (const [expression, reading] of [['ＯＫ', 'オーケー'], ['ＯＵＴ', 'アウト'], ['ＦＡＸ', 'ファックス']]) {
        assert.equal(Object.values(levels).flat().find(w => w.expression === expression).reading, reading);
    }
});

for (const seed of [0, 123456, 999998]) {
    test(`every entry is scheduled exactly once and actually placed, seed ${seed}`, () => {
        const { context, run } = engine();
        run(`globalSeed = ${seed}`);
        for (let level = 1; level <= 5; level++) {
            const stages = run(`getOrGenerateStages(${level})`);
            const expected = Array.from(run(`WORDS_DB[${level}]`), w => w.id);
            const actual = [];
            stages.forEach((stage, index) => {
                assert.ok(stage.gridSize <= 12);
                const readings = new Set();
                for (const word of stage.words) {
                    assert.ok(!readings.has(word.reading));
                    assert.ok(!readings.has([...word.reading].reverse().join('')));
                    readings.add(word.reading);
                }
                context.stageUnderTest = stage;
                const result = run(`
                    GRID_SIZE = stageUnderTest.gridSize;
                    activeDirections = ${level} === 1 && ${index} < 5 ? DIRECTIONS.slice(0, 2)
                        : ${level} === 1 && ${index} < 15 ? DIRECTIONS.slice(0, 4) : DIRECTIONS;
                    runEvolutionaryPlacement(stageUnderTest.words.map(w => ({...w})),
                        mulberry32(${level * 10000 + index + 1 + seed}));
                `);
                assert.equal(result.placedWords.length, stage.words.length);
                for (const word of result.placedWords) {
                    const coordinates = result.paths[word.reading];
                    assert.equal(coordinates.length, word.reading.length);
                    assert.equal(coordinates.map(p => result.grid[p.r][p.c]).join(''), word.reading);
                    actual.push(word.id);
                }
            });
            assert.deepEqual(actual.sort(), expected.sort());
        }
    });
}

test('placement fallback preserves every word when random placement fails', () => {
    const { run } = engine();
    const result = run(`
        GRID_SIZE = 10;
        const difficult = Array.from({length: 10}, (_, i) => ({id: String(i), reading: 'あ'.repeat(9) + String.fromCharCode(0x3044 + i)}));
        tryBuildGrid = () => ({grid: [], paths: {}, placedWords: [], failedWords: difficult, intersections: 0});
        runEvolutionaryPlacement(difficult, mulberry32(0));
    `);
    assert.equal(result.placedWords.length, 10);
    for (const word of result.placedWords) {
        assert.equal(result.paths[word.reading].map(p => result.grid[p.r][p.c]).join(''), word.reading);
    }
});

test('shared kana are placed at a crossing when a crossing fits', () => {
    const { run } = engine();
    const result = run(`
        GRID_SIZE = 7;
        activeDirections = DIRECTIONS.slice(0, 2);
        tryBuildGrid([{reading:'あいう'}, {reading:'かいき'}], mulberry32(123));
    `);
    assert.equal(result.placedWords.length, 2);
    assert.equal(result.crossings, 1);
    const first = result.paths['あいう'];
    const second = result.paths['かいき'];
    assert.equal(first[1].r, second[1].r);
    assert.equal(first[1].c, second[1].c);
    assert.notEqual(first[2].r - first[0].r, second[2].r - second[0].r);
});

test('complete grids still receive all 15 placement attempts', () => {
    const { run } = engine();
    const attempts = run(`
        GRID_SIZE = 6;
        let count = 0;
        const originalBuilder = tryBuildGrid;
        tryBuildGrid = (words, rng) => { count++; return originalBuilder(words, rng); };
        runEvolutionaryPlacement([{reading:'でんわ'}], mulberry32(123));
        count;
    `);
    assert.equal(attempts, 15);
});

test('words without shared kana are still placed and do not claim a crossing', () => {
    const { run } = engine();
    const result = run(`
        GRID_SIZE = 6;
        activeDirections = DIRECTIONS;
        tryBuildGrid([{reading:'あいう'}, {reading:'かきく'}], mulberry32(123));
    `);
    assert.equal(result.placedWords.length, 2);
    assert.equal(result.intersections, 0);
    assert.equal(result.crossings, 0);
    assert.equal(run('canPlaceWordInGrid(Array.from({length:6},()=>Array(6).fill("")), "あい", 6, 0, -1, 0)'), false);
});

test('single-cell selections, small kana and long vowels preserve spelling', () => {
    const { run } = engine();
    assert.equal(run('calculateLine(2, 3, 2, 3).length'), 1);
    assert.equal(run("answerText({expression:'学校', reading:'がっこう'})"), '学校（がっこう）');
    assert.equal(run("answerText({expression:'スクール', reading:'スクール'})"), 'スクール');
});

test('romaji handles small kana, doubled consonants, long vowels and loanwords', () => {
    const { context, run } = engine();
    for (const [reading, expected] of [
        ['でんわ', 'denwa'], ['がっこう', 'gakkou'], ['きょう', 'kyou'],
        ['しんよう', "shin'you"], ['スクール', 'sukuuru'], ['コーヒー', 'koohii'],
        ['ティッシュ', 'tisshu'], ['ウェイター', 'weitaa'], ['ディーゼル', 'diizeru'],
        ['ジェット', 'jetto'], ['チェック', 'chekku'], ['ファックス', 'fakkusu'],
        ['しーん', 'shiin'], ['ヶげつ', 'kagetsu'],
    ]) {
        context.readingUnderTest = reading;
        assert.equal(run('romajiText({reading:readingUnderTest})'), expected);
    }
    assert.equal(run(`Object.values(WORDS_DB).flat().filter(w => !/^[a-z']+$/.test(romajiText(w))).length`), 0);
});
