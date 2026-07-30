package com.superliminal.export;

import com.superliminal.magiccube4d.PolytopePuzzleDescription;
import java.lang.reflect.Field;

/**
 * Give every sticker of a 3D puzzle its own copy of the vertices it uses.
 *
 * The asset format stores each polygon's vertex indices *sticker-locally*, in one byte apiece, which
 * requires every sticker to own a private contiguous run of vertices. In 4D that is free: a sticker
 * is a solid, and the slicer gives it eight vertices nobody else touches — {4,3,3} 2 has exactly
 * 64 stickers and 512 vertices. In 3D a sticker is a *polygon on a shared surface mesh*: 24 quads
 * over 26 vertices for a pocket cube, with neighbours sharing corners. The exporter's contiguity
 * check catches that on the first sticker.
 *
 * Sharing is worse than awkward for the index encoding, because it makes one of the stored arrays
 * ill-defined. `vertsMinusStickerCenters` is kept **per vertex** — the offset from *its* sticker's
 * centre — and a corner shared by three stickers has three different centres it could be measured
 * from. The original resolves this by first-come: the first sticker to mention a vertex writes it,
 * and the rest inherit a value relative to a centre that is not theirs.
 *
 * Expanding fixes both at once. Each sticker gets private copies, so the runs are contiguous by
 * construction and each copy's offset is measured from the sticker that actually owns it. A pocket
 * cube goes from 26 vertices to 96, which is nothing at these sizes, and the format's invariant is
 * restored rather than weakened.
 *
 * **Absolute positions are recoverable exactly**, which is what makes this arithmetic rather than
 * guesswork. Alongside the two arrays the exporter already reads, the description keeps a third,
 * `vertFaceCenters`, holding the face centre of whichever sticker claimed each vertex. The three sum
 * to the vertex's true rest position for every vertex, shared or not — using the per-vertex face
 * centre rather than the per-face one, which is precisely the distinction that does not matter in 4D
 * and does here.
 *
 * **Only for 3D.** Applying this to 4D would renumber vertices, and vertex order is part of a wire
 * format that every saved solve depends on. The 4D path is left byte-identical.
 */
final class Expand3D {
    /** Total vertices after expansion: the sum of each sticker's distinct-vertex count. */
    final int nVerts;
    /** Where each sticker's private run starts. Contiguous and in sticker order, by construction. */
    final int[] vertBegin;
    final int[] vertCount;
    /** Per new vertex, its offset from its own sticker's centre. */
    final float[][] vertsMinusStickerCenters;
    /** Per sticker, its centre's offset from its face's centre. Computed, not read off a vertex. */
    final float[][] stickerCenterMinusFaceCenter;
    /** Polygon vertex counts and sticker-local indices, flattened, in sticker then polygon order. */
    final int[] polyVertCount;
    final int[] polyIndsLocal;
    final int[] stickerPolyCount;

    Expand3D(PolytopePuzzleDescription p) throws Exception {
        int nDims = p.nDims();
        int nStickers = p.nStickers();
        int[][][] stickerInds = p.getStickerInds();
        int[] sticker2face = p.getSticker2Face();

        float[][] vMinusSticker = (float[][]) read(p, "vertsMinusStickerCenters");
        float[][] stickerMinusFace = (float[][]) read(p, "vertStickerCentersMinusFaceCenters");
        float[][] vertFaceCenters = (float[][]) read(p, "vertFaceCenters");
        double[][] stickerCenters = (double[][]) read(p, "stickerCentersD");
        float[][] faceCenters = (float[][]) read(p, "faceCenters");

        vertBegin = new int[nStickers];
        vertCount = new int[nStickers];
        stickerPolyCount = new int[nStickers];
        stickerCenterMinusFaceCenter = new float[nStickers][];

        int totalVerts = 0;
        int totalPolys = 0;
        int totalInds = 0;
        for(int s = 0; s < nStickers; ++s) {
            java.util.LinkedHashSet<Integer> used = new java.util.LinkedHashSet<Integer>();
            for(int[] poly : stickerInds[s]) {
                totalInds += poly.length;
                for(int v : poly)
                    used.add(v);
            }
            vertBegin[s] = totalVerts;
            vertCount[s] = used.size();
            stickerPolyCount[s] = stickerInds[s].length;
            totalVerts += used.size();
            totalPolys += stickerInds[s].length;
        }
        nVerts = totalVerts;
        vertsMinusStickerCenters = new float[nVerts][];
        polyVertCount = new int[totalPolys];
        polyIndsLocal = new int[totalInds];

        int ip = 0, ii = 0;
        for(int s = 0; s < nStickers; ++s) {
            // First-use order within the sticker, so a polygon's indices stay in the order the
            // original wrote them and the winding is preserved.
            java.util.LinkedHashMap<Integer, Integer> local =
                new java.util.LinkedHashMap<Integer, Integer>();
            for(int[] poly : stickerInds[s])
                for(int v : poly)
                    if(!local.containsKey(v))
                        local.put(v, local.size());

            for(java.util.Map.Entry<Integer, Integer> e : local.entrySet()) {
                int v = e.getKey();
                float[] offset = new float[nDims];
                for(int k = 0; k < nDims; ++k) {
                    // The absolute rest position, then measured from *this* sticker's centre.
                    double absolute = (double) vMinusSticker[v][k]
                            + (double) stickerMinusFace[v][k]
                            + (double) vertFaceCenters[v][k];
                    offset[k] = (float) (absolute - stickerCenters[s][k]);
                }
                vertsMinusStickerCenters[vertBegin[s] + e.getValue()] = offset;
            }

            int iFace = sticker2face[s];
            float[] centre = new float[nDims];
            for(int k = 0; k < nDims; ++k)
                centre[k] = (float) (stickerCenters[s][k] - (double) faceCenters[iFace][k]);
            stickerCenterMinusFaceCenter[s] = centre;

            for(int[] poly : stickerInds[s]) {
                polyVertCount[ip++] = poly.length;
                for(int v : poly)
                    polyIndsLocal[ii++] = local.get(v);
            }
        }
    }

    private static Object read(PolytopePuzzleDescription p, String name) throws Exception {
        Field field = PolytopePuzzleDescription.class.getDeclaredField(name);
        field.setAccessible(true);
        return field.get(p);
    }
}
