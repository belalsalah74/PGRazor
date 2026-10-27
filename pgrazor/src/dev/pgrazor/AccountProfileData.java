package dev.pgrazor;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/** Removes only an inactive profile's PGRazor data, never game or shared feed credentials. */
final class AccountProfileData {
    private static final String[] FILES={"pgrazor-location-state-v1.txt","pgrazor-settings-v1.properties","cooldown-history.txt","pgrazor-gpx-routes-v1"};
    private static final String[] PREFS={"pgrazor-map","pgrazor-overlays","pgrazor-saved-places-v1","pgrazor-livefeed"};
    static void delete(AccountProfileStore store,File files,File sharedPrefs,String id) throws IOException {
        store.requireRemovable(id);
        File fileRoot=files.getCanonicalFile(),prefRoot=sharedPrefs.getCanonicalFile();
        List<Path> targets=new ArrayList<>();
        if(AccountProfileStore.DEFAULT_ID.equals(id)){
            for(String name:FILES)for(String suffix:new String[]{"",".bak",".new"})collect(fileRoot,new File(fileRoot,name+suffix),targets,0);
        }else{
            collect(fileRoot,new File(new File(new File(fileRoot,"pgrazor-accounts-v1"),"profiles"),id),targets,0);
        }
        for(String scope:PREFS)for(String suffix:new String[]{".xml",".xml.bak"}){
            collect(prefRoot,new File(prefRoot,store.preferenceName(id,scope)+suffix),targets,0);
        }
        // Validate the complete deletion set first; children precede their parent directories.
        for(Path path:targets)Files.deleteIfExists(path);
    }
    private static void collect(File root,File target,List<Path> out,int depth)throws IOException{
        if(depth>32)throw new IOException("Profile data is nested too deeply");
        File canonical=target.getCanonicalFile();
        if(!canonical.equals(target.getAbsoluteFile())||!canonical.toPath().startsWith(root.toPath())||canonical.equals(root))throw new IOException("Unsafe profile data path");
        if(!target.exists())return;
        if(target.isDirectory()){
            File[] children=target.listFiles();if(children==null)throw new IOException("Could not read profile data");
            for(File child:children)collect(root,child,out,depth+1);
        }
        out.add(target.toPath());
    }
}
