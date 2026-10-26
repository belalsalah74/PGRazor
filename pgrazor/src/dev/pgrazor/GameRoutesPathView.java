package dev.pgrazor;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.View;

/**
 * A minimal, dependency-free preview of the active Route: the walked polyline with start and end
 * markers plus the current avatar position. Latitude/longitude are projected with a simple
 * equirectangular mapping (longitude compressed by cos(latitude)) and scaled to fit the view while
 * preserving aspect ratio. It is a local orientation aid, not a map, and claims no game progress.
 */
final class GameRoutesPathView extends View {
    private static final int START = 0xff3ec46d; // green
    private static final int END   = 0xffe2574f; // red

    private double[][] points;  // [lat,lon] polyline, already downsampled by the controller
    private double[] avatar;    // [lat,lon] or null

    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint line = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint marker = new Paint(Paint.ANTI_ALIAS_FLAG);

    GameRoutesPathView(Context c) {
        super(c);
        line.setStyle(Paint.Style.STROKE);
        line.setStrokeCap(Paint.Cap.ROUND);
        line.setStrokeJoin(Paint.Join.ROUND);
        line.setStrokeWidth(MapTheme.dp(c, 2.5f));
    }

    /** Both may be null; the view simply shows an empty card until there is geometry to draw. */
    void setData(double[][] polyline, double[] avatarPos) {
        this.points = polyline; this.avatar = avatarPos; invalidate();
    }

    @Override protected void onDraw(Canvas canvas) {
        Context c = getContext();
        int w = getWidth(), h = getHeight();
        float radius = MapTheme.dp(c, 10);
        fill.setColor(MapTheme.dark() ? 0xff10161f : 0xffeef3f7);
        canvas.drawRoundRect(new RectF(0, 0, w, h), radius, radius, fill);
        if (points == null || points.length < 2) return;

        float pad = MapTheme.dp(c, 16);
        // Compress longitude so the preview isn't stretched away from the equator.
        double meanLat = 0; for (double[] p : points) meanLat += p[0];
        meanLat /= points.length;
        double kx = Math.max(0.01, Math.cos(Math.toRadians(meanLat)));

        double minX = Double.MAX_VALUE, maxX = -Double.MAX_VALUE, minY = Double.MAX_VALUE, maxY = -Double.MAX_VALUE;
        for (double[] p : points) { double x = p[1] * kx, y = -p[0];
            minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
        if (avatar != null) { double x = avatar[1] * kx, y = -avatar[0];
            minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }

        double spanX = Math.max(1e-9, maxX - minX), spanY = Math.max(1e-9, maxY - minY);
        double scale = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY);
        float offX = (float) (pad + ((w - 2 * pad) - spanX * scale) / 2);
        float offY = (float) (pad + ((h - 2 * pad) - spanY * scale) / 2);

        android.graphics.Path path = new android.graphics.Path();
        for (int i = 0; i < points.length; i++) {
            float px = (float) (offX + (points[i][1] * kx - minX) * scale);
            float py = (float) (offY + (-points[i][0] - minY) * scale);
            if (i == 0) path.moveTo(px, py); else path.lineTo(px, py);
        }
        line.setColor(MapTheme.accent());
        canvas.drawPath(path, line);

        drawDot(canvas, offX, offY, minX, minY, scale, kx, points[0], START, MapTheme.dp(c, 5));
        drawDot(canvas, offX, offY, minX, minY, scale, kx, points[points.length - 1], END, MapTheme.dp(c, 5));
        if (avatar != null) {
            float ax = (float) (offX + (avatar[1] * kx - minX) * scale);
            float ay = (float) (offY + (-avatar[0] - minY) * scale);
            marker.setColor(MapTheme.ink());
            canvas.drawCircle(ax, ay, MapTheme.dp(c, 7), marker);
            marker.setColor(MapTheme.accent());
            canvas.drawCircle(ax, ay, MapTheme.dp(c, 4.5f), marker);
        }
    }

    private void drawDot(Canvas canvas, float offX, float offY, double minX, double minY,
                         double scale, double kx, double[] p, int color, float r) {
        marker.setColor(color);
        float x = (float) (offX + (p[1] * kx - minX) * scale);
        float y = (float) (offY + (-p[0] - minY) * scale);
        canvas.drawCircle(x, y, r, marker);
    }
}
