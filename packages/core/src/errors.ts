/**
 * Errore di configurazione. Il campo `fix` NON e' opzionale: un messaggio che
 * descrive il sintomo senza nominare la correzione costringe chi lo legge a
 * indovinare, ed e' esattamente il momento in cui serve meno.
 */
export class IsoConfigError extends Error {
    override readonly name = 'IsoConfigError';

    constructor(
        readonly symptom: string,
        readonly fix: string
    ) {
        super(`${symptom}. Correzione: ${fix}`);
    }
}
