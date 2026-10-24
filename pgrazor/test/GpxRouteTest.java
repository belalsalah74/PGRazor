import dev.pgrazor.GpxCodec;
import dev.pgrazor.GpxRoute;

/** Defensive validation and deep-copy guarantees of the plain GpxRoute value type. */
public final class GpxRouteTest {
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
    private static void rejects(String why, Runnable body) {
        try { body.run(); throw new AssertionError("Expected rejection: " + why); }
        catch (IllegalArgumentException expected) { }
    }

    public static void main(String[] args) {
        double[][] ok = {{41.3, 2.1}, {41.4, 2.2}};

        rejects("null name", () -> new GpxRoute(null, ok));
        rejects("blank name", () -> new GpxRoute("   ", ok));
        rejects("control character in name", () -> new GpxRoute("line\nbreak", ok));
        StringBuilder tooLong = new StringBuilder();
        for (int i = 0; i <= GpxRoute.NAME_LIMIT; i++) tooLong.append('x');
        rejects("over-long name", () -> new GpxRoute(tooLong.toString(), ok));

        rejects("null points", () -> new GpxRoute("Route", null));
        rejects("empty points", () -> new GpxRoute("Route", new double[0][]));
        rejects("null point row", () -> new GpxRoute("Route", new double[][]{null}));
        rejects("wrong point width", () -> new GpxRoute("Route", new double[][]{{1.0}}));
        rejects("NaN coordinate", () -> new GpxRoute("Route", new double[][]{{Double.NaN, 2.0}}));
        rejects("infinite coordinate", () -> new GpxRoute("Route", new double[][]{{1.0, Double.POSITIVE_INFINITY}}));
        rejects("latitude out of range", () -> new GpxRoute("Route", new double[][]{{91.0, 2.0}}));
        rejects("longitude out of range", () -> new GpxRoute("Route", new double[][]{{1.0, 181.0}}));
        double[][] tooMany = new double[GpxCodec.MAX_POINTS + 1][];
        for (int i = 0; i < tooMany.length; i++) tooMany[i] = new double[]{1.0, 2.0};
        rejects("over the point cap", () -> new GpxRoute("Route", tooMany));

        GpxRoute route = new GpxRoute("  Barcelona  ", ok);
        check(route.name.equals("Barcelona"), "Name is trimmed");
        check(route.size() == 2, "Size reflects the points");

        // Mutating the constructor argument after the fact must not change the route.
        ok[0][0] = 0.0;
        check(route.points()[0][0] == 41.3, "Constructor copies its input");
        // Mutating the returned array must not change the route either.
        double[][] returned = route.points();
        returned[1][1] = 0.0;
        check(route.points()[1][1] == 2.2, "points() returns a deep copy");

        System.out.println("PASS: GpxRoute validates defensively and copies its points");
    }
}
