package dev.pgrazor;

/** Comma-separated decimal latitude/longitude, independent of device locale. */
final class CoordinateInput {
    private CoordinateInput() {}
    static double[] parse(String input) {
        String[] parts=(input==null?"":input.trim()).split(",",-1);
        if(parts.length!=2)throw new IllegalArgumentException("Enter latitude, longitude");
        double[] point=new double[2];
        for(int i=0;i<2;i++){
            String value=parts[i].trim();
            if(!value.matches("[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)"))
                throw new IllegalArgumentException("Enter numeric latitude, longitude");
            point[i]=Double.parseDouble(value);
        }
        if(!Double.isFinite(point[0])||Math.abs(point[0])>90)throw new IllegalArgumentException("Latitude must be between -90 and 90");
        if(!Double.isFinite(point[1])||Math.abs(point[1])>180)throw new IllegalArgumentException("Longitude must be between -180 and 180");
        return point;
    }
}
