package dev.pgrazor;

import android.content.Context;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * App-private storage for imported GPX routes, one canonical GPX file per route under the app's
 * internal files directory. Call these methods off the UI thread.
 *
 * <p>Files are named by a freshly generated UUID, so a route's on-disk name is never derived from
 * user text and cannot traverse out of the store. Saves are atomic (write to a temp file, then
 * rename), the store is bounded to {@value #MAX_FILES} routes, and a save whose name collides with
 * an existing route (case-insensitively) is rejected rather than overwriting it. Listing and loading
 * preserve the stored name and point order exactly.
 */
public final class GpxStore {
    /** Largest number of routes the store will hold. */
    public static final int MAX_FILES = 100;
    private static final Pattern ID = Pattern.compile("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");

    private static final Object LOCK=new Object();
    private final File directory;

    public GpxStore(Context context) {
        directory = new File(context.getApplicationContext().getFilesDir(), "pgrazor-gpx-routes-v1");
    }

    /** A stored route's identity and a small summary, without its point data. */
    public static final class Entry {
        public final String id, name;
        public final int count;
        Entry(String id, String name, int count) { this.id = id; this.name = name; this.count = count; }
    }

    /** Stored routes sorted by name (case-insensitive, then id). Unreadable files are skipped. */
    public List<Entry> list() throws IOException { synchronized(LOCK) {
        List<Entry> entries = new ArrayList<>();
        for (File file : files()) {
            String id = idOf(file);
            try (InputStream in = new FileInputStream(file)) {
                List<GpxRoute> routes = GpxCodec.read(in, id);
                if (!routes.isEmpty()) {
                    GpxRoute route = routes.get(0);
                    entries.add(new Entry(id, route.name, route.size()));
                }
            } catch (IOException ignored) {
                // A single damaged or foreign file must not break the whole listing.
            }
        }
        entries.sort(Comparator.comparing((Entry e) -> e.name.toLowerCase(Locale.ROOT)).thenComparing(e -> e.id));
        return Collections.unmodifiableList(entries);
    } }

    /** Save a route under a new id, rejecting a name that already exists or a full store. */
    public Entry save(GpxRoute route) throws IOException { synchronized(LOCK) {
        if (route == null) throw new IOException("No route to save.");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Could not create the route store.");
        File[] existing = files();
        if (existing.length >= MAX_FILES) throw new IOException("The route store is full (" + MAX_FILES + " routes). Delete one before saving another.");
        for (Entry entry : list())
            if (entry.name.equalsIgnoreCase(route.name)) throw new IOException("A route named “" + route.name + "” already exists. Choose another name.");
        String id;
        File target;
        do { id = UUID.randomUUID().toString(); target = new File(directory, id + ".gpx"); } while (target.exists());
        File temp = File.createTempFile("gpx", ".tmp", directory);
        try {
            try (FileOutputStream out = new FileOutputStream(temp)) {
                GpxCodec.write(out, route);
                out.getFD().sync();
            }
            if (!temp.renameTo(target)) throw new IOException("Could not save the route to device storage.");
            temp = null;
        } finally {
            if (temp != null) temp.delete();
        }
        return new Entry(id, route.name, route.size());
    } }

    /** Load a stored route by id, preserving its name and point order. */
    public GpxRoute load(String id) throws IOException { synchronized(LOCK) {
        File file = resolve(id);
        if (!file.isFile()) throw new FileNotFoundException("No stored route with that id.");
        try (InputStream in = new FileInputStream(file)) {
            List<GpxRoute> routes = GpxCodec.read(in, id);
            if (routes.isEmpty()) throw new IOException("The stored route is empty or damaged.");
            return routes.get(0);
        }
    } }

    /** Delete a stored route by id; a missing route is treated as already deleted. */
    public void delete(String id) throws IOException { synchronized(LOCK) {
        File file = resolve(id);
        if (file.exists() && !file.delete()) throw new IOException("Could not delete the route.");
    } }

    private File[] files() {
        File[] found = directory.listFiles((dir, name) -> name.endsWith(".gpx") && ID.matcher(name.substring(0, name.length() - 4)).matches());
        return found == null ? new File[0] : found;
    }

    private static String idOf(File file) {
        String name = file.getName();
        return name.substring(0, name.length() - 4);
    }

    private File resolve(String id) throws IOException {
        if (id == null || !ID.matcher(id).matches()) throw new IOException("Invalid route id.");
        File file = new File(directory, id + ".gpx");
        // Defence in depth: the resolved path must stay inside the store even if the id ever slipped through.
        if (!file.getCanonicalPath().startsWith(directory.getCanonicalPath() + File.separator))
            throw new IOException("Invalid route id.");
        return file;
    }
}
