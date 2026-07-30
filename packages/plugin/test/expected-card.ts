/**
 * La scheda che `diagnose --tile 96x48 --grid 24x24` deve produrre, verbatim.
 *
 * E' un letterale scritto a mano e verificato eseguendo, non un valore
 * rigenerato dal renderer: se l'atteso venisse dalla stessa funzione sotto
 * esame, qualunque difetto tornerebbe indietro come verde.
 *
 * Vive qui, e non dentro uno dei due test, perche' lo usano entrambi — il
 * renderer puro e la CLI costruita — e due copie della stessa scheda
 * divergerebbero al primo cambio di formato.
 */
export const SCHEDA_96x48_24x24 = `## META
tool=phaser-isometric
version=0.2.0
schema=1
command=diagnose
warnings=0

## PROJECTION
type=diamond
tileWidth=96
tileHeight=48
a=48.0000
b=24.0000
c=-48.0000
d=24.0000
det=2304.0000
conditioning=1.000000
elevationStep=24.0000
originXY=0,0

## DEPTH
rowStride=4096
bandStride=256
subCapacity=256
maxBands=16
rowOffset=0
maxWithinRow=4095
withinRowHeadroom=0
declaredMaxRow=4096
worstKey=16781311
maxSafeRow=2199023255551
safeRowHeadroom=2199023251455

## GRID
width=24
height=24
cells=576
maxRow=46
maxElevation=0
worstKeyInGrid=192511
boundsXYWH=-1152.0000,-24.0000,2304.0000,1152.0000
elevationLiftPx=0.0000

## ROUNDTRIP
probes=5
maxGridError=0.000000000000
maxScreenError=0.000000000000
worstCellXYZ=na
exact=yes
`;
