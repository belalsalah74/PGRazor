package dev.pgrazor;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
public final class AccountSessionTransactionTest {
    static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    static final class MemoryVault implements AccountSessionTransaction.Vault {
        Map<String,byte[]> blobs=new HashMap<>();boolean failDelete;
        public byte[] read(String id){return blobs.get(id);}
        public void save(String id,byte[] value){blobs.put(id,value.clone());}
        public void delete(String id)throws IOException{if(failDelete)throw new IOException("simulated interruption");blobs.remove(id);}
    }
    static File prefs,secrets;
    static void login(String marker)throws Exception{
        Files.write(prefs.toPath(),("<map><string name=\""+AccountSessionTransaction.PROVIDER+"\">"+marker+"</string><int name=\"unrelated\" value=\"17\"/></map>").getBytes(StandardCharsets.UTF_8));
        secrets.mkdirs();for(String key:AccountSessionTransaction.SECRETS)Files.write(new File(secrets,Integer.toString(key.hashCode())).toPath(),("encrypted-fixture-"+marker).getBytes(StandardCharsets.UTF_8));
    }
    static String provider()throws Exception{return new String(Files.readAllBytes(prefs.toPath()),StandardCharsets.UTF_8);}
    public static void main(String[] args)throws Exception{
        File root=new File(args[0]),files=new File(root,"files"),shared=new File(root,"shared_prefs");files.mkdirs();shared.mkdirs();
        prefs=new File(shared,"example.game.v2.playerprefs.xml");secrets=new File(files,"nia-client-secrets-manager");
        AccountProfileStore index=new AccountProfileStore(files);index.observeIdentity("synthetic-A","A");String a=index.selected().id,b=index.add("B").id;
        MemoryVault vault=new MemoryVault();AccountSessionTransaction tx=new AccountSessionTransaction(files,shared,"example.game",vault);
        login("A");File unrelated=new File(secrets,"unrelated");Files.write(unrelated.toPath(),new byte[]{7});
        index.prepareSwitch(b);tx.switchPending();
        check(!provider().contains(AccountSessionTransaction.PROVIDER),"new profile starts signed out");check(provider().contains("unrelated"),"unrelated preference kept");
        check(unrelated.exists(),"unrelated secret kept");check(!new File(secrets,Integer.toString(AccountSessionTransaction.SECRETS[0].hashCode())).exists(),"old refresh credential removed from live store");
        index=new AccountProfileStore(files);check(index.selected().id.equals(b),"target selected");index.observeIdentity("synthetic-B","B");login("B");
        index.prepareSwitch(a);tx.switchPending();check(provider().contains(">A<"),"A restored without new login");
        login("A-rotated");index=new AccountProfileStore(files);index.prepareSwitch(b);tx.switchPending();check(provider().contains(">B<"),"B restored");
        index=new AccountProfileStore(files);index.prepareSwitch(a);vault.failDelete=true;
        try{tx.switchPending();throw new AssertionError("interruption expected");}catch(IOException expected){}
        check(vault.blobs.containsKey("switch-journal"),"interrupted completion retained journal");
        vault.failDelete=false;tx.recover();check(provider().contains(">A-rotated<"),"rotated session survives replay");check(!vault.blobs.containsKey("switch-journal"),"journal cleared");tx.switchPending();
        index=new AccountProfileStore(files);index.prepareSwitch(b);vault.blobs.put(b,new byte[]{1,2,3});
        String before=provider();try{tx.switchPending();throw new AssertionError("corrupt target accepted");}catch(IOException expected){}
        check(before.equals(provider()),"bad destination cannot mutate live login");check(new AccountProfileStore(files).selected().id.equals(a),"bad destination cannot select account");
        tx.cancel();check(new AccountProfileStore(files).pendingId().isEmpty(),"cancel before swap restores normal startup");
        // A completed file swap with an uncleared journal can also be rolled back.
        vault.blobs.remove(b);index=new AccountProfileStore(files);index.prepareSwitch(b);vault.failDelete=true;
        try{tx.switchPending();throw new AssertionError("interruption expected");}catch(IOException expected){}
        vault.failDelete=false;tx.cancel();check(provider().contains(">A-rotated<"),"explicit return restores outgoing session");check(new AccountProfileStore(files).selected().id.equals(a),"explicit return restores account selection");
        tx.resetForSignIn();check(!provider().contains(AccountSessionTransaction.PROVIDER),"recovery fallback cannot start mixed auth");check(provider().contains("unrelated"),"recovery fallback preserves unrelated settings");check(vault.blobs.containsKey(a),"recovery fallback preserves saved sessions");
        System.out.println("PASS: session roundtrip, new-account isolation, rotation, interrupted recovery, corrupt destination");
    }
}
