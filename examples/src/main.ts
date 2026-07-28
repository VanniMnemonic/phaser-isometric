import Phaser from 'phaser';
import { isoScenePlugin } from 'phaser-isometric';
import { PlaygroundScene, CANVAS_WIDTH, CANVAS_HEIGHT } from './scene';

new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    backgroundColor: '#11141a',
    // Without this, the WebGL renderer's default `preserveDrawingBuffer:
    // false` clears the drawing buffer once it has been composited, so an
    // in-page `canvas.getContext('2d').drawImage(gameCanvas, ...)` +
    // `getImageData` — the natural way for a `page.evaluate` draw-order
    // check to read a pixel — reads back all zeros even though the frame on
    // screen is correct. Measured on 4.2.1 with Phaser.AUTO (WebGL):
    // dropping this flag turns every in-page pixel readback black.
    render: { preserveDrawingBuffer: true },
    plugins: { scene: [isoScenePlugin()] },
    scene: [PlaygroundScene]
});
