import type { Rect } from '@iso-internal/core';

/**
 * The scalars `viewOf` needs. Structural on purpose: it is exactly the subset
 * of a Phaser camera the computation touches, so the function stays pure and
 * can be exercised in Node with a plain object.
 */
export interface CameraScalars {
    width: number;
    height: number;
    zoomX: number;
    zoomY: number;
    scrollX: number;
    scrollY: number;
}

/**
 * The camera's visible rectangle in world space, computed NOW.
 *
 * Deliberately not `camera.worldView`. That rectangle is written only inside
 * `Camera.preRender`, which runs in the render phase — so every hook a plugin
 * can reach (PRE_UPDATE, UPDATE, the Scene's update, POST_UPDATE, PRE_RENDER)
 * reads the PREVIOUS frame's value, and on the first frame reads {0,0,0,0}.
 * These are the same four lines Phaser runs, evaluated at the moment we need
 * them.
 */
export function viewOf(camera: CameraScalars): Rect {
    const width = camera.width / camera.zoomX;
    const height = camera.height / camera.zoomY;

    return {
        x: camera.scrollX + camera.width / 2 - width / 2,
        y: camera.scrollY + camera.height / 2 - height / 2,
        width,
        height
    };
}
