import Phaser from 'phaser';
import { isoScenePlugin } from 'phaser-isometric';
import { PlaygroundScene, CANVAS_WIDTH, CANVAS_HEIGHT } from './scene';

new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    backgroundColor: '#11141a',
    plugins: { scene: [isoScenePlugin()] },
    scene: [PlaygroundScene]
});
