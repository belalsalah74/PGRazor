import android.content.Context;
import dev.pgrazor.GpxRoute;
import dev.pgrazor.GpxStore;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.util.List;

/**
 * Drives the app-private GPX store against a temp directory through a minimal Context shell.
 * The shell only supplies getApplicationContext()/getFilesDir(); no Android behaviour is simulated.
 */
public final class GpxStoreTest {
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    public static void main(String[] args) throws Exception {
        Context context = new Context(new File(args[0]));
        GpxStore store = new GpxStore(context);
        check(store.list().isEmpty(), "A fresh store lists nothing");

        GpxStore.Entry alpha = store.save(new GpxRoute("Alpha", new double[][]{{1, 1}, {2, 2}}));
        GpxStore.Entry bravo = store.save(new GpxRoute("Bravo", new double[][]{{3, 3}, {4, 4}, {5, 5}}));
        check(alpha.name.equals("Alpha") && alpha.count == 2, "Saved entry carries name and count");
        check(bravo.count == 3, "Second entry count");

        List<GpxStore.Entry> listed = store.list();
        check(listed.size() == 2, "Two routes listed");
        check(listed.get(0).name.equals("Alpha") && listed.get(1).name.equals("Bravo"), "Listing is sorted by name");

        GpxRoute loaded = store.load(alpha.id);
        check(loaded.name.equals("Alpha") && loaded.size() == 2, "Load preserves name and count");
        double[][] points = loaded.points();
        check(points[0][0] == 1.0 && points[1][0] == 2.0 && points[1][1] == 2.0, "Load preserves point order");

        // Name collisions (case-insensitive) are rejected rather than overwriting an existing route.
        try { store.save(new GpxRoute("alpha", new double[][]{{9, 9}})); throw new AssertionError("Collision was accepted"); }
        catch (IOException expected) { }
        check(store.list().size() == 2, "A rejected collision leaves the store unchanged");

        // Ids that could escape the store are rejected before touching the filesystem.
        for (String bad : new String[]{"../../etc/passwd", "..", "a/b", "....", "not-a-uuid", ""}) {
            try { store.load(bad); throw new AssertionError("Traversal id accepted: " + bad); }
            catch (IOException expected) { }
            try { store.delete(bad); throw new AssertionError("Traversal id accepted on delete: " + bad); }
            catch (IOException expected) { }
        }

        // Delete removes the route and is idempotent on a missing id.
        store.delete(alpha.id);
        check(store.list().size() == 1, "Delete removes the route");
        store.delete(alpha.id);
        try { store.load(alpha.id); throw new AssertionError("Loaded a deleted route"); }
        catch (FileNotFoundException expected) { }

        // The store is bounded: once full, further saves are rejected (count, not silent drop).
        int toFill = GpxStore.MAX_FILES - store.list().size();
        for (int i = 0; i < toFill; i++) store.save(new GpxRoute("Fill " + i, new double[][]{{0, 0}, {1, 1}}));
        check(store.list().size() == GpxStore.MAX_FILES, "Store fills exactly to the limit");
        try { store.save(new GpxRoute("Overflow", new double[][]{{0, 0}})); throw new AssertionError("Saved beyond the limit"); }
        catch (IOException expected) { }
        check(store.list().size() == GpxStore.MAX_FILES, "A rejected overflow leaves the store at the limit");

        System.out.println("PASS: GpxStore save/list/load/delete, collisions, traversal and bounded count");
    }
}
