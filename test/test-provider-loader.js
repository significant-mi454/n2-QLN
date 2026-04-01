// QLN — Provider Loader integration test
// Tests: valid JSON loading, empty dir, invalid JSON, missing fields, idempotent re-run
const path = require('path');
const fs = require('fs');

// Paths
const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'dist', 'lib');

// Direct module imports (avoid full MCP server boot)
const { Store } = require(path.join(LIB, 'store'));
const { Registry } = require(path.join(LIB, 'registry'));
const { loadProviders } = require(path.join(LIB, 'provider-loader'));

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

async function runTests() {
    console.log('\n=== QLN Provider Loader Tests ===\n');

    // Setup — use temp data dir to avoid polluting real DB
    const tmpDir = path.join(ROOT, 'data', '_test_provider');
    const tmpProviders = path.join(tmpDir, 'providers');
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
    fs.mkdirSync(tmpProviders, { recursive: true });

    const store = new Store(tmpDir);
    await store.init();
    const registry = new Registry(store);
    registry.load();

    // ─── Test 1: Empty providers directory ───
    console.log('Test 1: Empty providers directory');
    const r1 = loadProviders(tmpProviders, registry);
    assert(r1.loaded === 0, `loaded=0 (got ${r1.loaded})`);
    assert(r1.failed === 0, `failed=0 (got ${r1.failed})`);
    assert(r1.skipped === 0, `skipped=0 (got ${r1.skipped})`);

    // ─── Test 2: Valid manifest loading ───
    console.log('\nTest 2: Valid manifest loading');
    const validManifest = {
        provider: 'test-provider',
        version: '1.0.0',
        description: 'Test provider',
        tools: [
            { name: 'test_tool_1', description: 'First test tool', category: 'misc', tags: ['test'] },
            { name: 'test_tool_2', description: 'Second test tool', category: 'web', tags: ['web'] },
            { name: 'test_tool_3', description: 'Third test tool', category: 'data', examples: ['extract data'] },
        ],
    };
    fs.writeFileSync(path.join(tmpProviders, 'test.json'), JSON.stringify(validManifest, null, 2));

    const r2 = loadProviders(tmpProviders, registry);
    assert(r2.loaded === 3, `loaded=3 (got ${r2.loaded})`);
    assert(r2.failed === 0, `failed=0 (got ${r2.failed})`);
    assert(registry.size === 3, `registry.size=3 (got ${registry.size})`);

    const tool1 = registry.get('test_tool_1');
    assert(tool1 !== null, 'test_tool_1 exists in registry');
    assert(tool1?.source === 'provider:test-provider', `source=provider:test-provider (got ${tool1?.source})`);
    assert(tool1?.provider === 'test-provider', `provider=test-provider (got ${tool1?.provider})`);

    // ─── Test 3: Idempotent re-run ───
    console.log('\nTest 3: Idempotent re-run');
    const r3 = loadProviders(tmpProviders, registry);
    assert(r3.loaded === 3, `loaded=3 on re-run (got ${r3.loaded})`);
    assert(registry.size === 3, `registry.size still 3 (got ${registry.size})`);

    // ─── Test 4: Invalid JSON file ───
    console.log('\nTest 4: Invalid JSON file');
    fs.writeFileSync(path.join(tmpProviders, 'broken.json'), '{ invalid json }}}');
    const r4 = loadProviders(tmpProviders, registry);
    assert(r4.failed === 1, `failed=1 for broken JSON (got ${r4.failed})`);
    assert(r4.loaded === 3, `loaded=3 (valid file still loads) (got ${r4.loaded})`);

    // ─── Test 5: Missing required fields ───
    console.log('\nTest 5: Missing required fields');
    fs.unlinkSync(path.join(tmpProviders, 'broken.json'));
    fs.writeFileSync(path.join(tmpProviders, 'no-provider.json'), JSON.stringify({ tools: [] }));
    fs.writeFileSync(path.join(tmpProviders, 'no-tools.json'), JSON.stringify({ provider: 'x' }));
    const r5 = loadProviders(tmpProviders, registry);
    assert(r5.skipped >= 2, `skipped≥2 for missing fields (got ${r5.skipped})`);
    assert(r5.loaded === 3, `loaded=3 (valid file unaffected) (got ${r5.loaded})`);

    // ─── Test 6: Tools with missing name/desc get skipped ───
    console.log('\nTest 6: Tools with missing name/description');
    fs.unlinkSync(path.join(tmpProviders, 'no-provider.json'));
    fs.unlinkSync(path.join(tmpProviders, 'no-tools.json'));
    const partialManifest = {
        provider: 'partial-provider',
        tools: [
            { name: 'good_tool', description: 'This is valid' },
            { name: 'no_desc_tool' },
            { description: 'no name tool' },
        ],
    };
    fs.writeFileSync(path.join(tmpProviders, 'partial.json'), JSON.stringify(partialManifest));
    const r6 = loadProviders(tmpProviders, registry);
    const goodTool = registry.get('good_tool');
    assert(goodTool !== null, 'good_tool registered');
    assert(registry.get('no_desc_tool') === null, 'no_desc_tool skipped (no description)');

    // ─── Test 7: Large manifest (self-contained mock) ───
    console.log('\nTest 7: Large provider manifest (mock)');
    // Clean up previous temp, create fresh environment
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
    fs.mkdirSync(tmpProviders, { recursive: true });

    const largeStore = new Store(path.join(ROOT, 'data', '_test_large'));
    if (fs.existsSync(path.join(ROOT, 'data', '_test_large'))) {
        fs.rmSync(path.join(ROOT, 'data', '_test_large'), { recursive: true });
    }
    fs.mkdirSync(path.join(ROOT, 'data', '_test_large'), { recursive: true });
    await largeStore.init();
    const largeRegistry = new Registry(largeStore);
    largeRegistry.load();

    // Generate a realistic provider manifest with 30 tools
    const largeManifest = {
        provider: 'mock-browser',
        version: '1.0.0',
        description: 'Mock browser provider for testing',
        tools: Array.from({ length: 30 }, (_, i) => ({
            name: `mock_tool_${i + 1}`,
            description: `Mock tool ${i + 1} for testing provider loader`,
            category: ['web', 'screenshot', 'dom', 'data', 'nav'][i % 5],
            tags: [`tag_${i % 3}`, 'mock'],
        })),
    };
    fs.writeFileSync(path.join(tmpProviders, 'mock-browser.json'), JSON.stringify(largeManifest, null, 2));

    const r7 = loadProviders(tmpProviders, largeRegistry);
    assert(r7.loaded === 30, `loaded=30 from mock manifest (got ${r7.loaded})`);
    assert(r7.failed === 0, `failed=0 (got ${r7.failed})`);

    const mockTool1 = largeRegistry.get('mock_tool_1');
    assert(mockTool1 !== null, 'mock_tool_1 registered');
    assert(mockTool1?.provider === 'mock-browser', `provider=mock-browser (got ${mockTool1?.provider})`);
    assert(mockTool1?.tags?.includes('mock'), 'has mock tag');

    const mockTool15 = largeRegistry.get('mock_tool_15');
    assert(mockTool15 !== null, 'mock_tool_15 registered');
    assert(mockTool15?.category === 'nav', `category=nav (got ${mockTool15?.category})`);

    // Cleanup
    fs.rmSync(path.join(ROOT, 'data', '_test_large'), { recursive: true });
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });

    // ─── Summary ───
    console.log(`\n=== Results: ${passed} passed, ${failed} failed (${passed + failed} total) ===\n`);
    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error('Test runner error:', err);
    process.exit(1);
});
