package dev.pgrazor;
import java.io.*;
import java.nio.file.*;
public final class AccountProfileDataTest {
    static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    static void put(File f)throws IOException{f.getParentFile().mkdirs();Files.write(f.toPath(),new byte[]{1,2,3});}
    public static void main(String[] args)throws Exception{
        File files=new File(args[0],"files"),prefs=new File(args[0],"shared_prefs");files.mkdirs();prefs.mkdirs();
        AccountProfileStore store=new AccountProfileStore(files);store.observeIdentity("A","A");String a=store.selected().id,b=store.add("B").id;
        File live=store.dataFile(a,"pgrazor-settings-v1.properties"),other=store.dataFile(b,"pgrazor-settings-v1.properties");put(live);put(other);
        try{AccountProfileData.delete(store,files,prefs,a);throw new AssertionError("active deletion accepted");}catch(IllegalStateException expected){}
        check(live.exists(),"active data untouched");
        store.prepareSwitch(b);try{store.remove(b);throw new AssertionError("pending target deleted");}catch(IllegalStateException expected){}
        store.cancelPending();
        File pref=new File(prefs,store.preferenceName(b,"pgrazor-overlays")+".xml");put(pref);put(new File(pref.getPath()+".bak"));
        File routes=new File(store.dataFile(b,"pgrazor-gpx-routes-v1"),"route.gpx");put(routes);
        AccountProfileData.delete(store,files,prefs,b);store.remove(b);
        check(!other.exists()&&!routes.exists()&&!pref.exists()&&!new File(pref.getPath()+".bak").exists(),"inactive files and preferences removed");
        check(live.exists()&&new AccountProfileStore(files).get(b)==null,"active profile preserved and deletion persisted");
        b=store.add("B").id;store.prepareSwitch(b);store.activatePending();store.observeIdentity("B","B");
        File current=store.dataFile(b,"pgrazor-settings-v1.properties");put(current);
        File shared=new File(files,"unrelated-game-file"),feed=new File(prefs,"pgrazor-livefeed-session.xml");put(shared);put(feed);
        File defaultPrefs=new File(prefs,"pgrazor-map.xml");put(defaultPrefs);
        File defaultRoutes=new File(new File(files,"pgrazor-gpx-routes-v1"),"route.gpx");put(defaultRoutes);
        AccountProfileData.delete(store,files,prefs,a);store.remove(a);
        AccountProfileStore reloaded=new AccountProfileStore(files);
        check(reloaded.get(a)==null&&reloaded.selected().id.equals(b),"original default can be deleted without reappearing");
        check(!live.exists()&&!defaultPrefs.exists()&&!defaultRoutes.exists(),"original profile data removed");
        check(current.exists()&&shared.exists()&&feed.exists(),"other account, game and shared feed files preserved");
        check(!reloaded.observeIdentity("A","A").id.equals(a),"readding deleted identity gets fresh namespace");
        System.out.println("PASS: inactive deletion, active/pending protection, default deletion, shared-data isolation");
    }
}
