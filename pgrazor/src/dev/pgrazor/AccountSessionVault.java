package dev.pgrazor;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.util.regex.Pattern;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Encrypted, app-private storage for the opaque "remembered session" blob of a single account
 * profile (a Google or PTC login that the user has chosen to keep signed in). One file per profile
 * holds one ciphertext; the vault never interprets, logs, or exports the plaintext and exposes no
 * listing API — the coordinator owns which profile ids exist and when to switch between them.
 *
 * <p>Blobs live under {@code getNoBackupFilesDir()/pgrazor-account-sessions-v1} so they are excluded
 * from Android auto-backup and never leave the device. Each blob is encrypted with a dedicated
 * AES-256/GCM key held in the {@code AndroidKeyStore} under alias {@code pgrazor-account-sessions-v1}.
 * A fresh random IV is used per write and the GCM AAD binds the envelope format version and the
 * profile id, so a ciphertext file cannot be renamed/copied to masquerade as another profile's
 * session: decryption of a swapped file fails authentication and is reported as a generic failure.
 *
 * <p>The key is created lazily and only on {@link #save}; {@link #read} never creates a key, so a
 * lost/rotated key surfaces as an {@link IOException} rather than silently minting a new, useless
 * key. Unreadable (tampered, truncated, or undecryptable) data is never deleted automatically — the
 * coordinator decides what to do with it. All errors are reported as generic {@link IOException}s
 * that carry no secret material.
 *
 * <p>Writes are atomic and durable: the envelope is streamed to a temp file in the same directory,
 * {@code force(true)}d to stable storage, then atomically moved into place with REPLACE_EXISTING.
 * If the platform cannot perform an atomic move the write fails rather than falling back to a
 * non-atomic replace. All methods are {@code synchronized}; call them off the UI thread. No
 * third-party libraries, no runtime permissions, Java 8 / Android API 28 compatible.
 */
final class AccountSessionVault {
    private static final String DIR = "pgrazor-account-sessions-v1";
    private static final String KEY_ALIAS = "pgrazor-account-sessions-v1";
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final String FILE_SUFFIX = ".bin";

    private static final int GCM_TAG_BITS = 128;
    private static final int GCM_TAG_BYTES = GCM_TAG_BITS / 8;
    private static final int IV_BYTES = 12;

    /** Envelope format version. Bumping this invalidates old blobs (they fail the magic/version check). */
    private static final byte FORMAT_VERSION = 1;
    private static final byte[] MAGIC = { 'P', 'G', 'A', 'V' };
    // magic(4) + version(1) + ivLen(1) + iv(12) + ctLen(4) = 22 byte fixed header.
    private static final int HEADER_BYTES = MAGIC.length + 1 + 1 + IV_BYTES + 4;

    /** Largest plaintext payload accepted, as a sanity/corruption bound. */
    private static final int MAX_PAYLOAD = 1024 * 1024; // 1 MiB
    private static final int MAX_CIPHERTEXT = MAX_PAYLOAD + GCM_TAG_BYTES;
    private static final long MAX_ENVELOPE = (long) HEADER_BYTES + MAX_CIPHERTEXT;

    /** Legacy in-place profile id. Mirrors {@link AccountProfileStore#DEFAULT_ID}. */
    private static final String DEFAULT_ID = "default";
    /** Reserved id for the cross-restart switch journal blob, not a real profile. */
    private static final String SWITCH_JOURNAL_ID = "switch-journal";
    /** Canonical, lower-case UUID only — matches the ids {@link AccountProfileStore} mints. */
    private static final Pattern UUID_LOWER_RE = Pattern.compile(
            "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");

    private final File baseDir;

    /** Resolves the no-backup store root. Does no crypto, so it is safe on the main thread. */
    AccountSessionVault(Context context) throws IOException {
        if (context == null) throw new IllegalArgumentException("context");
        File noBackup = context.getApplicationContext().getNoBackupFilesDir();
        if (noBackup == null) throw new IllegalStateException("No-backup storage is unavailable.");
        // Android may expose /data/data as an alias of /data/user/0. Normalize the
        // framework-owned parent before rejecting symlinks below our own directory.
        this.baseDir = new File(noBackup.getCanonicalFile(), DIR);
    }

    /**
     * Encrypts {@code plain} and stores it as this profile's session blob, replacing any previous
     * one. Creates the store directory and the keystore key on first use. Call off the UI thread.
     *
     * @throws IOException on any storage or crypto failure (never carrying secret content).
     */
    synchronized void save(String id, byte[] plain) throws IOException {
        requireValidId(id);
        if (plain == null) throw new IllegalArgumentException("Session payload is required.");
        if (plain.length == 0) throw new IllegalArgumentException("Session payload is empty.");
        if (plain.length > MAX_PAYLOAD) throw new IllegalArgumentException("Session payload exceeds the size bound.");

        byte[] envelope;
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, loadOrCreateKey());
            cipher.updateAAD(aad(id));
            byte[] iv = cipher.getIV();
            if (iv == null || iv.length != IV_BYTES) throw new IOException("Unexpected IV length.");
            byte[] ciphertext = cipher.doFinal(plain);
            envelope = wrap(iv, ciphertext);
        } catch (IOException e) {
            throw e;
        } catch (GeneralSecurityException e) {
            throw new IOException("Could not encrypt the session.");
        } catch (RuntimeException e) {
            throw new IOException("Could not encrypt the session.");
        }

        File target = resolve(id, true);
        writeAtomic(target, envelope);
    }

    /**
     * Returns the decrypted session blob for this profile, or {@code null} if and only if no blob
     * file exists. A present-but-unreadable blob (tampered, truncated, wrong profile, or missing
     * key) raises an {@link IOException} and is left on disk for the coordinator to handle.
     * Never creates a keystore key. Call off the UI thread.
     */
    synchronized byte[] read(String id) throws IOException {
        requireValidId(id);
        File source = resolve(id, false);
        if (source == null || !source.exists()) return null;
        if (!source.isFile()) throw new IOException("Session blob is not a file.");

        long size = source.length();
        if (size < HEADER_BYTES || size > MAX_ENVELOPE) throw new IOException("Session blob is malformed.");
        byte[] envelope = Files.readAllBytes(source.toPath());
        if (envelope.length < HEADER_BYTES || envelope.length > MAX_ENVELOPE)
            throw new IOException("Session blob is malformed.");

        byte[] iv;
        byte[] ciphertext;
        ByteBuffer buf = ByteBuffer.wrap(envelope);
        try {
            byte[] magic = new byte[MAGIC.length];
            buf.get(magic);
            for (int i = 0; i < MAGIC.length; i++) if (magic[i] != MAGIC[i]) throw new IOException();
            if (buf.get() != FORMAT_VERSION) throw new IOException();
            int ivLen = buf.get() & 0xff;
            if (ivLen != IV_BYTES) throw new IOException();
            iv = new byte[ivLen];
            buf.get(iv);
            int ctLen = buf.getInt();
            if (ctLen < GCM_TAG_BYTES || ctLen > MAX_CIPHERTEXT || ctLen != buf.remaining())
                throw new IOException();
            ciphertext = new byte[ctLen];
            buf.get(ciphertext);
        } catch (RuntimeException | IOException parse) {
            // Any structural problem is reported uniformly with no detail.
            throw new IOException("Session blob is malformed.");
        }

        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, loadKeyForRead(), new GCMParameterSpec(GCM_TAG_BITS, iv));
            cipher.updateAAD(aad(id));
            return cipher.doFinal(ciphertext);
        } catch (GeneralSecurityException e) {
            throw new IOException("Could not decrypt the session.");
        } catch (RuntimeException e) {
            throw new IOException("Could not decrypt the session.");
        }
    }

    /**
     * Removes this profile's session blob if present (an explicit sign-out / forget). A missing
     * blob is not an error. The shared keystore key is intentionally left in place for other
     * profiles. Call off the UI thread.
     */
    synchronized void delete(String id) throws IOException {
        requireValidId(id);
        File target = resolve(id, false);
        if (target == null) return;
        try {
            Files.deleteIfExists(target.toPath());
        } catch (IOException e) {
            throw new IOException("Could not remove the session.");
        }
    }
    /** Preserve an unreadable/incomplete journal while allowing a fresh sign-in. */
    synchronized void quarantineJournal() throws IOException {
        File source=resolve(SWITCH_JOURNAL_ID,false);
        if(source==null||!source.exists())return;
        File destination=new File(baseDir,"failed-switch-"+java.util.UUID.randomUUID()+".bin");
        Files.move(source.toPath(),destination.toPath(),StandardCopyOption.ATOMIC_MOVE);
    }

    // ---- internals -------------------------------------------------------------------------------

    private static void requireValidId(String id) {
        if (!isValidId(id)) throw new IllegalArgumentException("Invalid profile id.");
    }

    private static boolean isValidId(String id) {
        if (id == null) return false;
        return DEFAULT_ID.equals(id)
                || SWITCH_JOURNAL_ID.equals(id)
                || UUID_LOWER_RE.matcher(id).matches();
    }

    /** AAD binds the envelope version and profile id so blobs cannot be swapped between profiles. */
    private static byte[] aad(String id) {
        return ("pgrazor-account-sessions-v" + FORMAT_VERSION + ":" + id).getBytes(StandardCharsets.UTF_8);
    }

    private static byte[] wrap(byte[] iv, byte[] ciphertext) throws IOException {
        if (ciphertext.length > MAX_CIPHERTEXT) throw new IOException("Ciphertext exceeds the size bound.");
        ByteBuffer buf = ByteBuffer.allocate(HEADER_BYTES + ciphertext.length);
        buf.put(MAGIC);
        buf.put(FORMAT_VERSION);
        buf.put((byte) iv.length);
        buf.put(iv);
        buf.putInt(ciphertext.length);
        buf.put(ciphertext);
        return buf.array();
    }

    /**
     * Resolves a profile's blob file inside {@link #baseDir}, defending against traversal and
     * symlink escape by requiring the canonical path to sit directly under the canonical store root.
     * When {@code create} is set the store directory is created; otherwise a missing directory
     * yields {@code null} (treated as "no blob") by the callers.
     */
    private File resolve(String id, boolean create) throws IOException {
        if (!baseDir.getCanonicalFile().equals(baseDir.getAbsoluteFile()))
            throw new IOException("Unsafe session store path.");
        if (create) {
            if (!baseDir.isDirectory() && !baseDir.mkdirs())
                throw new IOException("Could not create the session store.");
        } else if (!baseDir.exists()) {
            return null;
        }
        if (!baseDir.isDirectory()) throw new IOException("Session store is not a directory.");
        String root = baseDir.getCanonicalPath();
        File target = new File(baseDir, id + FILE_SUFFIX);
        String canonical = target.getCanonicalPath();
        if (!target.getAbsolutePath().equals(canonical)) throw new IOException("Unsafe session file path.");
        // Must live directly under the store root (no traversal, no symlinked parent/child).
        if (!canonical.startsWith(root + File.separator))
            throw new IOException("Resolved path escapes the session store.");
        if (!target.getParentFile().getCanonicalPath().equals(root))
            throw new IOException("Resolved path escapes the session store.");
        return target;
    }

    private void writeAtomic(File target, byte[] bytes) throws IOException {
        Path dir = baseDir.toPath();
        Path temp = Files.createTempFile(dir, "session", ".tmp");
        boolean moved = false;
        try {
            try (FileChannel channel = FileChannel.open(temp,
                    StandardOpenOption.WRITE, StandardOpenOption.TRUNCATE_EXISTING)) {
                ByteBuffer data = ByteBuffer.wrap(bytes);
                while (data.hasRemaining()) channel.write(data);
                channel.force(true);
            }
            try {
                Files.move(temp, target.toPath(),
                        StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException noAtomic) {
                // No non-atomic fallback: a torn replace could leave a half-written session.
                throw new IOException("Atomic session save is unavailable.");
            }
            moved = true;
        } finally {
            if (!moved) Files.deleteIfExists(temp);
        }
    }

    /** Loads the existing key for decryption; never creates one. */
    private SecretKey loadKeyForRead() throws GeneralSecurityException, IOException {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
        keyStore.load(null);
        KeyStore.Entry entry = keyStore.getEntry(KEY_ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        throw new IOException("Session key is unavailable.");
    }

    /** Loads the stable key, creating it only when absent. Used by {@link #save} exclusively. */
    private SecretKey loadOrCreateKey() throws GeneralSecurityException, IOException {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            KeyStore.Entry entry = keyStore.getEntry(KEY_ALIAS, null);
            if (entry instanceof KeyStore.SecretKeyEntry) return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
            // Alias exists but is the wrong kind of entry: refuse rather than clobber it.
            throw new IOException("Session key is unusable.");
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return generator.generateKey();
    }
}
