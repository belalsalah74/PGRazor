package dev.pgrazor;

import java.io.DataInputStream;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;

/** Reads the native executable's ABI, independent of translated app libraries. */
public final class RuntimeAbi {
    private RuntimeAbi() {}

    public static String nativeProcessAbi() throws IOException {
        try (InputStream input = new FileInputStream("/proc/self/exe")) {
            return readElfAbi(input);
        } catch (IOException | SecurityException error) {
            throw new IOException("Cannot determine native process ABI from /proc/self/exe: " + error.getMessage(), error);
        }
    }

    public static String readElfAbi(InputStream input) throws IOException {
        byte[] header = new byte[64];
        try {
            new DataInputStream(input).readFully(header);
        } catch (java.io.EOFException error) {
            throw new IOException("Truncated native executable ELF header", error);
        }
        if (header[0] != 0x7f || header[1] != 'E' || header[2] != 'L' || header[3] != 'F')
            throw new IOException("Native executable is not ELF");
        if (header[4] != 2)
            throw new IOException("Unsupported native ELF class: " + (header[4] & 255) + "; a 64-bit process is required");
        if (header[5] != 1)
            throw new IOException("Unsupported native ELF byte order: " + (header[5] & 255));
        if (header[6] != 1)
            throw new IOException("Unsupported native ELF version: " + (header[6] & 255));
        int machine = (header[18] & 255) | ((header[19] & 255) << 8);
        if (machine == 183) return "arm64-v8a";
        if (machine == 62) return "x86_64";
        throw new IOException("Unsupported native ELF machine: " + machine);
    }

    public static String requireMatch(String requested, String nativeAbi) throws IOException {
        if (!supported(nativeAbi)) throw new IOException("Unsupported native process ABI: " + nativeAbi);
        if (requested == null || requested.isEmpty()) return nativeAbi;
        if (!supported(requested)) throw new IOException("Unsupported Gadget ABI: " + requested);
        if (!requested.equals(nativeAbi)) {
            throw new IOException("Gadget ABI " + requested + " does not match native process ABI " + nativeAbi
                    + ". Java hooks require the native runtime architecture; ARM translation is not supported by this build.");
        }
        return requested;
    }

    public static String select(String requested, String nativeAbi, String[] bundled) throws IOException {
        String selected = requireMatch(requested, nativeAbi);
        for (String candidate : bundled) if (selected.equals(candidate)) return selected;
        throw new IOException("No bundled runtime for native process ABI: " + selected);
    }

    private static boolean supported(String abi) {
        return "arm64-v8a".equals(abi) || "x86_64".equals(abi);
    }
}
