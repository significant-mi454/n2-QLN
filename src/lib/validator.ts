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
    errors.push({ field: 'name', message: 'name은 필수입니다', severity: 'error' });
  } else if (!NAME_PATTERN.test(name)) {
    errors.push({ field: 'name', message: `'${name}' → 동사_대상 형식 필수 (예: read_pdf, take_screenshot)`, severity: 'error' });
  }
}

/** Validate description: required + min length */
function _validateDescription(desc: string | undefined, errors: ValidationError[]): void {
  if (!desc || desc.trim() === '') {
    errors.push({ field: 'description', message: 'description은 필수입니다 (도구 용도 설명)', severity: 'error' });
  } else if (desc.trim().length < MIN_DESCRIPTION_LENGTH) {
    errors.push({ field: 'description', message: `최소 ${MIN_DESCRIPTION_LENGTH}자 이상 설명 필요 (현재: ${desc.trim().length}자)`, severity: 'error' });
  }
}

/** Validate category: must be in enum */
function _validateCategory(category: string | undefined, errors: ValidationError[]): void {
  if (category && !(VALID_CATEGORIES as readonly string[]).includes(category)) {
    errors.push({ field: 'category', message: `'${category}' → ${VALID_CATEGORIES.join('|')} 중 하나`, severity: 'error' });
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
    errors.push({ field: 'name', message: `'${params.name}' 이미 존재합니다. action: "update" 를 사용하세요`, severity: 'error' });
  }

  // Warning: no tags (search accuracy may be lower)
  if (!params.tags || params.tags.length === 0) {
    errors.push({ field: 'tags', message: 'tags 미지정 — 검색 정확도가 낮아질 수 있습니다', severity: 'warning' });
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
      message: `'${params.name}' → 동사_대상 형식 필수 (예: read_pdf, take_screenshot)`,
      severity: 'error',
    });
  }

  // Rule 2: description min length (if changed)
  if (params.description && params.description.trim().length < MIN_DESCRIPTION_LENGTH) {
    errors.push({
      field: 'description',
      message: `최소 ${MIN_DESCRIPTION_LENGTH}자 이상 설명 필요 (현재: ${params.description.trim().length}자)`,
      severity: 'error',
    });
  }

  // Rule 2b: warn if description is shorter than existing
  if (params.description && existing.description
      && params.description.trim().length < existing.description.trim().length * 0.5) {
    errors.push({
      field: 'description',
      message: `설명이 기존보다 50% 이상 짧아집니다 (${existing.description.trim().length}자 → ${params.description.trim().length}자)`,
      severity: 'warning',
    });
  }

  // Rule 3: category enum (if changed)
  if (params.category && !(VALID_CATEGORIES as readonly string[]).includes(params.category)) {
    errors.push({
      field: 'category',
      message: `'${params.category}' → ${VALID_CATEGORIES.join('|')} 중 하나`,
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
    ? `등록 거부 (${errorCount} error${errorCount > 1 ? 's' : ''}${warnCount > 0 ? `, ${warnCount} warning` : ''}):`
    : `등록 완료 (${warnCount} warning${warnCount > 1 ? 's' : ''}):`;

  return `${header}\n${lines.join('\n')}`;
}
