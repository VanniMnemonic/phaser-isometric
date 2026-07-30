/**
 * A usage error: the API was called in an order that cannot work.
 *
 * Deliberately distinct from the core's `IsoConfigError`, which reports an
 * invalid VALUE. Here every value is fine and the SEQUENCE is not, so the
 * correction is a different one — and a message that blurs the two sends the
 * reader looking at the wrong thing.
 *
 * As in the core, `fix` is not optional: a message that names only the
 * symptom forces whoever reads it to guess, exactly when they can least
 * afford to.
 */
export class IsoUsageError extends Error {
    override readonly name = 'IsoUsageError';

    constructor(
        readonly symptom: string,
        readonly fix: string
    ) {
        super(`${symptom}. Fix: ${fix}`);
    }
}
