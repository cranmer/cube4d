package com.superliminal.export;

import com.superliminal.magiccube4d.MagicCube;
import com.superliminal.magiccube4d.PolytopePuzzleDescription;

import java.io.File;
import java.io.FileOutputStream;
import java.io.PrintWriter;
import java.lang.reflect.Field;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.GZIPOutputStream;

/**
 * Phase 1: turn every catalog puzzle into a .mc4dpz asset, and dump golden twist permutations for
 * the TypeScript port to check itself against.
 *
 * Why this exists at all: after construction, PolytopePuzzleDescription reads nothing from the CSG
 * polytope but a handful of integers -- every method the running program calls reads precomputed
 * arrays. So the web app needs those arrays, not Don Hatch's 7k-line CSG kernel. Exporting them
 * here also means grip indices come from the same code that produced every .log file in existence,
 * which makes legacy compatibility exact rather than carefully-matched.
 *
 * Usage:
 *   java ... AssetExporter <outDir> [--only "{4,3,3} 3"] [--goldens]
 */
public class AssetExporter {

    /** Bump when the asset layout or the geometry it captures changes. Saves record this. */
    static final String ASSETS_VERSION = "2026.07.1";

    /**
     * Puzzles worth dumping golden twist permutations for, chosen to exercise different parts of
     * the construction rather than for coverage's sake:
     *
     *   {4,3,3} 3   the default puzzle -- dumped exhaustively
     *   {4,3,3} 2   even length, which takes the coincident-cut epsilon path
     *   {3,3,3} 3   a simplex: no opposite faces, so all cuts land on the near side
     *   {3}x{3} 3   uniform triangular duoprism -- the special-case cut logic
     *   {5}x{4} 3   an ordinary duoprism
     *   {5,3}x{} 3  dodecahedral prism, exercising the hardcoded polytope data
     *   {100}x{4} 3 circumradius 31.87 -- the precision stress case for the fuzzy hash
     *   {5,3,3} 2   the largest puzzle in the catalog
     */
    private static final String[] GOLDEN_PUZZLES = {
        "{4,3,3} 3", "{4,3,3} 2", "{4,3,3} 5", "{3,3,3} 3", "{3}x{3} 3",
        "{5}x{4} 3", "{5,3}x{} 3", "{100}x{4} 3", "{5,3,3} 2",
    };
    // {4,3,3} 5 is here for the log corpus rather than for geometry coverage: the Hall of Fame
    // includes 5^4 solves, and replaying them needs the matching asset.

    /**
     * The default puzzle is dumped exhaustively -- all 2,912 legal moves -- because it is the one
     * the port is held to bit-for-bit. Exhaustive dumps are not affordable elsewhere ({5,3}x{} 3
     * alone would be 14 MB), so the rest get a deterministic stride sample, which still catches a
     * systematic error anywhere in the grip array.
     */
    private static final String EXHAUSTIVE_GOLDEN_PUZZLE = "{4,3,3} 3";

    /**
     * Budget by bytes, not by entry count: a permutation costs nStickers*4 bytes, and nStickers
     * ranges from 75 to 7,560 across the catalog. Capping entries instead would make a
     * {5,3,3} sample 30x larger than a {3,3,3} one for no extra confidence.
     */
    private static final int MAX_GOLDEN_BYTES = 1_500_000;
    private static final int MIN_GOLDEN_ENTRIES = 64;

    /**
     * Three-dimensional puzzles, which the original's catalog does not contain because it could
     * never build their twist axes -- see docs/three-d.md and Grips3D.
     *
     * A separate list rather than an addition to MagicCube.SUPPORTED_PUZZLES, because that list is
     * the original's and this is not: nothing in the legacy submodule is modified. Lengths start at
     * 2 rather than 1 for the same reason the gallery hides length 1 -- one cubie is not a puzzle.
     *
     * {3,3} and {3,4} are absent because they fail inside the CSG for unrelated reasons: an
     * orientation assertion and an unimplemented Schlafli case. The 3D family here is cubes and
     * dodecahedra.
     *
     * Exported only with --include-3d, and off by default until it works: 3D stickers share vertices
     * where 4D stickers do not, which the asset format's index encoding relies on. See
     * docs/three-d.md section 8. Leaving these in the default catalog broke the deploy.
     */
    private static final String[][] PUZZLES_3D = {
        { "{4,3}", "2,3,4,5,6,7", "Cube" },
        { "{5,3}", "2,3", "Dodecahedron" },
    };

    public static void main(String[] args) throws Exception {
        File outDir = new File(args.length > 0 ? args[0] : "build/assets");
        String only = null;
        boolean goldens = false;
        boolean include3d = false;
        for(int i = 1; i < args.length; ++i) {
            if("--only".equals(args[i]) && i + 1 < args.length) only = args[++i];
            else if("--goldens".equals(args[i])) goldens = true;
            else if("--include-3d".equals(args[i])) include3d = true;
        }
        outDir.mkdirs();

        List<String> manifest = new ArrayList<String>();
        int built = 0;

        List<String[]> catalog = new ArrayList<String[]>();
        for(String[] entry : MagicCube.SUPPORTED_PUZZLES)
            catalog.add(entry);
        if(include3d)
            for(String[] entry : PUZZLES_3D)
                catalog.add(entry);

        for(String[] entry : catalog) {
            String schlafli = entry[0];
            if(schlafli == null)
                continue;
            // The catalog's third column is a human name; several entries leave it blank.
            String displayName = entry.length > 2 && entry[2] != null ? entry[2] : "";
            for(String lengthString : entry[1].split(",")) {
                double length = Double.parseDouble(lengthString);
                String id = schlafli + " " + trim(length);
                if(only != null && !only.equals(id))
                    continue;

                System.out.print(id + "\t");
                System.out.flush();
                PolytopePuzzleDescription p = new PolytopePuzzleDescription(schlafli, length, null);
                Extractor extractor = new Extractor(p, schlafli, length);
                byte[] asset = extractor.build();

                String file = fileName(schlafli, length);
                writeFile(new File(outDir, file), asset);
                byte[] gz = gzip(asset);
                writeFile(new File(outDir, file + ".gz"), gz);

                manifest.add(manifestEntry(p, extractor, schlafli, length, id, displayName, file,
                    asset, gz));
                System.out.println(kb(asset.length) + " raw, " + kb(gz.length) + " gzipped");
                built++;

                if(goldens && wantsGoldens(id))
                    dumpGoldenPermutations(p, id, new File(outDir, "../../fixtures/perm"));
            }
        }

        writeManifest(new File(outDir, "manifest.json"), manifest);
        System.out.println("\nexported " + built + " puzzles to " + outDir);
    }

    // ============================================================ extraction

    /**
     * Pulls the runtime-relevant arrays out of a built puzzle.
     *
     * Several are private with no accessor, so they come out by reflection. That is deliberate: the
     * alternative is patching the submodule, which would fork it and make tracking upstream painful.
     */
    private static class Extractor {
        final PolytopePuzzleDescription p;
        final String schlafli;
        final double length;
        final int nDims, nFaces, nStickers, nGrips, nVerts;
        /** Non-null only for 3D puzzles, whose axes the original does not generate. */
        final Grips3D grips3d;
        /**
         * Vertices actually written, which differs from p.nVerts() for 3D: expansion gives each
         * sticker private copies. Set by build(), so read it afterwards.
         */
        int nVertsWritten;

        Extractor(PolytopePuzzleDescription p, String schlafli, double length) throws Exception {
            this.p = p;
            this.schlafli = schlafli;
            this.length = length;
            this.nDims = p.nDims();
            this.nFaces = p.nFaces();
            this.nStickers = p.nStickers();
            // p.nGrips() reads the description's own grip tables, which do not exist for 3D.
            this.grips3d = p.nDims() == 3 ? new Grips3D(p) : null;
            this.nGrips = grips3d != null ? grips3d.nGrips : p.nGrips();
            this.nVerts = p.nVerts();
        }

        byte[] build() throws Exception {
            int[][][] stickerInds = p.getStickerInds();

            // 3D stickers are polygons on a shared surface mesh rather than solids with private
            // vertices, so they are expanded first -- see Expand3D and docs/three-d.md section 8.
            // Only for 3D: renumbering 4D vertices would change a wire format.
            Expand3D expanded = nDims == 3 ? new Expand3D(p) : null;

            // -------- vertex ranges
            // Each sticker owns a private, contiguous block of vertices -- PolyFromPolytope is run
            // per sticker and Poly.concat copies the blocks in order, so there is no sharing. The
            // asset relies on this to store polygon indices sticker-locally in one byte. Verify it
            // rather than trust it.
            int[] vertBegin = expanded != null ? expanded.vertBegin : new int[nStickers];
            int[] vertCount = expanded != null ? expanded.vertCount : new int[nStickers];
            int nVertsOut = expanded != null ? expanded.nVerts : nVerts;
            nVertsWritten = nVertsOut;
            int expectedNext = 0;
            for(int s = 0; expanded == null && s < nStickers; ++s) {
                int lo = Integer.MAX_VALUE, hi = Integer.MIN_VALUE;
                for(int[] poly : stickerInds[s])
                    for(int v : poly) {
                        lo = Math.min(lo, v);
                        hi = Math.max(hi, v);
                    }
                Blocks.require(lo != Integer.MAX_VALUE, "sticker " + s + " has no vertices");
                Blocks.require(lo == expectedNext,
                    "sticker vertex ranges are not contiguous and in order at sticker " + s
                        + " (expected to start at " + expectedNext + ", starts at " + lo + ")");
                vertBegin[s] = lo;
                vertCount[s] = hi - lo + 1;
                Blocks.require(vertCount[s] <= 256,
                    "sticker " + s + " spans " + vertCount[s] + " vertices; u8 local indices overflow");
                expectedNext = hi + 1;
            }
            if(expanded == null)
                Blocks.require(expectedNext == nVerts,
                    "sticker vertex ranges cover " + expectedNext + " of " + nVerts + " vertices");
            // The expansion establishes the same invariant by construction, so check it holds.
            for(int s = 0; expanded != null && s < nStickers; ++s) {
                Blocks.require(vertBegin[s] == (s == 0 ? 0 : vertBegin[s - 1] + vertCount[s - 1]),
                    "expanded sticker " + s + " does not follow its predecessor");
                Blocks.require(vertCount[s] <= 256,
                    "expanded sticker " + s + " spans " + vertCount[s] + " vertices; u8 overflows");
            }

            // -------- polygon topology, indices made sticker-local
            int nPolys = 0, sumPolyVerts = 0;
            for(int[][] sticker : stickerInds) {
                nPolys += sticker.length;
                for(int[] poly : sticker)
                    sumPolyVerts += poly.length;
            }
            int[] stickerPolyCount = expanded != null ? expanded.stickerPolyCount : new int[nStickers];
            int[] polyVertCount = expanded != null ? expanded.polyVertCount : new int[nPolys];
            int[] polyIndsLocal = expanded != null ? expanded.polyIndsLocal : new int[sumPolyVerts];
            int ip = 0, ii = 0;
            for(int s = 0; expanded == null && s < nStickers; ++s) {
                stickerPolyCount[s] = stickerInds[s].length;
                for(int[] poly : stickerInds[s]) {
                    polyVertCount[ip++] = poly.length;
                    for(int v : poly)
                        polyIndsLocal[ii++] = v - vertBegin[s];
                }
            }

            // -------- the shrink decomposition
            // Of the three per-vertex arrays the Java keeps, two are ALIASES: one float[] shared by
            // every vertex of a sticker, and one shared by every vertex of a face
            // (PolytopePuzzleDescription.java:806-822). Storing them at their true cardinality is
            // lossless and roughly thirds the dominant term.
            float[][] vertsMinusStickerCenters = (float[][]) field("vertsMinusStickerCenters");
            float[][] vertStickerCentersMinusFaceCenters =
                (float[][]) field("vertStickerCentersMinusFaceCenters");
            float[][] faceCenters = (float[][]) field("faceCenters");

            // For 3D both of these come from the expansion: the per-vertex arrays the 4D path reads
            // are relative to whichever sticker claimed each vertex first, which is not necessarily
            // the sticker asking.
            if(expanded != null) {
                vertsMinusStickerCenters = expanded.vertsMinusStickerCenters;
            }
            float[][] stickerCenterMinusFaceCenter = expanded != null
                ? expanded.stickerCenterMinusFaceCenter : new float[nStickers][];
            for(int s = 0; expanded == null && s < nStickers; ++s)
                stickerCenterMinusFaceCenter[s] = vertStickerCentersMinusFaceCenters[vertBegin[s]];

            // -------- twist-path data. f64 is mandatory here, not a preference.
            // FuzzyPointHashTable uses ABSOLUTE epsilons (1e-9/1e-8) and the catalog reaches a
            // circumradius of 31.87, making the tolerance 3.1e-10 relative -- ~380x finer than
            // float32 resolves. Narrowing any of these silently breaks twisting on large puzzles.
            double[][] stickerCenters = (double[][]) field("stickerCentersD");
            double[][] faceInwardNormals = (double[][]) field("faceInwardNormals");
            double[][] faceCutOffsets = (double[][]) field("faceCutOffsets");
            // For 3D these come from Grips3D rather than from the description; everything else on
            // this page is dimension-generic and needs no branch.
            double[][][] gripUsefulMats = grips3d != null
                ? grips3d.gripUsefulMats : (double[][][]) field("gripUsefulMats");
            int[] gripDims = grips3d != null ? grips3d.gripDims : (int[]) field("gripDims");
            float[][] gripCenters = grips3d != null
                ? grips3d.gripCenters : (float[][]) field("gripCentersF");
            int[] grip2face = grips3d != null ? grips3d.grip2face : p.getGrip2Face();
            int[] gripSymmetryOrders = grips3d != null
                ? grips3d.gripSymmetryOrders : p.getGripSymmetryOrders();
            float[][] nicePoints = (float[][]) field("nicePointsToRotateToCenter");

            int[] faceCutCounts = new int[nFaces];
            int totalCuts = 0;
            for(int f = 0; f < nFaces; ++f) {
                faceCutCounts[f] = faceCutOffsets[f].length;
                totalCuts += faceCutCounts[f];
            }
            double[] flatCuts = new double[totalCuts];
            int ic = 0;
            for(double[] cuts : faceCutOffsets)
                for(double c : cuts)
                    flatCuts[ic++] = c;

            Blocks b = new Blocks();
            b.scalar("format", "mc4dpz")
             .scalar("assetsVersion", ASSETS_VERSION)
             .scalar("schlafli", schlafli)
             .scalar("edgeLength", length)
             .scalar("nDims", nDims)
             .scalar("nFaces", nFaces)
             .scalar("nCubies", p.nCubies())
             .scalar("nStickers", nStickers)
             .scalar("nGrips", nGrips)
             .scalar("nVerts", nVertsOut)
             .scalar("nPolys", nPolys)
             .scalar("circumRadius", p.circumRadius())
             .scalar("inRadius", p.inRadius());

            b.f32("vertsMinusStickerCenters", vertsMinusStickerCenters, nDims);
            b.f32("stickerCenterMinusFaceCenter", stickerCenterMinusFaceCenter, nDims);
            b.f32("faceCenters", faceCenters, nDims);

            b.u32("stickerVertBegin", vertBegin);
            b.u16("stickerVertCount", vertCount);
            b.u16("stickerPolyCount", stickerPolyCount);
            b.u8("polyVertCount", polyVertCount);
            b.u8("polyIndsLocal", polyIndsLocal);

            b.u16("sticker2face", p.getSticker2Face());
            // Values are union-find representatives, so non-consecutive and up to nStickers-1.
            b.u32("sticker2cubie", p.getSticker2Cubie());
            b.i32("face2OppositeFace", p.getFace2OppositeFace()); // -1 where there is none

            b.f64("stickerCenters", stickerCenters, nDims);
            b.f64("faceInwardNormals", faceInwardNormals, nDims);
            b.u8("faceCutCounts", faceCutCounts);
            b.f64("faceCutOffsets", flatCuts);

            b.f64("gripUsefulMats", gripUsefulMats, nDims, nDims);
            b.f32("gripCenters", gripCenters, nDims);
            b.u8("gripDims", gripDims);
            b.u16("grip2face", grip2face);
            b.u16("gripSymmetryOrders", gripSymmetryOrders);

            b.f32("nicePoints", nicePoints, nDims);

            return b.finish();
        }

        private Object field(String name) throws Exception {
            Field f = PolytopePuzzleDescription.class.getDeclaredField(name);
            f.setAccessible(true);
            return f.get(p);
        }
    }

    // ============================================================ golden permutations

    /**
     * Dumps the sticker permutation the Java produces for every legal (grip, direction, slicemask),
     * by running the real applyTwistToState on an identity state.
     *
     * This is the fixture the whole port hangs on: matching it bit-for-bit proves the fuzzy hash
     * port, the twist matrix construction, the slicemask classification, and the grip ordering are
     * all correct simultaneously.
     *
     * Layout (little-endian): "MC4DPERM", u32 version, u32 nStickers, u32 nEntries, u32 pad,
     * then nEntries x {i32 grip, i32 dir, i32 slicemask}, then nEntries x nStickers x i32.
     * Convention: perm[destination] = source.
     */
    private static void dumpGoldenPermutations(PolytopePuzzleDescription p, String id, File outDir)
        throws Exception
    {
        outDir.mkdirs();
        int nStickers = p.nStickers(), nGrips = p.nGrips();
        int[] orders = p.getGripSymmetryOrders();

        // Enumerate every legal move first, then decide whether to keep them all.
        List<int[]> all = new ArrayList<int[]>();
        for(int g = 0; g < nGrips; ++g) {
            if(orders[g] < 2)
                continue; // 0 = cannot rotate (cell-centre grips); 1 = a 360-degree no-op
            int nSlices = p.getNumSlicesForGrip(g);
            for(int mask = 1; mask < (1 << nSlices); ++mask)
                for(int dir = -1; dir <= 1; dir += 2)
                    all.add(new int[]{g, dir, mask});
        }

        // A prime-ish stride spreads the sample across the whole grip array rather than clustering
        // it at the start, so a systematic ordering error anywhere still shows up.
        int affordable = Math.max(MIN_GOLDEN_ENTRIES, MAX_GOLDEN_BYTES / (nStickers * 4));
        boolean exhaustive = EXHAUSTIVE_GOLDEN_PUZZLE.equals(id) || all.size() <= affordable;
        int stride = exhaustive ? 1 : Math.max(1, all.size() / affordable);

        List<int[]> metas = new ArrayList<int[]>();
        List<int[]> perms = new ArrayList<int[]>();
        for(int i = 0; i < all.size(); i += stride) {
            int[] move = all.get(i);
            int[] state = new int[nStickers];
            for(int s = 0; s < nStickers; ++s)
                state[s] = s;
            p.applyTwistToState(state, move[0], move[1], move[2]);
            metas.add(move);
            perms.add(state);
        }

        int nEntries = metas.size();
        ByteBuffer buf = ByteBuffer
            .allocate(24 + nEntries * 12 + nEntries * nStickers * 4)
            .order(ByteOrder.LITTLE_ENDIAN);
        buf.put("MC4DPERM".getBytes("US-ASCII"));
        buf.putInt(1);
        buf.putInt(nStickers);
        buf.putInt(nEntries);
        buf.putInt(0);
        for(int[] m : metas) {
            buf.putInt(m[0]);
            buf.putInt(m[1]);
            buf.putInt(m[2]);
        }
        for(int[] perm : perms)
            for(int v : perm)
                buf.putInt(v);

        // Stored gzipped: permutation data is compressible enough to be worth keeping in git, and
        // Node can inflate it with no dependency.
        byte[] gz = gzip(buf.array());
        File out = new File(outDir, safeName(id) + ".bin.gz");
        writeFile(out, gz);
        System.out.println("  goldens: " + nEntries + " of " + all.size() + " permutations"
            + (exhaustive ? " (exhaustive)" : " (every " + stride + "th)")
            + " -> " + out.getName() + " (" + kb(gz.length) + " gzipped from " + kb(buf.capacity()) + ")");
    }

    private static boolean wantsGoldens(String id) {
        for(String g : GOLDEN_PUZZLES)
            if(g.equals(id))
                return true;
        return false;
    }

    // ============================================================ plumbing

    private static String manifestEntry(PolytopePuzzleDescription p, Extractor extractor,
        String schlafli, double length,
        String id, String displayName, String file, byte[] raw, byte[] gz) throws Exception
    {
        return "    {\"id\": \"" + id + "\""
            + ", \"schlafli\": \"" + schlafli + "\""
            + ", \"name\": \"" + displayName + "\""
            + ", \"length\": " + trim(length)
            + ", \"path\": \"" + file + "\""
            + ", \"bytes\": " + raw.length
            + ", \"gzipBytes\": " + gz.length
            + ", \"sha256\": \"" + sha256(raw) + "\""
            + ", \"nFaces\": " + p.nFaces()
            + ", \"nCubies\": " + p.nCubies()
            + ", \"nStickers\": " + p.nStickers()
            // From the extractor rather than the description: for 3D the description has no grip
            // tables at all, and its vertex count predates the expansion.
            + ", \"nGrips\": " + extractor.nGrips
            + ", \"nVerts\": " + extractor.nVertsWritten
            + "}";
    }

    private static void writeManifest(File f, List<String> entries) throws Exception {
        PrintWriter w = new PrintWriter(f, "UTF-8");
        w.println("{");
        w.println("  \"assetsVersion\": \"" + ASSETS_VERSION + "\",");
        w.println("  \"puzzles\": [");
        for(int i = 0; i < entries.size(); ++i)
            w.println(entries.get(i) + (i + 1 < entries.size() ? "," : ""));
        w.println("  ]");
        w.println("}");
        w.close();
    }

    private static void writeFile(File f, byte[] data) throws Exception {
        f.getParentFile().mkdirs();
        FileOutputStream out = new FileOutputStream(f);
        try {
            out.write(data);
        } finally {
            out.close();
        }
    }

    private static byte[] gzip(byte[] data) throws Exception {
        java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
        GZIPOutputStream gz = new GZIPOutputStream(bos);
        gz.write(data);
        gz.close();
        return bos.toByteArray();
    }

    private static String sha256(byte[] data) throws Exception {
        byte[] d = MessageDigest.getInstance("SHA-256").digest(data);
        StringBuilder sb = new StringBuilder();
        for(byte b : d)
            sb.append(String.format("%02x", b));
        return sb.toString();
    }

    /** Schlafli symbols contain braces and commas; keep filenames boring. */
    static String fileName(String schlafli, double length) {
        return safeName(schlafli + " " + trim(length)) + ".mc4dpz";
    }

    private static String safeName(String id) {
        return id.replace("{", "").replace("}", "").replace(",", "-")
                 .replace(" ", "_").replace("/", "over");
    }

    static String trim(double d) {
        return d == Math.rint(d) ? String.valueOf((long) d) : String.valueOf(d);
    }

    private static String kb(long bytes) {
        if(bytes < 1024) return bytes + " B";
        if(bytes < 1024 * 1024) return String.format("%.1f KB", bytes / 1024.0);
        return String.format("%.2f MB", bytes / (1024.0 * 1024.0));
    }
}
