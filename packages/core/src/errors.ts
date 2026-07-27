/**
 * Configuration error. The `fix` field is NOT optional: a message that
 * describes only the symptom, without naming the correction, forces whoever
 * reads it to guess — exactly when they can least afford to.
 */
export class IsoConfigError extends Error {
    override readonly name = 'IsoConfigError';

    constructor(
        readonly symptom: string,
        readonly fix: string
    ) {
        super(`${symptom}. Fix: ${fix}`);
    }
}

/**
 * Throws {@link IsoConfigError} when `value` is not a finite number (`NaN`
 * and `±Infinity` included).
 *
 * Shared by every module that validates a numeric constructor argument, so
 * the wording — and the definition of "finite" — never drifts between them.
 */
export function requireFinite(value: number, name: string): void {
    if (!Number.isFinite(value)) {
        throw new IsoConfigError(
            `${name} is not a finite number (got ${String(value)})`,
            `pass a finite number for ${name}, for example 10`
        );
    }
}

/**
 * Throws {@link IsoConfigError} when `value` is not finite or not strictly
 * greater than zero. Implies {@link requireFinite}.
 */
export function requirePositive(value: number, name: string): void {
    requireFinite(value, name);
    if (value <= 0) {
        throw new IsoConfigError(
            `${name} must be greater than zero (got ${value})`,
            `pass a positive ${name}, for example 96`
        );
    }
}

/**
 * Throws {@link IsoConfigError} when `value` is not a non-negative integer.
 */
export function requireNonNegativeInteger(value: number, name: string): void {
    if (!Number.isInteger(value) || value < 0) {
        throw new IsoConfigError(
            `${name} must be a non-negative integer (got ${String(value)})`,
            `pass an integer >= 0 for ${name}, for example 16`
        );
    }
}
