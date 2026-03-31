// QLN — Tool schema normalization + trigger extraction
// Converts tools from various sources (MCP, plugins, local) into a standard format
import type { ToolEntry, RawToolEntry } from '../types';

/**
 * Convert raw tool data to a normalized entry.
 */
export function createToolEntry(raw: RawToolEntry): ToolEntry {
  return {
    name: raw.name || '',
    description: raw.description || '',
    source: raw.source || 'unknown',
    category: raw.category || 'misc',
    provider: raw.provider || raw.pluginName || raw.name || '',
    inputSchema: raw.inputSchema || null,
    triggers: raw.triggers || extractTriggers(raw.name, raw.description, raw.tags),
    tags: raw.tags || [],
    examples: raw.examples || [],
    endpoint: raw.endpoint || '',
    searchText: '',
    boostKeywords: raw.boostKeywords || '',
    usageCount: raw.usageCount || 0,
    successRate: typeof raw.successRate === 'number' ? raw.successRate : 1.0,
    consecutiveFailures: 0,
    lastUsedAt: raw.lastUsedAt || null,
    embedding: raw.embedding || null,
    registeredAt: raw.registeredAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Build searchable text from tool entry.
 * Used by Stage 2 (keyword matching) and Stage 3 (embedding generation).
 */
export function buildSearchText(entry: ToolEntry): string {
  const parts: string[] = [
    entry.name,
    entry.description,
    entry.category,
    entry.provider,
  ];
  // boostKeywords gets double weight — it's a curated capability phrase
  if (entry.boostKeywords) {
    parts.push(entry.boostKeywords);
    parts.push(entry.boostKeywords); // intentional duplication for BM25 term frequency boost
  }
  if (entry.triggers?.length > 0) parts.push(entry.triggers.join(' '));
  if (entry.tags?.length > 0) parts.push(entry.tags.join(' '));
  if (entry.examples?.length > 0) parts.push(entry.examples.join(' '));
  return parts.filter(Boolean).join(' ').toLowerCase();
}

/**
 * Auto-extract trigger words from tool name/description.
 * Used by Stage 1 (exact matching).
 */
export function extractTriggers(name: string, description: string = '', tags: string[] = []): string[] {
  const triggers: string[] = [];
  if (name) {
    triggers.push(name);
    const parts = name.split(/[_\-\.]/);
    if (parts.length > 1) triggers.push(...parts);
  }
  if (description) {
    const firstWord = description.trim().split(/\s+/)[0]?.toLowerCase();
    if (firstWord && firstWord.length > 2 && !triggers.includes(firstWord)) {
      triggers.push(firstWord);
    }
  }
  if (tags && tags.length > 0) {
    for (const tag of tags) {
      if (tag.length > 2 && !triggers.includes(tag)) triggers.push(tag);
    }
  }
  return [...new Set(triggers.filter(t => t.length > 1))];
}

/**
 * Infer category from tool name/source.
 */
export function inferCategory(name: string, source: string = 'unknown'): string {
  const lower = (name || '').toLowerCase();
  if (lower.includes('screenshot') || lower.includes('capture') || lower.includes('record')) return 'capture';
  if (lower.includes('scroll') || lower.includes('tab') || lower.includes('read_page') || lower.includes('navigate')) return 'web';
  if (lower.includes('extract') || lower.includes('scrape') || lower.includes('parse')) return 'data';
  if (lower.includes('search') || lower.includes('ai') || lower.includes('query')) return 'ai';
  if (lower.includes('file') || lower.includes('write') || lower.includes('read')) return 'file';
  if (lower.includes('code') || lower.includes('compile') || lower.includes('lint')) return 'dev';
  if (source === 'mcp') return 'mcp';
  return 'misc';
}
