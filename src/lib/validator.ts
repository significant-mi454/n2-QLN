// QLN — Tool registration validator (validator.rs pattern)
// Enforced validation: errors reject registration, warnings pass with message.
import type { ValidationError } from '../types';

/** Valid tool categories */
export const VALID_CATEGORIES = ['web', 'data', 'file', 'dev', 'ai', 'capture', 'misc'] as const;

/** Tool name pattern: verb_target (e.g. read_pdf, take_screenshot) */
export const NAME_PATTERN = /^[a-z]+_[a-z][a-z0-9_]*$/;

/** Minimum description length */
export const MIN_DESCRIPTION_LENGTH = 10;

export interface ValidatableParams {
  name?: string;
  description?: string;
  category?: string;
  tags?: string[];
  [key: string]: unknown;
}

interface RegistryLike {
  get(name: string): unknown | null;
}

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/** Validate name: required + verb_target format */
function _validateName(name: string | undefined, errors: ValidationError[]): void {
  if (!name || name.trim() === '') {
    errors.push({ field: 'name', message: 'name is required', severity: 'error' });
  } else if (!NAME_PATTERN.test(name)) {
    errors.push({ field: 'name', message: `'${name}' must follow verb_target format (e.g. read_pdf, take_screenshot)`, severity: 'error' });
  }
}

/** Validate description: required + min length */
function _validateDescription(desc: string | undefined, errors: ValidationError[]): void {
  if (!desc || desc.trim() === '') {
    errors.push({ field: 'description', message: 'description is required (explain what the tool does)', severity: 'error' });
  } else if (desc.trim().length < MIN_DESCRIPTION_LENGTH) {
    errors.push({ field: 'description', message: `minimum ${MIN_DESCRIPTION_LENGTH} characters required (current: ${desc.trim().length})`, severity: 'error' });
  }
}

/** Validate category: must be in enum */
function _validateCategory(category: string | undefined, errors: ValidationError[]): void {
  if (category && !(VALID_CATEGORIES as readonly string[]).includes(category)) {
    errors.push({ field: 'category', message: `'${category}' is not valid — use one of: ${VALID_CATEGORIES.join(' | ')}`, severity: 'error' });
  }
}

/**
 * Validate tool entry for registration.
 * Pattern: accumulate errors → reject if any error exists.
 */
export function validateToolEntry(params: ValidatableParams, registry: RegistryLike): ValidationResult {
  const errors: ValidationError[] = [];

  _validateName(params.name, errors);
  _validateDescription(params.description, errors);
  _validateCategory(params.category, errors);

  // Rule 4: duplicate name check
  if (params.name && registry && registry.get(params.name)) {
    errors.push({ field: 'name', message: `'${params.name}' already exists. Use action: "update" instead`, severity: 'error' });
  }

  // Warning: no tags (search accuracy may be lower)
  if (!params.tags || params.tags.length === 0) {
    errors.push({ field: 'tags', message: 'no tags specified — search accuracy may be reduced', severity: 'warning' });
  }

  const errorCount = errors.filter(e => e.severity === 'error').length;
  return { valid: errorCount === 0, errors };
}

/**
 * Validate tool update params.
 * Same rules as create, but no duplicate check (updating existing tool).
 */
export function validateUpdateEntry(params: ValidatableParams, existing: ValidatableParams): ValidationResult {
  const errors: ValidationError[] = [];

  // Rule 1: name format (if changed)
  if (params.name && !NAME_PATTERN.test(params.name)) {
    errors.push({
      field: 'name',
      message: `'${params.name}' must follow verb_target format (e.g. read_pdf, take_screenshot)`,
      severity: 'error',
    });
  }

  // Rule 2: description min length (if changed)
  if (params.description && params.description.trim().length < MIN_DESCRIPTION_LENGTH) {
    errors.push({
      field: 'description',
      message: `minimum ${MIN_DESCRIPTION_LENGTH} characters required (current: ${params.description.trim().length})`,
      severity: 'error',
    });
  }

  // Rule 2b: warn if description is shorter than existing
  if (params.description && existing.description
      && params.description.trim().length < existing.description.trim().length * 0.5) {
    errors.push({
      field: 'description',
      message: `description is >50% shorter than existing (${existing.description.trim().length} → ${params.description.trim().length} chars)`,
      severity: 'warning',
    });
  }

  // Rule 3: category enum (if changed)
  if (params.category && !(VALID_CATEGORIES as readonly string[]).includes(params.category)) {
    errors.push({
      field: 'category',
      message: `'${params.category}' is not valid — use one of: ${VALID_CATEGORIES.join(' | ')}`,
      severity: 'error',
    });
  }

  const errorCount = errors.filter(e => e.severity === 'error').length;
  return { valid: errorCount === 0, errors };
}

/**
 * Format validation errors as user-readable string.
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  const errorCount = errors.filter(e => e.severity === 'error').length;
  const warnCount = errors.filter(e => e.severity === 'warning').length;

  const lines = errors.map(e => {
    const icon = e.severity === 'error' ? '❌' : '⚠️';
    return `  ${icon} [${e.field}] ${e.message}`;
  });

  const header = errorCount > 0
    ? `Registration rejected (${errorCount} error${errorCount > 1 ? 's' : ''}${warnCount > 0 ? `, ${warnCount} warning` : ''}):`
    : `Registration complete (${warnCount} warning${warnCount > 1 ? 's' : ''}):`;

  return `${header}\n${lines.join('\n')}`;
}
