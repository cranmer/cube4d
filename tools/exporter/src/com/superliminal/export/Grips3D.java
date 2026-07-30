package com.superliminal.export;

import com.donhatchsw.util.CSG;
import com.donhatchsw.util.VecMath;
import com.superliminal.magiccube4d.PolytopePuzzleDescription;
import java.lang.reflect.Field;

/**
 * Twist axes for three-dimensional puzzles, which the original does not generate.
 *
 * `PolytopePuzzleDescription` wraps grip construction in `if(nDims == 4)`, above a comment where the
 * author starts on 3D, decides the analogy does not transfer, and stops. Everything else about a 3D
 * puzzle already works from the unmodified engine — slicing, cubies, stickers, the state model, all
 * dimension-generic. Only the axes were missing.
 *
 * **The analogy is one level down from where that comment looks for it.** In 4D a grip is a pair: a
 * *cell* and a sub-element of that cell. Eight cells times 27 elements each — 8 vertices, 12 edges,
 * 6 faces and the cell's own centre — gives the hypercube's 216. The comment looks for elements of
 * the whole polytope, notices a 3D solid has no cells, and concludes there is nothing there. But the
 * right correspondence is *facet* and sub-element-of-that-facet: in 4D the facets are cells, and in
 * 3D they are faces. Six faces times 9 elements each — 4 vertices, 4 edges and the face's own centre
 * — gives 54.
 *
 * Constructed that way the interface transfers exactly, which is the entire point of building a 3D
 * puzzle on this engine. The pick rule infers which axis you meant from how many colours the piece
 * carries, `gripDim = nDims − colours`, and in three dimensions that gives:
 *
 *   corner, 3 colours  →  dim 0, a vertex  →  order 3, a 120° turn
 *   edge,   2 colours  →  dim 1, an edge   →  order 2, a 180° turn
 *   centre, 1 colour   →  dim 2, the face  →  order 4, the ordinary 90° face turn
 *
 * with no special case anywhere. Measured on `{4,3} 3`: 24 vertex axes of order 3, 24 edge axes of
 * order 2, 6 face axes of order 4. A dodecahedron gives 12 faces of 11 elements, the face axes of
 * order 5.
 *
 * One difference is worth knowing rather than smoothing over. In 4D the last case, `nDims − 1 = 3`,
 * asks for a rotation about the *cell itself*, which does not exist — which is why the centre cubie
 * of a hypercube cell cannot be clicked and does nothing. In 3D the same arithmetic asks for a
 * rotation about the *face*, which does exist and is the familiar face turn. So the middle sticker
 * of a face is live here and dead there, and that falls out of the construction rather than needing
 * an exception.
 *
 * Each grip carries the face its slices are measured from, exactly as a 4D grip carries its cell, so
 * the slicemask machinery needs nothing new. A vertex shared by three faces yields three grips with
 * the same axis and different slice references — again mirroring 4D, where a vertex shared by four
 * cells yields four.
 *
 * Nothing in the legacy source is modified: this reads the description through the same reflection
 * the exporter already uses for the 4D grip fields.
 */
final class Grips3D {
    final int nGrips;
    final int[] gripSymmetryOrders;
    final double[][][] gripUsefulMats;
    final float[][] gripCenters;
    final int[] gripDims;
    final int[] grip2face;

    /**
     * How far a grip's centre is nudged from its element's centre towards its face's centre.
     *
     * Copied from the 4D path, where it exists so that two grips on the same cubie do not land on
     * the same point — the pick resolves a click by finding the nearest grip centre, and coincident
     * centres would make that a coin toss. The same hazard exists here for a corner shared by three
     * faces, so the same remedy applies.
     */
    private static final double NUDGE = 0.01;

    Grips3D(PolytopePuzzleDescription p) throws Exception {
        int nDims = p.nDims();
        if(nDims != 3)
            throw new IllegalArgumentException("Grips3D is for 3D puzzles, got nDims=" + nDims);

        CSG.SPolytope original = (CSG.SPolytope) read(p, "originalPolytope");
        CSG.Polytope whole = original.p;
        // Face indices in the asset are positions in this array -- the description derives its own
        // the same way (`originalElements[nDims-1]`), which is a local there rather than a field.
        CSG.Polytope[] faces = whole.getAllElements()[nDims - 1];

        // calcRotationGroupOrder wants a 3-dimensional argument to rotate; in 4D that is the cell,
        // and here it is the solid itself. Passing a face instead is what fails its precondition.
        if(whole.dim != 3)
            throw new IllegalStateException("expected a 3-dimensional polytope, got dim=" + whole.dim);

        int count = 0;
        for(CSG.Polytope face : faces) {
            CSG.Polytope[][] elements = face.getAllElements();
            for(int dim = 0; dim <= nDims - 1; ++dim)
                count += elements[dim].length;
        }

        nGrips = count;
        gripSymmetryOrders = new int[nGrips];
        gripUsefulMats = new double[nGrips][nDims][nDims];
        gripCenters = new float[nGrips][];
        gripDims = new int[nGrips];
        grip2face = new int[nGrips];

        double[] faceCenter = new double[nDims];
        double[] center = new double[nDims];
        int g = 0;
        for(int f = 0; f < faces.length; ++f) {
            CSG.Polytope face = faces[f];
            CSG.cgOfVerts(faceCenter, face);
            CSG.Polytope[][] elements = face.getAllElements();
            for(int dim = 0; dim <= nDims - 1; ++dim) {
                for(CSG.Polytope element : elements[dim]) {
                    gripSymmetryOrders[g] =
                        CSG.calcRotationGroupOrder(whole, whole, element, gripUsefulMats[g]);
                    CSG.cgOfVerts(center, element);
                    VecMath.lerp(center, center, faceCenter, NUDGE);
                    gripCenters[g] = VecMath.doubleToFloat(center);
                    gripDims[g] = dim;
                    grip2face[g] = f;
                    g++;
                }
            }
        }
    }

    private static Object read(PolytopePuzzleDescription p, String name) throws Exception {
        Field field = PolytopePuzzleDescription.class.getDeclaredField(name);
        field.setAccessible(true);
        return field.get(p);
    }
}
