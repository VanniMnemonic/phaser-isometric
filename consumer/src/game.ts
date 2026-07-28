import Phaser from 'phaser';
import { isoScenePlugin, createHeightGrid } from 'phaser-isometric';

class Livello extends Phaser.Scene {
    create(): void {
        // Se `declare global` non fonde, questa riga e' un TS2339 — che e'
        // esattamente cio' che il progetto consumatore esiste per prendere.
        this.iso.configure({ type: 'diamond', tileWidth: 96, tileHeight: 48 });
        this.iso.setHeights(createHeightGrid(32, 32, 0));
        this.iso.cameraBounds(32, 32);

        // E questa riga prova l'augmentation della factory.
        const eroe = this.add.isoSprite(4, 4, '__DEFAULT');
        this.iso.makeDiamondHitArea(eroe);
        this.iso.follow(eroe);

        this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
            const cella = this.iso.pick(p.worldX, p.worldY);
            if (cella) eroe.setCell(cella.gx, cella.gy, cella.z);
        });
    }
}

export const gioco = new Phaser.Game({
    type: Phaser.AUTO,
    plugins: { scene: [isoScenePlugin()] },
    scene: [Livello]
});
