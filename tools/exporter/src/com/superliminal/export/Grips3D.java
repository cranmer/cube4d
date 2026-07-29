package com.superliminal.export;

import com.donhatchsw.util.CSG;
import com.donhatchsw.util.VecMath;
import com.superliminal.magiccube4d.PolytopePuzzleDescription;
import java.lang.reflect.Field;

/**
 * Twist axes for three-dimensional puzzles, which the original does not generate.
 *
 * `PolytopePuzzleDescription` wraps its grip construction in `if(nDims == 4)`, above a comment where
 * the author starts to handle 3D, notices the cell/facet analogy does not transfer, and says so.
 * Everything else about a 3D puzzle already works: `{4,3} 3` builds with 26 cubies and 54 stickers
 * from the unmodified engine, and the slicing, sticker derivation and state model are all
 * dimension-generic. Only the axes are missing.
 *
 * The analogue turns out to fit the existing machinery exactly. In 4D a twist rotates a *cell* about
 * one of its sub-elements; in 3D it rotates the *whole polytope* about one of its sub-elements — and
 * `CSG.calcRotationGroupOrder` requires its `cell3d` argument to have dimension 3, which the whole
 * polytope does. Called that way it returns order 4 for each face of a cube and order 5 for each
 * face of a dodecahedron: exactly R, L, U, D, F, B and their megaminx equivalents.
 *
 * **Face grips only, deliberately.** The same call also gives order-3 vertex axes and order-2 edge
 * axes, which are real rotations of the solid — but a grip carries the face its slices are measured
 * from (`grip2face`), and a vertex or edge belongs to no single face, so the slicemask machinery has
 * nothing to measure against. Corner- and edge-turning puzzles are a different puzzle rather than a
 * missing feature here, and a cube whose axes are its faces is the cube everyone means.
 *
 * Nothing in the legacy source is modified: this reads the description through the same reflection
 * the exporter already uses for the 4D fields.
 */
final class Grips3D {
    final int nGrips;
    final int[] gripSymmetryOrders;
    final double[][][] gripUsefulMats;
    final float[][] gripCenters;
    final int[] gripDims;
    final int[] grip2face;

    /**
     * How far a grip's centre is nudged from its face's centre towards the middle of the puzzle.
     *
     * Copied from the 4D path, where it exists to keep two grips on the same cubie from landing on
     * the same point. With one grip per face there is nothing to separate, but matching the
     * convention costs nothing and keeps the picking code comparing like with like.
     */
    private static final double NUDGE = 0.01;

    Grips3D(PolytopePuzzleDescription p) throws Exception {
        int nDims = p.nDims();
        if(nDims != 3)
            throw new IllegalArgumentException("Grips3D is for 3D puzzles, got nDims=" + nDims);

        CSG.SPolytope original = (CSG.SPolytope) read(p, "originalPolytope");
        CSG.Polytope whole = original.p;
        // Face indices in the asset are positions in this array — the description derives its own
        // the same way (`originalElements[nDims-1]`), which is a local there rather than a field.
        CSG.Polytope[] faces = whole.getAllElements()[nDims - 1];

        // The whole solid is what a 3D twist turns, so it plays the part the cell plays in 4D.
        if(whole.dim != 3)
            throw new IllegalStateException("expected a 3-dimensional polytope, got dim=" + whole.dim);

        double[] puzzleCenter = new double[nDims];
        CSG.cgOfVerts(puzzleCenter, whole);

        nGrips = faces.length;
        gripSymmetryOrders = new int[nGrips];
        gripUsefulMats = new double[nGrips][nDims][nDims];
        gripCenters = new float[nGrips][];
        gripDims = new int[nGrips];
        grip2face = new int[nGrips];

        double[] center = new double[nDims];
        for(int f = 0; f < nGrips; ++f) {
            CSG.Polytope face = faces[f];
            gripSymmetryOrders[f] = CSG.calcRotationGroupOrder(whole, whole, face, gripUsefulMats[f]);
            CSG.cgOfVerts(center, face);
            VecMath.lerp(center, center, puzzleCenter, NUDGE);
            gripCenters[f] = VecMath.doubleToFloat(center);
            // A face of a 3-polytope is 2-dimensional, and the pick code derives the dimension it
            // wants from the piece's colour count, so this has to be the real thing.
            gripDims[f] = face.dim;
            grip2face[f] = f;
        }
    }

    private static Object read(PolytopePuzzleDescription p, String name) throws Exception {
        Field field = PolytopePuzzleDescription.class.getDeclaredField(name);
        field.setAccessible(true);
        return field.get(p);
    }
}
