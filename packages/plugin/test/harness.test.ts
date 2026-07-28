// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { bootGame, destroyGame, Phaser } from './helper';

afterEach(() => { destroyGame(); });

describe('l\'anello jsdom', () => {
    it('avvia un Game headless fino a create()', async () => {
        const scene = await bootGame();
        expect(scene).toBeTruthy();
        expect(scene.sys.settings.key).toBe('probe');
    });

    it('crea un GameObject vero, non un mock', async () => {
        const scene = await bootGame();
        const sprite = scene.add.sprite(100, 200, '__DEFAULT');
        expect(sprite.type).toBe('Sprite');
        expect(sprite.x).toBe(100);
        expect(sprite.y).toBe(200);
        expect(scene.sys.displayList.exists(sprite)).toBe(true);
    });

    it('espone il namespace Phaser con la versione attesa', () => {
        expect(Phaser.VERSION.startsWith('4.')).toBe(true);
        expect(typeof Phaser.Plugins.ScenePlugin).toBe('function');
    });
});
