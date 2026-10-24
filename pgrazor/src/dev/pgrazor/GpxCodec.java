package dev.pgrazor;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Deque;
import java.util.List;
import java.util.Locale;
import javax.xml.XMLConstants;
import javax.xml.parsers.ParserConfigurationException;
import javax.xml.parsers.SAXParser;
import javax.xml.parsers.SAXParserFactory;
import org.xml.sax.Attributes;
import org.xml.sax.InputSource;
import org.xml.sax.SAXException;
import org.xml.sax.SAXParseException;
import org.xml.sax.XMLReader;
import org.xml.sax.helpers.DefaultHandler;
import org.xml.sax.ext.DefaultHandler2;
import java.math.BigDecimal;

/**
 * Reads and writes GPX route data with no Android dependencies, using the standard SAX parser
 * bundled with both the JDK and Android.
 *
 * <p>Reading is hardened against hostile input: DTDs and external entities are rejected, the input
 * is bounded to {@value #MAX_BYTES} bytes, each route is capped at {@link #MAX_POINTS} points, and
 * every coordinate must be finite and in range. Nothing is ever silently truncated &mdash; an input
 * that overflows any limit or carries an invalid coordinate is rejected with an {@link IOException}.
 *
 * <p>Point order is preserved as encountered. {@code wpt} / {@code rte} / {@code trk} are all
 * understood, namespaced or not. A file with multiple tracks or routes yields one {@link GpxRoute}
 * per track segment and per route, in document order; a track with several segments splits into
 * several routes. Top-level {@code wpt} elements are used only as a fallback when the file carries
 * no track or route, so a real route is always preferred over unrelated waypoints.
 */
public final class GpxCodec {
    /** Largest number of points accepted in a single route. */
    public static final int MAX_POINTS = 5000;
    /** Largest accepted input, in bytes. */
    public static final int MAX_BYTES = 2 * 1024 * 1024;

    private GpxCodec() {}

    /**
     * Parse GPX route data. Returns one {@link GpxRoute} per track segment and per route in document
     * order, falling back to a single route built from top-level waypoints when no track or route is
     * present. {@code fallbackName} names any route whose source element has no {@code <name>}.
     *
     * @throws IOException on I/O failure, oversized input, a DTD or external entity, malformed XML,
     *                     an invalid coordinate, or a route that exceeds {@link #MAX_POINTS} points.
     */
    public static List<GpxRoute> read(InputStream in, String fallbackName) throws IOException {
        if (in == null) throw new IOException("No GPX input was provided.");
        byte[] data = readBounded(in);
        // Primary defence is the parser configuration below; this guaranteed net covers parsers
        // (notably some Android builds) that quietly ignore the disallow-doctype feature.
        if (containsDoctype(data)) throw new IOException("GPX files with a DOCTYPE are not supported.");
        Handler handler = new Handler(fallbackName);
        try {
            SAXParserFactory factory = SAXParserFactory.newInstance();
            factory.setNamespaceAware(true);
            setFeature(factory, "http://apache.org/xml/features/disallow-doctype-decl", true);
            setFeature(factory, XMLConstants.FEATURE_SECURE_PROCESSING, true);
            setFeature(factory, "http://xml.org/sax/features/external-general-entities", false);
            setFeature(factory, "http://xml.org/sax/features/external-parameter-entities", false);
            setFeature(factory, "http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
            try { factory.setXIncludeAware(false); } catch (UnsupportedOperationException ignored) { }
            SAXParser parser = factory.newSAXParser();
            XMLReader reader = parser.getXMLReader();
            reader.setContentHandler(handler);
            reader.setProperty("http://xml.org/sax/properties/lexical-handler", handler);
            // Any external resource an attacker names resolves to nothing.
            reader.setEntityResolver((publicId, systemId) -> { throw new SAXException("External entities are not supported."); });
            reader.setErrorHandler(new DefaultHandler() {
                @Override public void error(SAXParseException e) throws SAXException { throw e; }
                @Override public void fatalError(SAXParseException e) throws SAXException { throw e; }
            });
            reader.parse(new InputSource(new ByteArrayInputStream(data)));
        } catch (ParserConfigurationException e) {
            throw new IOException("No XML parser is available.", e);
        } catch (SAXException e) {
            throw new IOException("This file is not valid GPX: " + message(e), e);
        }
        return handler.finish();
    }

    /**
     * Write {@code route} as a canonical GPX 1.1 document containing a single {@code <rte>} route
     * with an XML-escaped name. Coordinates are written with full round-trip precision.
     */
    public static void write(OutputStream out, GpxRoute route) throws IOException {
        if (out == null) throw new IOException("No GPX destination was provided.");
        if (route == null) throw new IOException("No route to write.");
        StringBuilder xml = new StringBuilder();
        xml.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        xml.append("<gpx version=\"1.1\" creator=\"PGRazor\" xmlns=\"http://www.topografix.com/GPX/1/1\">\n");
        xml.append("<rte><name>").append(escape(route.name)).append("</name>\n");
        for (double[] point : route.points())
            xml.append("<rtept lat=\"").append(coord(point[0])).append("\" lon=\"").append(coord(point[1])).append("\"></rtept>\n");
        xml.append("</rte>\n</gpx>\n");
        out.write(xml.toString().getBytes(StandardCharsets.UTF_8));
        out.flush();
    }

    private static byte[] readBounded(InputStream in) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        long total = 0;
        int n;
        while ((n = in.read(chunk)) != -1) {
            total += n;
            if (total > MAX_BYTES) throw new IOException("GPX files larger than 2 MB are not supported.");
            buffer.write(chunk, 0, n);
        }
        return buffer.toByteArray();
    }

    // ISO-8859-1 maps every byte to a char without throwing, so this scan never corrupts the search.
    private static boolean containsDoctype(byte[] data) {
        return new String(data, StandardCharsets.ISO_8859_1).replace("\u0000", "").toLowerCase(Locale.ROOT).contains("<!doctype");
    }

    private static void setFeature(SAXParserFactory factory, String feature, boolean value) {
        try { factory.setFeature(feature, value); } catch (ParserConfigurationException | SAXException ignored) { }
    }

    private static String message(SAXException e) {
        String text = e.getMessage();
        return text == null ? e.toString() : text;
    }

    private static String coord(double value) {
        // GPX coordinates are xsd:decimal, which excludes scientific notation.
        return BigDecimal.valueOf(value).toPlainString();
    }

    private static String escape(String text) {
        StringBuilder out = new StringBuilder(text.length());
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            switch (c) {
                case '&': out.append("&amp;"); break;
                case '<': out.append("&lt;"); break;
                case '>': out.append("&gt;"); break;
                case '"': out.append("&quot;"); break;
                case '\'': out.append("&apos;"); break;
                default: out.append(c);
            }
        }
        return out.toString();
    }

    /** Collects routes from a SAX event stream, preserving document order and enforcing limits. */
    private static final class Handler extends DefaultHandler2 {
        @Override public void startDTD(String name,String publicId,String systemId) throws SAXException {
            throw new SAXException("GPX files with a DOCTYPE are not supported.");
        }
        private final String fallback;
        private final List<GpxRoute> routes = new ArrayList<>();
        private final List<String[]> waypoints = new ArrayList<>();
        private final Deque<String> stack = new ArrayDeque<>();

        private List<List<double[]>> trackSegments;   // non-null while inside a <trk>
        private List<double[]> segment;               // non-null while inside a <trkseg>
        private List<double[]> routePoints;           // non-null while inside a <rte>
        private String trackName, routeName;

        private int captureName;                      // 0 none, 1 trk name, 2 rte name
        private StringBuilder nameText;

        Handler(String fallback) { this.fallback = fallback; }

        @Override public void startElement(String uri, String localName, String qName, Attributes attributes) throws SAXException {
            String element = local(localName, qName);
            String parent = stack.peek();
            if(stack.isEmpty() && !"gpx".equals(element))throw new SAXException("Expected a GPX document.");
            if(stack.size()>128)throw new SAXException("GPX nesting is too deep.");
            boolean knownNamespace=uri==null||uri.isEmpty()||uri.equals("http://www.topografix.com/GPX/1/1")||uri.equals("http://www.topografix.com/GPX/1/0");
            if(!knownNamespace || !(stack.isEmpty() ||
                ((element.equals("trk")||element.equals("rte")||element.equals("wpt"))&&"gpx".equals(parent)) ||
                (element.equals("trkseg")&&"trk".equals(parent)) ||
                (element.equals("trkpt")&&"trkseg".equals(parent)) ||
                (element.equals("rtept")&&"rte".equals(parent)) ||
                (element.equals("name")&&("trk".equals(parent)||"rte".equals(parent)))))element="#ignored";
            switch (element) {
                case "trk": trackName = null; trackSegments = new ArrayList<>(); break;
                case "trkseg": if (trackSegments != null) segment = new ArrayList<>(); break;
                case "rte": routeName = null; routePoints = new ArrayList<>(); break;
                case "trkpt": if (segment != null) add(segment, attributes); break;
                case "rtept": if (routePoints != null) add(routePoints, attributes); break;
                case "wpt": waypoints.add(raw(attributes)); break;
                case "name":
                    if ("trk".equals(parent)) { captureName = 1; nameText = new StringBuilder(); }
                    else if ("rte".equals(parent)) { captureName = 2; nameText = new StringBuilder(); }
                    break;
                default: break;
            }
            stack.push(element);
        }

        @Override public void characters(char[] chars, int start, int length) {
            if (captureName != 0 && nameText != null) nameText.append(chars, start, length);
        }

        @Override public void endElement(String uri, String localName, String qName) throws SAXException {
            String element = stack.peek();
            switch (element) {
                case "trkseg":
                    if (segment != null && !segment.isEmpty()) trackSegments.add(segment);
                    segment = null;
                    break;
                case "trk":
                    if (trackSegments != null) {
                        boolean split = trackSegments.size() > 1;
                        for (int i = 0; i < trackSegments.size(); i++) {
                            String name = resolveName(trackName);
                            if (split) name = clip(name + " (segment " + (i + 1) + ")");
                            routes.add(build(name, trackSegments.get(i)));
                        }
                    }
                    trackSegments = null;
                    break;
                case "rte":
                    if (routePoints != null && !routePoints.isEmpty()) routes.add(build(resolveName(routeName), routePoints));
                    routePoints = null;
                    break;
                case "name":
                    if (captureName == 1) trackName = nameText.toString();
                    else if (captureName == 2) routeName = nameText.toString();
                    captureName = 0;
                    nameText = null;
                    break;
                default: break;
            }
            stack.pop();
        }

        /** After the document ends, fall back to top-level waypoints only when no route was found. */
        List<GpxRoute> finish() throws IOException {
            if (routes.isEmpty() && !waypoints.isEmpty()) {
                if (waypoints.size() > MAX_POINTS) throw new IOException("This file has more than " + MAX_POINTS + " waypoints.");
                List<double[]> points = new ArrayList<>(waypoints.size());
                for (String[] raw : waypoints) points.add(coordinate(raw[0], raw[1]));
                routes.add(buildIo(resolveName(null), points));
            }
            return Collections.unmodifiableList(routes);
        }

        private void add(List<double[]> target, Attributes attributes) throws SAXException {
            target.add(toSaxCoordinate(attributes));
            if (target.size() > MAX_POINTS) throw new SAXException("A route may contain at most " + MAX_POINTS + " points.");
        }

        private double[] toSaxCoordinate(Attributes attributes) throws SAXException {
            try {
                return coordinate(attributes.getValue("lat"), attributes.getValue("lon"));
            } catch (IOException e) {
                throw new SAXException(e.getMessage());
            }
        }

        private String[] raw(Attributes attributes) {
            return new String[]{attributes.getValue("lat"), attributes.getValue("lon")};
        }

        private GpxRoute build(String name, List<double[]> points) throws SAXException {
            try {
                return buildIo(name, points);
            } catch (IOException e) {
                throw new SAXException(e.getMessage());
            }
        }

        private GpxRoute buildIo(String name, List<double[]> points) throws IOException {
            if (points.size() > MAX_POINTS) throw new IOException("A route may contain at most " + MAX_POINTS + " points.");
            try {
                return new GpxRoute(name, points.toArray(new double[0][]));
            } catch (IllegalArgumentException e) {
                throw new IOException(e.getMessage());
            }
        }

        private String resolveName(String candidate) {
            String name = candidate == null ? "" : candidate.trim();
            if (name.isEmpty()) {
                name = fallback == null ? "" : fallback.trim();
                if (name.isEmpty()) name = "Imported route";
            }
            return clip(sanitize(name));
        }

        private static String sanitize(String text) {
            StringBuilder out = new StringBuilder(text.length());
            for (int i = 0; i < text.length(); i++) {
                char c = text.charAt(i);
                out.append(Character.isISOControl(c) ? ' ' : c);
            }
            return out.toString().trim();
        }

        private static String clip(String text) {
            String trimmed = text.trim();
            if (trimmed.isEmpty()) trimmed = "Imported route";
            return trimmed.length() > GpxRoute.NAME_LIMIT ? trimmed.substring(0, GpxRoute.NAME_LIMIT).trim() : trimmed;
        }

        private static String local(String localName, String qName) {
            if (localName != null && !localName.isEmpty()) return localName;
            if (qName == null) return "";
            int colon = qName.indexOf(':');
            return colon >= 0 ? qName.substring(colon + 1) : qName;
        }
    }

    private static double[] coordinate(String latText, String lonText) throws IOException {
        if (latText == null || lonText == null) throw new IOException("A point is missing its latitude or longitude.");
        double lat, lon;
        try {
            lat = Double.parseDouble(latText.trim());
            lon = Double.parseDouble(lonText.trim());
        } catch (NumberFormatException e) {
            throw new IOException("A point has a non-numeric coordinate.");
        }
        if (!Double.isFinite(lat) || !Double.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
            throw new IOException("A point is outside the valid coordinate range.");
        return new double[]{lat, lon};
    }
}
