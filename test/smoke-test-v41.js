// QLN v4.1.0 — Full Integration Smoke Test
// Tests: Boot → Provider Load → Search → Auto → Stats → Circuit Breaker → Fallback
const { spawn } = require('child_process');
const path = require('path');

const SERVER = path.join(__dirname, '..', 'dist', 'index.js');
const PKG_VERSION = require(path.join(__dirname, '..', 'package.json')).version;
let requestId = 0;
let passed = 0;
let failed = 0;
const results = [];

function jsonrpc(method, params = {}) {
  return JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params });
}

function qlnCall(params) {
  return jsonrpc('tools/call', { name: 'n2_qln_call', arguments: params });
}

async function runTests() {
  console.log('\n🧪 QLN v4.1.0 Smoke Test\n' + '─'.repeat(50));

  const proc = spawn('node', [SERVER], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'test' },
  });

  let buffer = '';
  const responses = [];
  let resolveNext = null;

  proc.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (resolveNext) {
          const r = resolveNext;
          resolveNext = null;
          r(msg);
        } else {
          responses.push(msg);
        }
      } catch { /* non-JSON line */ }
    }
  });

  proc.stderr.on('data', (data) => {
    const text = data.toString().trim();
    if (text) console.log(`  [stderr] ${text}`);
  });

  function send(msg) {
    return new Promise((resolve) => {
      resolveNext = resolve;
      proc.stdin.write(msg + '\n');
    });
  }

  function assert(name, condition, detail = '') {
    if (condition) {
      console.log(`  ✅ ${name}`);
      passed++;
    } else {
      console.log(`  ❌ ${name} ${detail}`);
      failed++;
    }
    results.push({ name, passed: condition });
  }

  // Wait for server boot
  await new Promise(r => setTimeout(r, 2000));

  // ── T1: Initialize ──
  console.log('\n📡 T1: MCP Initialize');
  const initResp = await send(jsonrpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'qln-test', version: '1.0.0' },
  }));
  assert('Initialize response', initResp?.result?.serverInfo?.name === 'n2-qln');
  assert(`Version ${PKG_VERSION}`, initResp?.result?.serverInfo?.version === PKG_VERSION);

  // Send initialized notification
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  await new Promise(r => setTimeout(r, 500));

  // ── T2: List Tools (should have n2_qln_call) ──
  console.log('\n📡 T2: List Tools');
  const toolsResp = await send(jsonrpc('tools/list'));
  const tools = toolsResp?.result?.tools || [];
  assert('Has n2_qln_call', tools.some(t => t.name === 'n2_qln_call'));
  assert('Only 1 tool exposed', tools.length === 1, `(got ${tools.length})`);

  // Check discover is in the action enum
  const qlnTool = tools.find(t => t.name === 'n2_qln_call');
  const actionDesc = qlnTool?.inputSchema?.properties?.action?.description || '';
  assert('Discover action in schema', actionDesc.includes('discover'));

  // ── T3: Stats (should show loaded providers) ──
  console.log('\n📡 T3: Stats');
  const statsResp = await send(qlnCall({ action: 'stats' }));
  const statsText = statsResp?.result?.content?.[0]?.text || '';
  assert('Stats returns data', statsText.includes('QLN Stats'));
  assert('Tools > 0', !statsText.includes('Tools: 0'));
  assert('Circuit Breaker in stats', statsText.includes('Circuit Breaker'));

  // Extract tool count
  const toolCountMatch = statsText.match(/Tools:\s*(\d+)/);
  const toolCount = toolCountMatch ? parseInt(toolCountMatch[1]) : 0;
  console.log(`  📊 Registry: ${toolCount} tools loaded`);

  // ── T4: Search — keyword match ──
  console.log('\n📡 T4: Search (keyword)');
  const searchResp = await send(qlnCall({ action: 'search', query: 'send email notification' }));
  const searchText = searchResp?.result?.content?.[0]?.text || '';
  assert('Search finds send_email', searchText.includes('send_email'));
  assert('Has score', /\(\d/.test(searchText), `response: ${searchText.slice(0, 100)}`);

  // ── T5: Search — different query ──
  console.log('\n📡 T5: Search (screenshot)');
  const searchResp2 = await send(qlnCall({ action: 'search', query: 'capture screen image' }));
  const searchText2 = searchResp2?.result?.content?.[0]?.text || '';
  assert('Search finds take_screenshot', searchText2.includes('take_screenshot'));

  // ── T6: Auto — should search + match ──
  console.log('\n📡 T6: Auto (no handler — fallback test)');
  const autoResp = await send(qlnCall({ action: 'auto', query: 'read a file from disk' }));
  const autoText = autoResp?.result?.content?.[0]?.text || '';
  const autoIsError = autoResp?.result?.isError;
  // Auto should find read_file but fail on exec (no handler registered)
  assert('Auto finds read_file', autoText.includes('read_file'));
  // Since no handler, it should fail — but the fallback chain should activate
  assert('Auto handles missing handler gracefully', autoText.length > 0);

  // ── T7: Create → Search → Delete ──
  console.log('\n📡 T7: CRUD lifecycle');
  const createResp = await send(qlnCall({
    action: 'create',
    name: 'test_dynamic_tool',
    description: 'A dynamically created test tool for smoke testing',
    category: 'misc',
    tags: ['dynamic', 'smoke-test'],
  }));
  const createText = createResp?.result?.content?.[0]?.text || '';
  assert('Create succeeds', createText.includes('Created') || createText.includes('test_dynamic_tool'), `resp: ${createText.slice(0, 100)}`);

  const searchCreated = await send(qlnCall({ action: 'search', query: 'dynamic smoke test' }));
  const searchCreatedText = searchCreated?.result?.content?.[0]?.text || '';
  assert('Search finds created tool', searchCreatedText.includes('test_dynamic_tool'), `resp: ${searchCreatedText.slice(0, 100)}`);

  const deleteResp = await send(qlnCall({ action: 'delete', tool: 'test_dynamic_tool' }));
  const deleteText = deleteResp?.result?.content?.[0]?.text || '';
  assert('Delete succeeds', deleteText.includes('test_dynamic_tool') || deleteText.includes('✅'));

  // ── T8: Inject (bulk) ──
  console.log('\n📡 T8: Inject (bulk registration)');
  const injectResp = await send(qlnCall({
    action: 'inject',
    tools: [
      { name: 'bulk_tool_1', description: 'First bulk tool', category: 'test' },
      { name: 'bulk_tool_2', description: 'Second bulk tool', category: 'test' },
    ],
    source: 'smoke-test',
  }));
  const injectText = injectResp?.result?.content?.[0]?.text || '';
  assert('Inject 2 tools', injectText.includes('2'));

  // ── T9: Discover (no server — error handling) ──
  console.log('\n📡 T9: Discover (validation)');
  const discoverResp = await send(qlnCall({ action: 'discover' }));
  const discoverText = discoverResp?.result?.content?.[0]?.text || '';
  assert('Discover validates missing params', discoverText.includes('Missing') || discoverText.includes('Provide'));

  // ── T10: boostKeywords effectiveness ──
  console.log('\n📡 T10: boostKeywords search boost');
  const boostSearch = await send(qlnCall({ action: 'search', query: 'smtp outbound' }));
  const boostText = boostSearch?.result?.content?.[0]?.text || '';
  assert('boostKeywords improves search', boostText.includes('send_email'));

  // ── Summary ──
  console.log('\n' + '─'.repeat(50));
  console.log(`\n🏁 Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log(passed === passed + failed ? '\n🎉 ALL TESTS PASSED!' : '\n⚠️ Some tests failed.');

  // Cleanup
  proc.kill('SIGTERM');
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
