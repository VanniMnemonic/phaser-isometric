// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { bootGame, destroyGame, forgetScenePlugin, Phaser } from './helper';
import { ISO_PLUGIN_KEY, isoScenePlugin } from '../src/plugin';
import { viewOf } from '../src/camera';
import { IsoConfigError } from '@iso-internal/core';

const DIAMOND = { type: 'diamond', tileWidth: 96, tileHeight: 48 } as const;

afterEach(() => { destroyGame(); forgetScenePlugin(ISO_PLUGIN_KEY); });

function conIso(extra: Record<string, unknown> = {}): Promise<Phaser.Scene> {
    return bootGame({
        plugins: { scene: [isoScenePlugin({ projection: DIAMOND })] },
        ...extra
    });
}

describe('viewOf — pura, nessun Phaser richiesto', () => {
    it('ricostruisce la vista da scalari vivi', () => {
        const finta = { width: 800, height: 600, zoomX: 1, zoomY: 1, scrollX: 0, scrollY: 0 };
        expect(viewOf(finta)).toEqual({ x: 0, y: 0, width: 800, height: 600 });
    });

    it('lo zoom RESTRINGE la vista e la tiene centrata', () => {
        const finta = { width: 800, height: 600, zoomX: 2, zoomY: 2, scrollX: 0, scrollY: 0 };
        // A zoom 2 si vede meta' mondo, centrato sullo stesso punto.
        expect(viewOf(finta)).toEqual({ x: 200, y: 150, width: 400, height: 300 });
    });

    it('lo scroll trasla la vista senza cambiarne la misura', () => {
        const finta = { width: 800, height: 600, zoomX: 1, zoomY: 1, scrollX: 100, scrollY: -50 };
        expect(viewOf(finta)).toEqual({ x: 100, y: -50, width: 800, height: 600 });
    });
});

describe('follow()', () => {
    it('NON spegne roundPixels quando la config lo voleva acceso', async () => {
        const scene = await conIso({ render: { roundPixels: true } });
        expect(scene.cameras.main.roundPixels).toBe(true);

        scene.iso.follow({ gx: 0, gy: 0 });

        // startFollow(target) da solo lo azzera: e' il difetto che questo test
        // esiste per prendere, e sembra un problema di filtraggio delle texture.
        expect(scene.cameras.main.roundPixels).toBe(true);
    });

    it('non lo ACCENDE se la config non lo voleva', async () => {
        const scene = await conIso({ render: { roundPixels: false } });
        scene.iso.follow({ gx: 0, gy: 0 });
        expect(scene.cameras.main.roundPixels).toBe(false);
    });

    it('rifiuta gx/gy/z/lerp non finiti, prima di mutare qualunque cosa', async () => {
        const scene = await conIso();

        // `projectInto` non valida nulla: senza un controllo qui, uno di
        // questi scriverebbe NaN nel proxy e la camera si fermerebbe per
        // sempre, senza errori e senza log.
        expect(() => scene.iso.follow({ gx: Number.NaN, gy: 0 })).toThrow(/gx/);
        expect(() => scene.iso.follow({ gx: 0, gy: Number.POSITIVE_INFINITY })).toThrow(/gy/);
        expect(() => scene.iso.follow({ gx: 0, gy: 0, z: Number.NaN })).toThrow(/z/);
        expect(() => scene.iso.follow({ gx: 0, gy: 0 }, { lerp: Number.NaN })).toThrow(/lerp/);

        // Nessuna delle quattro chiamate rifiutate deve aver raggiunto
        // camera.startFollow(): validare PRIMA di mutare vale anche per gli
        // effetti su Phaser, non solo sui campi del plugin.
        expect((scene.cameras.main as unknown as { _follow: unknown })._follow).toBeNull();
    });

    it('segue un bersaglio in coordinate di GRIGLIA, proiettandolo', async () => {
        const scene = await conIso();
        const bersaglio = { gx: 2, gy: 0 };

        scene.iso.follow(bersaglio);
        scene.sys.events.emit(Phaser.Scenes.Events.PRE_UPDATE, 0, 16);

        const atteso = scene.iso.projection.project(2, 0);
        const proxy = (scene.cameras.main as unknown as { _follow: { x: number; y: number } })._follow;
        expect(proxy.x).toBe(atteso.x);
        expect(proxy.y).toBe(atteso.y);
    });

    it('segue un IsoSprite alla sua quota (elevation), non a zero', async () => {
        const scene = await conIso();
        // `IsoSprite` non scrive mai `z`: setCell() scrive `elevation`. Se
        // follow() leggesse ancora `target.z ?? 0`, questo test seguirebbe lo
        // `z` di Transform (sempre 0, mai toccato da questo pacchetto) e
        // passerebbe con la camera ferma a quota zero — proprio il difetto che
        // la review ha scoperto. Nessun PRE_UPDATE qui apposta: questo isola
        // la proiezione iniziale che follow() fa da se', dal ricalcolo per
        // frame di aggiornaProxy(), che e' il test successivo.
        const eroe = scene.add.isoSprite(3, 3, '__DEFAULT');
        eroe.setCell(3, 3, 2, scene.iso.bands.hero);

        scene.iso.follow(eroe);

        const atteso = scene.iso.projection.project(3, 3, 2);
        const proxy = (scene.cameras.main as unknown as { _follow: { x: number; y: number } })._follow;
        expect(proxy.x).toBe(atteso.x);
        expect(proxy.y).toBe(atteso.y);
    });

    it('un setCell che cambia quota sposta il proxy al frame successivo', async () => {
        const scene = await conIso();
        const eroe = scene.add.isoSprite(1, 1, '__DEFAULT');
        eroe.setCell(1, 1, 0, scene.iso.bands.hero);
        scene.iso.follow(eroe);

        // Cambia SOLO la quota: e' esattamente cio' che aggiornaProxy() deve
        // rileggere a ogni PRE_UPDATE, e che il primo test da solo (che
        // proietta una volta sola, dopo un unico setCell) non esercita.
        eroe.setCell(1, 1, 4, scene.iso.bands.hero);
        scene.sys.events.emit(Phaser.Scenes.Events.PRE_UPDATE, 0, 16);

        const atteso = scene.iso.projection.project(1, 1, 4);
        const proxy = (scene.cameras.main as unknown as { _follow: { x: number; y: number } })._follow;
        expect(proxy.x).toBe(atteso.x);
        expect(proxy.y).toBe(atteso.y);
    });

    it('un oggetto semplice { gx, gy, z } senza elevation si comporta esattamente come prima', async () => {
        const scene = await conIso();
        const bersaglio = { gx: 4, gy: 1, z: 3 };

        scene.iso.follow(bersaglio);
        scene.sys.events.emit(Phaser.Scenes.Events.PRE_UPDATE, 0, 16);

        const atteso = scene.iso.projection.project(4, 1, 3);
        const proxy = (scene.cameras.main as unknown as { _follow: { x: number; y: number } })._follow;
        expect(proxy.x).toBe(atteso.x);
        expect(proxy.y).toBe(atteso.y);
    });

    it('muta il proxy SUL POSTO: l identita non cambia mai', async () => {
        const scene = await conIso();
        const bersaglio = { gx: 0, gy: 0 };
        scene.iso.follow(bersaglio);

        const cam = scene.cameras.main as unknown as { _follow: object };
        const primaIdentita = cam._follow;

        bersaglio.gx = 5;
        scene.sys.events.emit(Phaser.Scenes.Events.PRE_UPDATE, 0, 16);

        // Riassegnare un oggetto nuovo romperebbe il riferimento _follow e la
        // camera resterebbe ferma per sempre, senza errori.
        expect(cam._follow).toBe(primaIdentita);
        expect((cam._follow as { x: number }).x).toBe(scene.iso.projection.project(5, 0).x);
    });

    it('stopFollow smette di aggiornare', async () => {
        const scene = await conIso();
        const bersaglio = { gx: 0, gy: 0 };
        scene.iso.follow(bersaglio);

        // Catturato PRIMA di stopFollow(): e' lo stesso oggetto che il plugin
        // tiene come proxy interno, quindi resta l'unico modo di controllare
        // se aggiornaProxy() continua a scrivergli sopra dopo lo stop.
        const cam = scene.cameras.main as unknown as { _follow: { x: number } | null };
        const proxy = cam._follow;

        scene.iso.stopFollow();

        bersaglio.gx = 9;
        scene.sys.events.emit(Phaser.Scenes.Events.PRE_UPDATE, 0, 16);

        expect(cam._follow).toBeNull();

        // Non basta che la camera non insegua piu': il plugin non deve
        // nemmeno trattenere il riferimento al bersaglio. Se lo facesse,
        // continuerebbe a riproiettarlo a ogni frame su un oggetto che
        // nessuno guarda piu' — un leak silenzioso, non solo uno spreco.
        expect(proxy?.x).toBe(scene.iso.projection.project(0, 0).x);
        expect(proxy?.x).not.toBe(scene.iso.projection.project(9, 0).x);
    });

    it('inoltra lerp e offset a startFollow nell ordine giusto', async () => {
        const scene = await conIso();
        const camera = scene.cameras.main;

        // Phaser: startFollow(target, roundPixels, lerpX, lerpY, offsetX, offsetY).
        // Nessun altro test passa `opts`, quindi senza queste asserzioni lerp e
        // offset potrebbero essere trasposti o persi del tutto e tutto
        // resterebbe verde. Valori asimmetrici apposta: offsetX = offsetY
        // renderebbe indistinguibile una trasposizione.
        scene.iso.follow({ gx: 0, gy: 0 }, { lerp: 0.5, offsetX: 10, offsetY: -20 });

        expect(camera.lerp.x).toBe(0.5);
        expect(camera.lerp.y).toBe(0.5);
        expect(camera.followOffset.x).toBe(10);
        expect(camera.followOffset.y).toBe(-20);
    });

    it('senza opts usa i default: lerp 1, nessun offset', async () => {
        const scene = await conIso();
        const camera = scene.cameras.main;

        scene.iso.follow({ gx: 0, gy: 0 });

        expect(camera.lerp.x).toBe(1);
        expect(camera.lerp.y).toBe(1);
        expect(camera.followOffset.x).toBe(0);
        expect(camera.followOffset.y).toBe(0);
    });

    it('smette di aggiornare dopo lo shutdown della Scene', async () => {
        const scene = await conIso();
        scene.iso.follow({ gx: 0, gy: 0 });

        scene.sys.events.emit(Phaser.Scenes.Events.SHUTDOWN, scene.sys);

        // Se il listener PRE_UPDATE sopravvive allo shutdown, continua a girare
        // su una camera che la Scene sta smontando.
        expect(scene.sys.events.listenerCount(Phaser.Scenes.Events.PRE_UPDATE)).toBe(0);
    });
});

describe('cameraBounds()', () => {
    it('usa la formula isometrica, non quella ortogonale', async () => {
        const scene = await conIso();

        scene.iso.cameraBounds(10, 10);

        const b = scene.cameras.main.getBounds();
        // Valori misurati (non assunti) proiettando i quattro angoli della
        // griglia 10x10 sul preset diamond 96x48: il vertice piu' a sinistra
        // e' la cella (0,9), quello piu' in alto e' la cella (0,0). La
        // formula ortogonale darebbe {x:0, y:0, width:960, height:480}: stessa
        // larghezza, origine sbagliata. E' esattamente il difetto di
        // map.widthInPixels — un'asserzione solo su `width` o solo su `x < 0`
        // lascerebbe passare quella formula sbagliata con la larghezza giusta
        // per caso.
        expect(b.x).toBe(-480);
        expect(b.y).toBe(-24);
        expect(b.width).toBe(960);
        expect(b.height).toBe(480);
    });

    it('maxElevation alza il tetto dei bounds, e solo quello', async () => {
        const scene = await conIso();

        // Finora questa opzione era esercitata solo dal gate browser. Due quote
        // sul preset diamond 96x48 (elevationStep = th/2 = 24) sono 48 px di
        // cielo in piu': il rettangolo cresce verso l'ALTO, quindi y scende e
        // height sale della stessa quantita'. x e width non si muovono — se
        // maxElevation finisse sull'asse sbagliato, sarebbero loro a cambiare.
        scene.iso.cameraBounds(10, 10, { maxElevation: 2 });

        const b = scene.cameras.main.getBounds();
        expect(b.x).toBe(-480);
        expect(b.y).toBe(-72);
        expect(b.width).toBe(960);
        expect(b.height).toBe(528);
    });

    it('una griglia degenere lancia invece di inchiodare la camera sull origine', async () => {
        const scene = await conIso();
        scene.iso.cameraBounds(10, 10);
        const prima = scene.cameras.main.getBounds();

        // Il percorso reale: cameraBounds(map.width, map.height) chiamata prima
        // che la tilemap abbia finito di caricare. worldBounds restituisce
        // {0,0,0,0} per convenzione e setBounds lo applicherebbe subito: la
        // camera non si muoverebbe piu', senza niente da cercare.
        expect(() => scene.iso.cameraBounds(0, 0)).toThrow(IsoConfigError);
        expect(() => scene.iso.cameraBounds(0, 10)).toThrow(/pin the camera at the origin/);
        expect(() => scene.iso.cameraBounds(10, -3)).toThrow(/pin the camera at the origin/);

        // E non ha scritto niente: i bounds precedenti sono intatti.
        const dopo = scene.cameras.main.getBounds();
        expect({ x: dopo.x, y: dopo.y, width: dopo.width, height: dopo.height })
            .toEqual({ x: prima.x, y: prima.y, width: prima.width, height: prima.height });
    });

    it('una dimensione NaN resta un errore di finitezza, non di griglia degenere', async () => {
        const scene = await conIso();

        // `NaN <= 0` e' falso: NaN non entra nel ramo della griglia degenere e
        // cade su worldBounds, che e' il posto giusto per rifiutarlo. Il
        // messaggio deve restare quello sulla finitezza, altrimenti il lettore
        // va a cercare le dimensioni della mappa invece del NaN che le produce.
        expect(() => scene.iso.cameraBounds(Number.NaN, 10)).toThrow(/finite/);
        expect(() => scene.iso.cameraBounds(Number.NaN, 10)).not.toThrow(/pin the camera/);
    });
});

describe('view()', () => {
    it('ricostruisce dagli scalari vivi della camera, non da worldView', async () => {
        const scene = await conIso();
        const camera = scene.cameras.main;

        camera.setZoom(2);
        camera.setScroll(100, 50);

        const v = scene.iso.view();

        // width=800, height=600 (default di bootGame), zoom 2 => si vede
        // meta' mondo: displayWidth=400, displayHeight=300.
        // x = scrollX + width/2 - displayWidth/2 = 100 + 400 - 200 = 300
        // y = scrollY + height/2 - displayHeight/2 = 50 + 300 - 150 = 200
        expect(v).toEqual({ x: 300, y: 200, width: 400, height: 300 });

        // worldView e' scritto solo dentro Camera.preRender, che sotto
        // HEADLESS non gira mai (vedi MISURATO-runtime.md): resta
        // {x:0,y:0,width:0,height:0} per sempre in questo test, dove
        // preRender() non e' mai stato pompato a mano. Se view() leggesse
        // worldView invece di ricostruirlo dagli scalari vivi, tornerebbe
        // esattamente questo rettangolo fermo al frame zero.
        expect(v).not.toEqual({
            x: camera.worldView.x,
            y: camera.worldView.y,
            width: camera.worldView.width,
            height: camera.worldView.height
        });
    });
});
