package com.superliminal.export;

import com.superliminal.magiccube4d.MagicCube;
import com.superliminal.magiccube4d.PolytopePuzzleDescription;

import java.io.File;
import java.io.PrintWriter;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;

/**
 * Phase 0: measure every puzzle in the catalog.
 *
 * Produces the numbers the port's architecture depends on but which nobody has ever written down:
 * per-puzzle element counts, build times, and the exact byte size of the binary asset each puzzle
 * would export to. The plan's asset-size figures were estimated from geometry; this replaces them
 * with measurements, and decides which catalog entries are cheap enough to ship.
 *
 * Also regenerates the counts reference that ModuleTest was written to produce but never committed.
 *
 * Usage: java -Xmx6g -Djava.awt.headless=true com.superliminal.export.Phase0Survey <outDir> [maxSeconds]
 */
public class Phase0Survey {

    /** Byte width of each field in the .mc4dpz asset. f64 where the fuzzy point hash demands it. */
    private static final int F32 = 4, F64 = 8;

    public static void main(String[] args) throws Exception {
        File outDir = new File(args.length > 0 ? args[0] : "fixtures");
        outDir.mkdirs();
        long budgetMs = (args.length > 1 ? Long.parseLong(args[1]) : 600) * 1000L;

        List<Row> rows = new ArrayList<Row>();
        long startedAll = System.currentTimeMillis();

        for(String[] entry : MagicCube.SUPPORTED_PUZZLES) {
            String schlafli = entry[0];
            if(schlafli == null)
                continue; // the "Invent my own!" menu placeholder
            for(String lengthString : entry[1].split(",")) {
                double length = Double.parseDouble(lengthString);
                Row row = new Row(schlafli, length, entry[2]);

                if(System.currentTimeMillis() - startedAll > budgetMs) {
                    row.status = "SKIPPED_BUDGET";
                    rows.add(row);
                    System.out.println(row.id() + "\tSKIPPED (time budget exhausted)");
                    continue;
                }

                System.out.print(row.id() + "\t");
                System.out.flush();
                try {
                    measure(row);
                    System.out.println(row.nStickers + " stickers, " + row.nGrips + " grips, "
                        + row.nVerts + " verts, " + row.buildMs + " ms, " + kb(row.assetBytes));
                } catch(Throwable t) {
                    // Per-puzzle isolation. ModuleTest aborts the whole run on the first failure,
                    // which is why {3,3}x{} was commented out of the catalog rather than recorded.
                    row.status = "FAILED";
                    row.error = t.getClass().getSimpleName()
                        + (t.getMessage() == null ? "" : ": " + t.getMessage());
                    System.out.println("FAILED  " + row.error);
                }
                rows.add(row);
            }
        }

        writeCountsRef(new File(outDir, "counts.ref"), rows);
        writeSizesCsv(new File(outDir, "sizes.csv"), rows);
        summarize(rows);
    }

    private static void measure(Row row) {
        long t0 = System.currentTimeMillis();
        PolytopePuzzleDescription p = new PolytopePuzzleDescription(row.schlafli, row.length, null);
        row.buildMs = System.currentTimeMillis() - t0;

        row.nDims = p.nDims();
        row.nFaces = p.nFaces();
        row.nCubies = p.nCubies();
        row.nStickers = p.nStickers();
        row.nGrips = p.nGrips();
        row.nVerts = p.nVerts();
        row.circumRadius = p.circumRadius();

        // Polygon topology, and whether sticker-local vertex indices fit in a byte.
        int[][][] stickerInds = p.getStickerInds();
        int maxVertsPerSticker = 0;
        for(int[][] sticker : stickerInds) {
            row.nPolys += sticker.length;
            int lo = Integer.MAX_VALUE, hi = Integer.MIN_VALUE;
            for(int[] poly : sticker) {
                row.sumPolyVerts += poly.length;
                for(int v : poly) {
                    if(v < lo) lo = v;
                    if(v > hi) hi = v;
                }
            }
            if(sticker.length > 0)
                maxVertsPerSticker = Math.max(maxVertsPerSticker, hi - lo + 1);
        }
        row.maxVertsPerSticker = maxVertsPerSticker;

        // Total cut hyperplanes, via the public per-grip slice count.
        int[] grip2face = p.getGrip2Face();
        int[] cutsPerFace = new int[row.nFaces];
        for(int g = 0; g < row.nGrips; ++g)
            cutsPerFace[grip2face[g]] = p.getNumSlicesForGrip(g) - 1;
        for(int c : cutsPerFace)
            row.totalCuts += c;

        row.nNicePoints = countNicePoints(p);
        row.assetBytes = assetBytes(row);
        row.status = "OK";
    }

    /** nicePointsToRotateToCenter is private and has no accessor, but we need its size. */
    private static int countNicePoints(PolytopePuzzleDescription p) {
        try {
            Field f = PolytopePuzzleDescription.class.getDeclaredField("nicePointsToRotateToCenter");
            f.setAccessible(true);
            return ((float[][]) f.get(p)).length;
        } catch(Throwable t) {
            return -1;
        }
    }

    /**
     * Exact size of the binary asset this puzzle would export to, per the .mc4dpz layout.
     *
     * The three shrink arrays in the Java are nVerts long, but two of them are *aliases* -- one
     * value per sticker and one per face (PolytopePuzzleDescription.java:806-822). Storing them at
     * their true cardinality is lossless and cuts the dominant term by about 3x.
     */
    private static long assetBytes(Row r) {
        int indexWidth = r.maxVertsPerSticker <= 256 ? 1 : 2;
        long b = 0;
        b += (long) r.nVerts * 4 * F32;            // vertsMinusStickerCenters
        b += (long) r.nStickers * 4 * F32;         // stickerCenterMinusFaceCenter (was aliased)
        b += (long) r.nFaces * 4 * F32;            // faceCenters                  (was aliased)
        b += (long) r.nStickers * 2 * 2;           // per-sticker vert + poly counts (u16)
        b += r.nPolys;                             // polyVertCount (u8)
        b += (long) r.sumPolyVerts * indexWidth;   // sticker-local polygon indices
        b += (long) r.nStickers * 2;               // sticker2face (u16)
        b += (long) r.nStickers * 4;               // sticker2cubie (u32; values are DSU roots, not dense)
        b += (long) r.nFaces * 2;                  // face2OppositeFace (i16)
        // f64 mandatory below: FuzzyPointHashTable uses ABSOLUTE epsilons (1e-9/1e-8), and f32's
        // ~1.2e-7 relative precision is three orders of magnitude too coarse at these coordinates.
        b += (long) r.nStickers * 4 * F64;         // stickerCenters
        b += (long) r.nFaces * 4 * F64;            // faceInwardNormals
        b += (long) r.totalCuts * F64 + r.nFaces;  // faceCutOffsets (ragged)
        b += (long) r.nGrips * 16 * F64;           // gripUsefulMats
        b += (long) r.nGrips * 4 * F32;            // gripCenters
        b += r.nGrips;                             // gripDims (u8)
        b += (long) r.nGrips * 2 * 2;              // grip2face + gripSymmetryOrders (u16)
        b += (long) Math.max(r.nNicePoints, 0) * 4 * F32;
        return b;
    }

    // ---------------------------------------------------------------- output

    /** The file ModuleTest was written to produce (test/puzzleBuildTest.ref), which was never committed. */
    private static void writeCountsRef(File f, List<Row> rows) throws Exception {
        PrintWriter w = new PrintWriter(f, "UTF-8");
        for(Row r : rows) {
            if(!"OK".equals(r.status))
                continue;
            w.println("Puzzle:\t" + r.schlafli + " " + r.length);
            w.println("NumFaces:\t" + r.nFaces);
            w.println("NumCubies:\t" + r.nCubies);
            w.println("NumStickers:\t" + r.nStickers);
            w.println("NumGrips:\t" + r.nGrips);
            w.println();
        }
        w.close();
        System.out.println("\nwrote " + f);
    }

    private static void writeSizesCsv(File f, List<Row> rows) throws Exception {
        PrintWriter w = new PrintWriter(f, "UTF-8");
        w.println("schlafli,length,name,status,nDims,nFaces,nCubies,nStickers,nGrips,nVerts,nPolys,"
            + "sumPolyVerts,maxVertsPerSticker,totalCuts,nNicePoints,circumRadius,buildMs,assetBytes,error");
        for(Row r : rows) {
            w.println(String.format("\"%s\",%s,\"%s\",%s,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%.6f,%d,%d,\"%s\"",
                r.schlafli, trim(r.length), r.name, r.status, r.nDims, r.nFaces, r.nCubies,
                r.nStickers, r.nGrips, r.nVerts, r.nPolys, r.sumPolyVerts, r.maxVertsPerSticker,
                r.totalCuts, r.nNicePoints, r.circumRadius, r.buildMs, r.assetBytes,
                r.error == null ? "" : r.error.replace('"', '\'')));
        }
        w.close();
        System.out.println("wrote " + f);
    }

    private static void summarize(List<Row> rows) {
        int ok = 0, failed = 0, skipped = 0;
        long total = 0, worst = 0, slowest = 0;
        String worstId = "", slowestId = "";
        boolean nStickersEqualsNGripsAtLength3 = true;
        for(Row r : rows) {
            if("OK".equals(r.status)) {
                ok++;
                total += r.assetBytes;
                if(r.assetBytes > worst) { worst = r.assetBytes; worstId = r.id(); }
                if(r.buildMs > slowest) { slowest = r.buildMs; slowestId = r.id(); }
                if(r.length == 3.0 && r.nStickers != r.nGrips)
                    nStickersEqualsNGripsAtLength3 = false;
            } else if("FAILED".equals(r.status)) failed++;
            else skipped++;
        }
        System.out.println("\n=== Phase 0 summary ===");
        System.out.println("built:   " + ok + "   failed: " + failed + "   skipped: " + skipped);
        System.out.println("catalog total (raw):  " + kb(total));
        System.out.println("largest asset:        " + kb(worst) + "   " + worstId);
        System.out.println("slowest build:        " + slowest + " ms   " + slowestId);
        System.out.println("nStickers == nGrips at length 3: " + nStickersEqualsNGripsAtLength3);
        for(Row r : rows)
            if("FAILED".equals(r.status))
                System.out.println("  FAILED  " + r.id() + "  " + r.error);
    }

    private static String kb(long bytes) {
        if(bytes < 1024) return bytes + " B";
        if(bytes < 1024 * 1024) return String.format("%.1f KB", bytes / 1024.0);
        return String.format("%.2f MB", bytes / (1024.0 * 1024.0));
    }

    private static String trim(double d) {
        return d == Math.rint(d) ? String.valueOf((long) d) : String.valueOf(d);
    }

    private static class Row {
        final String schlafli, name;
        final double length;
        String status = "?", error;
        int nDims, nFaces, nCubies, nStickers, nGrips, nVerts;
        int nPolys, sumPolyVerts, maxVertsPerSticker, totalCuts, nNicePoints;
        float circumRadius;
        long buildMs, assetBytes;

        Row(String schlafli, double length, String name) {
            this.schlafli = schlafli;
            this.length = length;
            this.name = name;
        }

        String id() { return schlafli + " " + trim(length); }
    }
}
