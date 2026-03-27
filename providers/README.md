# providers/

Tool provider manifests for bulk registration.
Each `*.json` file defines a provider and its tools for automatic indexing at QLN boot.

## Manifest JSON Format

```json
{
 "provider": "my-mcp-server",
 "version": "1.0.0",
 "description": "Short description of this provider",
 "tools": [
 {
 "name": "tool_name",
 "description": "What this tool does (used for search matching)",
 "category": "web|data|capture|ai|file|dev|misc",
 "tags": ["keyword1", "keyword2"],
 "examples": ["natural language query that should match this tool"],
 "inputSchema": {
 "properties": {
 "param1": { "type": "string", "description": "..." }
 }
 }
 }
 ]
}
```

## Required Fields

| Field | Level | Description |
|-------|-------|-------------|
| `provider` | Manifest | Unique provider name (used as `source: "provider:{name}"`) |
| `tools` | Manifest | Array of tool definitions |
| `name` | Tool | Unique tool identifier |
| `description` | Tool | Tool description (critical for search matching) |

## Optional Fields

| Field | Level | Default | Description |
|-------|-------|---------|-------------|
| `version` | Manifest | `"1.0.0"` | Provider version |
| `description` | Manifest | `""` | Provider description |
| `category` | Tool | auto-inferred | Tool category |
| `tags` | Tool | `[]` | Additional search keywords |
| `examples` | Tool | `[]` | Natural language usage examples |
| `inputSchema` | Tool | `null` | JSON Schema for tool parameters |

## Behavior

- **Boot auto-load**: All `*.json` files are scanned at QLN startup
- **Idempotent**: Safe to restart — existing entries are purged and re-registered
- **Error isolation**: Invalid files are skipped without affecting others
- **Disable**: Set `providers.enabled: false` in `config.local.js`
