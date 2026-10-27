package dev.pgrazor;

import android.os.SystemClock;
import java.util.function.Consumer;
import java.util.function.DoubleSupplier;

/** Runtime-only state for the map-based Shiny Scanner. */
final class ShinyScannerController {
    static final long RESULT_TTL_MS = 10 * 60 * 1000L;
    static final double RESULT_FAR_METERS = 300;
    private final Object lock = new Object();
    private volatile String status = "Waiting for scanner support";
    private String encounterId = "";
    private int species, cp;
    private double latitude = Double.NaN, longitude = Double.NaN;
    private long foundAt;
    private final DoubleSupplier currentLatitude, currentLongitude;
    private final Consumer<String> event;

    ShinyScannerController(DoubleSupplier currentLatitude, DoubleSupplier currentLongitude, Consumer<String> event) {
        this.currentLatitude=currentLatitude; this.currentLongitude=currentLongitude; this.event=event;
    }
    void setStatus(String value) { status=value==null?"":value.substring(0,Math.min(value.length(),320)); }
    String status() { return status; }

    boolean found(String id,int species,int cp,double latitude,double longitude) {
        if(id==null||id.isEmpty()||id.length()>128||species<=0||species>100000||cp<0||cp>1000000
                ||!Double.isFinite(latitude)||!Double.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180) return false;
        synchronized(lock){encounterId=id;this.species=species;this.cp=cp;this.latitude=latitude;this.longitude=longitude;foundAt=SystemClock.elapsedRealtime();}
        event.accept("species="+species+" cp="+cp); return true;
    }
    void clearResult(){synchronized(lock){foundAt=0;encounterId="";species=0;cp=0;latitude=longitude=Double.NaN;}}

    /** Expired/out-of-range sightings are actively cleared and cannot reappear later. */
    boolean hasResult(){
        long seenAt;double lat,lon;
        synchronized(lock){seenAt=foundAt;lat=latitude;lon=longitude;}
        if(seenAt==0)return false;
        long age=SystemClock.elapsedRealtime()-seenAt;
        if(age<0||age>RESULT_TTL_MS){clearResult();return false;}
        double curLat=currentLatitude.getAsDouble(),curLon=currentLongitude.getAsDouble();
        if(!Double.isFinite(curLat)||!Double.isFinite(curLon)||!Double.isFinite(lat)||!Double.isFinite(lon)
                ||distanceMeters(curLat,curLon,lat,lon)>RESULT_FAR_METERS){clearResult();return false;}
        return true;
    }
    int species(){synchronized(lock){return species;}}
    int cp(){synchronized(lock){return cp;}}
    private static double distanceMeters(double lat1,double lon1,double lat2,double lon2){
        double r=6371000,dLat=Math.toRadians(lat2-lat1),dLon=Math.toRadians(lon2-lon1);
        double a=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(Math.toRadians(lat1))*Math.cos(Math.toRadians(lat2))*Math.sin(dLon/2)*Math.sin(dLon/2);
        return 2*r*Math.asin(Math.min(1,Math.sqrt(a)));
    }
}
