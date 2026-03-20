// QLN — Tool registration validator (validator.rs pattern)
// Enforced validation: errors reject registration, warnings pass with message.

/** Valid tool categories */
const VALID_CATEGORIES = ['web', 'data', 'file', 'dev', 'ai', 'capture', 'misc'];

/** Tool name pattern: verb_target (e.g. read_pdf, take_screenshot) */
const NAME_PATTERN = /^[a-z]+_[a-z][a-z0-9_]*$/;

/** Minimum description length */
const MIN_DESCRIPTION_LENGTH = 10;

/**
 * Validate tool entry for registration.
 * Pattern: accumulate errors → reject if any error exists.
 *
 * @param {object} params - Tool creation params
 * @param {import('./registry').Registry} registry - For duplicate check
 * @returns {{ valid: boolean, errors: ValidationError[] }}
 */
function validateToolEntry(params, registry) {
    /** @type {ValidationError[]} */
    const errors = [];

    // Rule 1: name required + verb_target format enforced
    if (!params.name || params.name.trim() === '') {
        errors.push({
            field: 'name',
            message: 'name은 필수입니다',
            severity: 'error',
        });
    } else if (!NAME_PATTERN.test(params.name)) {
        errors.push({
            field: 'name',
            message: `'${params.name}' → 동사_대상 형식 필수 (예: read_pdf, take_screenshot)`,
            severity: 'error',
        });
    }

    // Rule 2: description required (= first-line comment) + min 10 chars
    if (!params.description || params.description.trim() === '') {
        errors.push({
            field: 'description',
            message: 'description은 필수입니다 (도구 용도 설명)',
            severity: 'error',
        });
    } else if (params.description.trim().length < MIN_DESCRIPTION_LENGTH) {
        errors.push({
            field: 'description',
            message: `최소 ${MIN_DESCRIPTION_LENGTH}자 이상 설명 필요 (현재: ${params.description.trim().length}자)`,
            severity: 'error',
        });
    }

    // Rule 3: category enum enforced
    if (params.category && !VALID_CATEGORIES.includes(params.category)) {
        errors.push({
            field: 'category',
            message: `'${params.category}' → ${VALID_CATEGORIES.join('|')} 중 하나`,
            severity: 'error',
        });
    }

    // Rule 4: duplicate name check
    if (params.name && registry && registry.get(params.name)) {
        errors.push({
            field: 'name',
            message: `'${params.name}' 이미 존재합니다. action: "update" 를 사용하세요`,
            severity: 'error',
        });
    }

    // Warning: no tags (search accuracy may be lower)
    if (!params.tags || params.tags.length === 0) {
        errors.push({
            field: 'tags',
            message: 'tags 미지정 — 검색 정확도가 낮아질 수 있습니다',
            severity: 'warning',
        });
    }

    const errorCount = errors.filter(e => e.severity === 'error').length;
    return { valid: errorCount === 0, errors };
}

/**
 * Validate tool update params.
 * Same rules as create, but no duplicate check (updating existing tool).
 *
 * @param {object} params - Update params (only changed fields)
 * @param {object} existing - Current tool entry from registry
 * @returns {{ valid: boolean, errors: ValidationError[] }}
 */
function validateUpdateEntry(params, existing) {
    /** @type {ValidationError[]} */
    const errors = [];

    // Merge: use existing values as fallback
    const merged = {
        name: params.name || existing.name,
        description: params.description || existing.description,
        category: params.category || existing.category,
    };

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

    // Rule 3: category enum (if changed)
    if (params.category && !VALID_CATEGORIES.includes(params.category)) {
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
 * @param {ValidationError[]} errors
 * @returns {string}
 */
function formatValidationErrors(errors) {
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

/**
 * @typedef {object} ValidationError
 * @property {string} field - Field name
 * @property {string} message - Error message
 * @property {'error'|'warning'} severity - Severity level
 */

module.exports = {
    validateToolEntry,
    validateUpdateEntry,
    formatValidationErrors,
    VALID_CATEGORIES,
    NAME_PATTERN,
    MIN_DESCRIPTION_LENGTH,
};
