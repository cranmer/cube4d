package com.superliminal.export;

import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Builder for the .mc4dpz container: a magic header, a JSON block table, then 8-byte-aligned
 * typed-array blocks.
 *
 * The point of the layout is that a browser can fetch the file, then construct Float32Array /
 * Float64Array / Uint8Array views directly onto the ArrayBuffer with zero copying and zero parsing.
 * Everything is little-endian, which every platform we target is natively.
 *
 * Alignment is 8 bytes so that Float64Array views are always legal -- JavaScript throws
 * RangeError if a typed array's byteOffset is not a multiple of its element size.
 */
class Blocks {

    static final byte[] MAGIC = "MC4DPZ\0".getBytes(StandardCharsets.US_ASCII); // 7 bytes
    static final int VERSION = 1;
    private static final int ALIGN = 8;

    private final List<Block> blocks = new ArrayList<Block>();
    private final StringBuilder scalars = new StringBuilder();

    private static class Block {
        final String name, dtype;
        final int[] shape;
        final byte[] data;
        int offset;

        Block(String name, String dtype, int[] shape, byte[] data) {
            this.name = name;
            this.dtype = dtype;
            this.shape = shape;
            this.data = data;
        }
    }

    // ------------------------------------------------------------------ scalars

    Blocks scalar(String name, String value) {
        if(scalars.length() > 0) scalars.append(",");
        scalars.append('"').append(name).append("\":\"").append(escape(value)).append('"');
        return this;
    }

    Blocks scalar(String name, long value) {
        if(scalars.length() > 0) scalars.append(",");
        scalars.append('"').append(name).append("\":").append(value);
        return this;
    }

    Blocks scalar(String name, double value) {
        if(scalars.length() > 0) scalars.append(",");
        // Repeatable across locales, and round-trips exactly through JSON.
        scalars.append('"').append(name).append("\":").append(Double.toString(value));
        return this;
    }

    // ------------------------------------------------------------------ blocks

    /** Flattens a ragged-free 2D double array to f64. */
    Blocks f64(String name, double[][] rows, int cols) {
        ByteBuffer b = buf(rows.length * cols * 8);
        for(double[] row : rows)
            for(int j = 0; j < cols; ++j)
                b.putDouble(row[j]);
        return add(name, "f64", new int[]{rows.length, cols}, b);
    }

    /** Flattens a 3D double array (e.g. nGrips x nDims x nDims) to f64, row-major. */
    Blocks f64(String name, double[][][] mats, int rows, int cols) {
        ByteBuffer b = buf(mats.length * rows * cols * 8);
        for(double[][] m : mats)
            for(int i = 0; i < rows; ++i)
                for(int j = 0; j < cols; ++j)
                    b.putDouble(m[i][j]);
        return add(name, "f64", new int[]{mats.length, rows, cols}, b);
    }

    Blocks f64(String name, double[] values) {
        ByteBuffer b = buf(values.length * 8);
        for(double v : values)
            b.putDouble(v);
        return add(name, "f64", new int[]{values.length}, b);
    }

    Blocks f32(String name, float[][] rows, int cols) {
        ByteBuffer b = buf(rows.length * cols * 4);
        for(float[] row : rows)
            for(int j = 0; j < cols; ++j)
                b.putFloat(row[j]);
        return add(name, "f32", new int[]{rows.length, cols}, b);
    }

    Blocks u8(String name, int[] values) {
        ByteBuffer b = buf(values.length);
        for(int v : values) {
            require(v >= 0 && v <= 255, name + ": " + v + " does not fit in u8");
            b.put((byte) v);
        }
        return add(name, "u8", new int[]{values.length}, b);
    }

    Blocks u16(String name, int[] values) {
        ByteBuffer b = buf(values.length * 2);
        for(int v : values) {
            require(v >= 0 && v <= 65535, name + ": " + v + " does not fit in u16");
            b.putShort((short) v);
        }
        return add(name, "u16", new int[]{values.length}, b);
    }

    Blocks u32(String name, int[] values) {
        ByteBuffer b = buf(values.length * 4);
        for(int v : values) {
            require(v >= 0, name + ": " + v + " does not fit in u32");
            b.putInt(v);
        }
        return add(name, "u32", new int[]{values.length}, b);
    }

    Blocks i32(String name, int[] values) {
        ByteBuffer b = buf(values.length * 4);
        for(int v : values)
            b.putInt(v);
        return add(name, "i32", new int[]{values.length}, b);
    }

    // ------------------------------------------------------------------ assembly

    private ByteBuffer buf(int bytes) {
        return ByteBuffer.allocate(bytes).order(ByteOrder.LITTLE_ENDIAN);
    }

    private Blocks add(String name, String dtype, int[] shape, ByteBuffer b) {
        blocks.add(new Block(name, dtype, shape, b.array()));
        return this;
    }

    /**
     * The block table has to contain the final byte offsets, but those offsets depend on how long
     * the block table is -- and writing a bigger offset can make the header longer, which pushes
     * the offsets out again. So iterate to a fixpoint: lay out, re-render, and repeat until the
     * header stops growing. It converges in two or three rounds, since each round only adds digits.
     *
     * The header is then space-padded to the reserved length, which keeps the layout valid even if
     * the last render came out slightly shorter. (Trailing spaces are legal JSON whitespace.)
     */
    byte[] finish() throws Exception {
        int headerLen = renderHeader().getBytes(StandardCharsets.UTF_8).length;
        int dataStart, offset;

        for(int round = 0; ; ++round) {
            require(round < 8, "block table layout failed to converge");
            dataStart = align(11 + 4 + headerLen);
            offset = dataStart;
            for(Block blk : blocks) {
                offset = align(offset);
                blk.offset = offset;
                offset += blk.data.length;
            }
            int rendered = renderHeader().getBytes(StandardCharsets.UTF_8).length;
            if(rendered <= headerLen)
                break;
            headerLen = rendered;
        }

        byte[] hb = renderHeader().getBytes(StandardCharsets.UTF_8);
        require(hb.length <= headerLen, "header grew after offset assignment");
        byte[] padded = new byte[headerLen];
        System.arraycopy(hb, 0, padded, 0, hb.length);
        for(int i = hb.length; i < headerLen; ++i)
            padded[i] = ' ';

        ByteArrayOutputStream out = new ByteArrayOutputStream(offset);
        out.write(MAGIC);
        out.write(VERSION);
        writeU32(out, headerLen);
        out.write(padded);
        pad(out, dataStart);
        for(Block blk : blocks) {
            pad(out, blk.offset);
            out.write(blk.data);
        }
        byte[] result = out.toByteArray();
        require(result.length == offset, "assembled size mismatch");
        return result;
    }

    private String renderHeader() {
        StringBuilder sb = new StringBuilder(1024);
        sb.append("{").append(scalars).append(",\"blocks\":{");
        for(int i = 0; i < blocks.size(); ++i) {
            Block b = blocks.get(i);
            if(i > 0) sb.append(",");
            sb.append('"').append(b.name).append("\":{\"offset\":").append(b.offset)
              .append(",\"length\":").append(b.data.length)
              .append(",\"dtype\":\"").append(b.dtype).append("\",\"shape\":[");
            for(int j = 0; j < b.shape.length; ++j) {
                if(j > 0) sb.append(",");
                sb.append(b.shape[j]);
            }
            sb.append("]}");
        }
        return sb.append("}}").toString();
    }

    private static int align(int n) {
        return (n + ALIGN - 1) / ALIGN * ALIGN;
    }

    private static void pad(ByteArrayOutputStream out, int target) {
        while(out.size() < target)
            out.write(0);
    }

    private static void writeU32(OutputStream out, int v) throws Exception {
        out.write(v & 0xff);
        out.write((v >>> 8) & 0xff);
        out.write((v >>> 16) & 0xff);
        out.write((v >>> 24) & 0xff);
    }

    private static String escape(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    static void require(boolean condition, String message) {
        if(!condition)
            throw new IllegalStateException(message);
    }
}
