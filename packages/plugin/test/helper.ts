import PhaserNS from 'phaser';

/**
 * Il namespace Phaser, importato una volta sola.
 *
 * Misurato su 4.2.1: il default export del bundle ESM E' gia' il namespace
 * (`Phaser.Game` e' una funzione, `Phaser.default` e' undefined), quindi non
 * serve alcuna normalizzazione `?? .default`.
 */
export const Phaser = PhaserNS;

let currentGame: Phaser.Game | null = null;

/**
 * Avvia un Game headless e risolve con la Scene attiva, una volta che
 * `create()` e' stato chiamato.
 *
 * Idioma copiato da `phaser/tests/helper.js`: HEADLESS, niente banner,
 * niente audio. `config` viene fuso sopra, quindi un test puo' aggiungere
 * `plugins`, `render`, o sostituire `scene`.
 *
 * Il timeout esiste perche' il modo tipico di sbagliare qui non e'
 * un'eccezione: e' un boot che non finisce mai (vedi il mock di Image nel
 * setup vendorizzato). Una Promise appesa farebbe scadere il test con un
 * messaggio che non dice niente; questo dice cosa e' successo.
 */
export function bootGame(config: Record<string, unknown> = {}): Promise<Phaser.Scene> {
    destroyGame();

    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error('the game never reached create(): the boot sequence stalled')),
            8000
        );

        currentGame = new Phaser.Game({
            type: Phaser.HEADLESS,
            width: 800,
            height: 600,
            banner: false,
            audio: { noAudio: true },
            scene: {
                key: 'probe',
                create(this: Phaser.Scene) { clearTimeout(timer); resolve(this); }
            },
            ...config
        } as Phaser.Types.Core.GameConfig);
    });
}

/** Distrugge il Game corrente. Idempotente: chiamarlo senza un gioco attivo
 *  non fa niente, cosi' un `afterEach` incondizionato e' sicuro. */
export function destroyGame(): void {
    if (!currentGame) return;
    try { currentGame.destroy(true); } catch { /* un boot fallito puo' lasciare uno stato parziale */ }
    currentGame = null;
}

/**
 * Dimentica uno scene plugin registrato, cosi' il prossimo Game riparte pulito.
 *
 * SERVE DAVVERO, non e' igiene di lusso. `PluginCache` e' un singleton di
 * MODULO, e `game.destroy()` lo svuota solo se `game.noReturn` e' vero
 * (PluginManager.destroy → destroyCorePlugins). Quindi, dopo il primo Game,
 * `installScenePlugin` trova `PluginCache.hasCore(key) === true` e SALTA la
 * ri-registrazione: il secondo Game eredita in silenzio il `mapping` del
 * primo. Un test che installa lo stesso plugin con un mapping diverso
 * fallirebbe per una ragione che non ha niente a che vedere con cio' che sta
 * verificando.
 */
export function forgetScenePlugin(key: string): void {
    Phaser.Plugins.PluginCache.remove(key);
}
