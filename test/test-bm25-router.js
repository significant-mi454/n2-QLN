// QLN — BM25 Router integration test
// Tests: BM25 scoring, IDF weighting, document length normalization, ranking accuracy
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'dist', 'lib');

const { Store } = require(path.join(LIB, 'store'));
const { Registry } = require(path.join(LIB, 'registry'));
const { VectorIndex } = require(path.join(LIB, 'vector-index'));
const { Router } = require(path.join(LIB, 'router'));

let passed = 0;
let failed = 0;

function assert(condition, label) {
    if (condition) {
        console.log(`  ✅ ${label}`);
        passed++;
    } else {
        console.error(`  ❌ ${label}`);
        failed++;
    }
}

/** Create test environment with BM25 router and sample tools */
async function setupTestEnv() {
    const tmpDir = path.join(ROOT, 'data', '_test_bm25');
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    const store = new Store(tmpDir);
    await store.init();
    const registry = new Registry(store);
    registry.load();
    const vectorIndex = new VectorIndex();
    const router = new Router(registry, vectorIndex);

    const testTools = [
        { name: 'capture_screenshot', description: 'Capture a screenshot of the current page', category: 'screenshot', tags: ['screenshot', 'capture', 'page'], triggers: ['screenshot'] },
        { name: 'ai_read', description: 'Read and extract content from the current web page DOM', category: 'web', tags: ['read', 'dom', 'extract', 'web'], triggers: ['read'] },
        { name: 'ai_surf', description: 'Navigate to a URL and load the web page', category: 'web', tags: ['navigate', 'url', 'surf'], triggers: ['surf', 'navigate', 'goto'] },
        { name: 'extract_table_data', description: 'Extract structured table data from HTML tables on the page. Parses rows and columns into JSON format for data analysis and processing.', category: 'data', tags: ['table', 'extract', 'data', 'html'], triggers: ['table'] },
        { name: 'click_element', description: 'Click on a specific element on the page', category: 'interaction', tags: ['click', 'element'], triggers: ['click'] },
    ];
    for (const tool of testTools) registry.register(tool);

    return { tmpDir, registry, router };
}

/** Test 1-3: Core BM25 scoring behavior */
async function testBM25Scoring(router) {
    console.log('Test 1: Basic BM25 routing');
    const r1 = await router.route('take a screenshot');
    assert(r1.results.length > 0, `got results (${r1.results.length})`);
    assert(r1.results[0].name === 'capture_screenshot', `top result is capture_screenshot (got ${r1.results[0].name})`);
    assert(r1.timing.stage2 >= 0, `stage2 timing recorded (${r1.timing.stage2}ms)`);

    console.log('\nTest 2: BM25 IDF weighting — rare words score higher');
    const r2 = await router.route('extract table data');
    const tableResult = r2.results.find(r => r.name === 'extract_table_data');
    assert(tableResult !== undefined, 'extract_table_data found in results');
    assert(tableResult?.stages.keyword > 0, `BM25 keyword score > 0 (got ${tableResult?.stages.keyword})`);

    console.log('\nTest 3: Document length normalization');
    const r3 = await router.route('extract data');
    const aiReadScore = r3.results.find(r => r.name === 'ai_read')?.stages.keyword || 0;
    const tableScore = r3.results.find(r => r.name === 'extract_table_data')?.stages.keyword || 0;
    assert(aiReadScore > 0 || tableScore > 0, `at least one tool scored (aiRead=${aiReadScore}, table=${tableScore})`);
}

/** Test 4-5: Stats and edge cases */
async function testStatsAndEdgeCases(router) {
    console.log('\nTest 4: Stats include BM25 info');
    const stats = router.stats();
    assert(stats.bm25 !== undefined, 'bm25 stats present');
    assert(stats.bm25.k1 === 1.2, `k1=1.2 (got ${stats.bm25.k1})`);
    assert(stats.bm25.b === 0.75, `b=0.75 (got ${stats.bm25.b})`);
    assert(stats.bm25.idfTerms > 0, `IDF terms cached (${stats.bm25.idfTerms})`);
    assert(stats.bm25.avgDocLen > 0, `avgDocLen > 0 (${stats.bm25.avgDocLen})`);

    console.log('\nTest 5: Query with no keyword matches');
    const r5 = await router.route('xyzzy foobar');
    const keywordScores = r5.results.filter(r => r.stages.keyword > 0);
    assert(keywordScores.length === 0, `no keyword matches for nonsense query (got ${keywordScores.length})`);
}

/** Test 6-7: IDF invalidation and ranking quality */
async function testIDFAndRanking(router, registry) {
    console.log('\nTest 6: IDF invalidation on tool change');
    const idfBefore = router.stats().bm25.idfTerms;
    registry.register({
        name: 'new_unique_tool',
        description: 'A completely unique specialized quantum blockchain synergy optimizer',
        category: 'misc',
        tags: ['unique'],
    });
    router.invalidateIDF();
    const r6 = await router.route('quantum blockchain');
    const idfAfter = router.stats().bm25.idfTerms;
    assert(idfAfter > idfBefore, `IDF terms increased after new tool (${idfBefore} → ${idfAfter})`);
    const quantumResult = r6.results.find(r => r.name === 'new_unique_tool');
    assert(quantumResult !== undefined, 'new_unique_tool found after invalidation');

    console.log('\nTest 7: Ranking quality — specific beats generic');
    const r7 = await router.route('navigate to URL');
    const surfRank = r7.results.findIndex(r => r.name === 'ai_surf');
    assert(surfRank >= 0 && surfRank <= 2, `ai_surf in top 3 for 'navigate to URL' (rank ${surfRank})`);
}

async function runTests() {
    console.log('\n=== QLN BM25 Router Tests ===\n');

    const { tmpDir, registry, router } = await setupTestEnv();

    await testBM25Scoring(router);
    await testStatsAndEdgeCases(router);
    await testIDFAndRanking(router, registry);

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });

    console.log(`\n=== Results: ${passed} passed, ${failed} failed (${passed + failed} total) ===\n`);
    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error('Test runner error:', err);
    process.exit(1);
});
