package dev.pgrazor;

import java.io.*;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.transform.*;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;
import org.w3c.dom.*;

/** Moves only the game's encrypted auth state, with the game process stopped. */
final class AccountSessionTransaction {
    interface Vault { byte[] read(String id) throws IOException; void save(String id,byte[] value) throws IOException; void delete(String id) throws IOException; }
    static final String PROVIDER="60b01025-c1ea-422c-9b0e-d70bf489de7f";
    static final String[] SECRETS={"niantic-refresh-token-key","niantic-token-key","niantic-token-clock-offset-key"};
    private static final String JOURNAL="switch-journal";
    private static final int LIMIT=1024*1024;
    private final File files,prefs;
    private final String[] preferenceFiles;
    private final Vault vault;
    AccountSessionTransaction(File files,File prefs,String packageName,Vault vault) throws IOException {
        this.files=files.getCanonicalFile();this.prefs=prefs.getCanonicalFile();this.vault=vault;
        if(!packageName.matches("[A-Za-z0-9_.]+"))throw new IOException("Invalid game package");
        preferenceFiles=new String[]{packageName+".v2.playerprefs.xml",packageName+".playerprefs.xml"};
    }
    void switchPending() throws IOException {
        recover();
        AccountProfileStore profiles=new AccountProfileStore(files);
        String from=profiles.selected().id,to=profiles.pendingId();
        if(to.isEmpty())return; // A recreated helper can retry a completed transaction.
        if(from.equals(to)||!profiles.selected().bound())throw new IOException("No verified account switch pending");
        profiles.get(to);
        byte[] before=capture(),after=vault.read(to);
        if(after==null)after=empty();
        decode(after); // Validate destination before changing live auth files.
        vault.save(from,before);
        ByteArrayOutputStream buffer=new ByteArrayOutputStream();
        try(DataOutputStream out=new DataOutputStream(buffer)){out.writeInt(1);out.writeUTF(from);out.writeUTF(to);writeBytes(out,after);}
        vault.save(JOURNAL,buffer.toByteArray());
        recover();
    }
    /** Replays interrupted writes before Unity or its preference cache can start. */
    void recover() throws IOException {
        byte[] journal=vault.read(JOURNAL);if(journal==null)return;
        String from,to;byte[] after;int version;
        try(DataInputStream in=new DataInputStream(new ByteArrayInputStream(journal))){
            version=in.readInt();if(version!=1&&version!=2)throw new IOException("Unknown account switch journal");
            from=in.readUTF();to=in.readUTF();after=readBytes(in);if(in.available()!=0)throw new IOException("Invalid switch journal");
        }
        AccountProfileStore profiles=new AccountProfileStore(files);profiles.get(from);profiles.get(to);
        if(!profiles.selected().id.equals(from)&&!profiles.selected().id.equals(to))throw new IOException("Switch journal account mismatch");
        if(version==1&&profiles.selected().id.equals(from)&&!profiles.pendingId().equals(to))throw new IOException("Switch intent mismatch");
        apply(after);
        if(version==2)profiles.selectVerified(to);
        else if(!profiles.selected().id.equals(to))profiles.activatePending();
        vault.delete(JOURNAL);
    }
    /** Explicit helper recovery; outgoing snapshot was committed before the journal. */
    void cancel() throws IOException {
        byte[] journal=vault.read(JOURNAL);
        AccountProfileStore profiles=new AccountProfileStore(files);
        if(journal!=null){
            String from,to;int version;
            try(DataInputStream in=new DataInputStream(new ByteArrayInputStream(journal))){
                version=in.readInt();if(version!=1&&version!=2)throw new IOException("Unknown account switch journal");from=in.readUTF();to=in.readUTF();
            }
            if(version==2){recover();return;}
            profiles.get(from);byte[] before=vault.read(from);if(before==null)throw new IOException("Original session unavailable");
            ByteArrayOutputStream buffer=new ByteArrayOutputStream();
            try(DataOutputStream out=new DataOutputStream(buffer)){out.writeInt(2);out.writeUTF(to);out.writeUTF(from);writeBytes(out,before);}
            vault.save(JOURNAL,buffer.toByteArray());recover();return;
        }
        profiles.cancelPending();vault.delete(JOURNAL);
    }
    /** Recovery fallback: never start with a mixture of credentials from two profiles. */
    void resetForSignIn() throws IOException {
        apply(empty());new AccountProfileStore(files).cancelPending();
    }
    private byte[] empty() throws IOException {return encode(new byte[SECRETS.length][],new String[preferenceFiles.length]);}
    private byte[] capture() throws IOException {
        byte[][] secrets=new byte[SECRETS.length][];String[] values=new String[preferenceFiles.length];
        for(int i=0;i<secrets.length;i++){File f=secretFile(i);if(f.exists())secrets[i]=readFile(f);}
        boolean found=false;
        for(int i=0;i<values.length;i++){
            File f=preferenceInput(i);if(!f.exists())continue;
            Document doc=parse(readFile(f));NodeList list=doc.getDocumentElement().getChildNodes();
            for(int n=0;n<list.getLength();n++)if(list.item(n) instanceof Element){Element e=(Element)list.item(n);
                if(PROVIDER.equals(e.getAttribute("name"))){if(!"string".equals(e.getTagName()))throw new IOException("Unsupported login preference");values[i]=e.getTextContent();found=true;}
            }
        }
        if(!found||secrets[0]==null||secrets[0].length==0)throw new IOException("This login has no saved session yet");
        return encode(secrets,values);
    }
    private void apply(byte[] encoded) throws IOException {
        Snapshot snapshot=decode(encoded);
        // Parse every existing preferences file before mutating anything.
        Document[] documents=new Document[preferenceFiles.length];
        for(int i=0;i<documents.length;i++){
            File f=preferenceInput(i);documents[i]=parse(f.exists()?readFile(f):"<map/>".getBytes(StandardCharsets.UTF_8));
        }
        for(int i=0;i<SECRETS.length;i++){
            File f=secretFile(i);if(snapshot.secrets[i]==null)Files.deleteIfExists(f.toPath());else atomic(f,snapshot.secrets[i]);
        }
        for(int i=0;i<documents.length;i++){
            Document doc=documents[i];Element root=doc.getDocumentElement();NodeList children=root.getChildNodes();
            for(int n=children.getLength()-1;n>=0;n--){Node node=children.item(n);if(node instanceof Element&&PROVIDER.equals(((Element)node).getAttribute("name")))root.removeChild(node);}
            if(snapshot.values[i]!=null){Element item=doc.createElement("string");item.setAttribute("name",PROVIDER);item.appendChild(doc.createTextNode(snapshot.values[i]));root.appendChild(item);}
            File f=preferenceFile(i);if(f.exists()||snapshot.values[i]!=null)atomic(f,xml(doc));
            // SharedPreferences may otherwise restore the stale provider from .bak.
            Files.deleteIfExists(checked(prefs,preferenceFiles[i]+".bak").toPath());
        }
    }
    private File preferenceFile(int i) throws IOException {return checked(prefs,preferenceFiles[i]);}
    private File preferenceInput(int i) throws IOException {File backup=checked(prefs,preferenceFiles[i]+".bak");return backup.exists()?backup:preferenceFile(i);}
    private File secretFile(int i) throws IOException {return checked(checked(files,"nia-client-secrets-manager"),Integer.toString(SECRETS[i].hashCode()));}
    private static File checked(File root,String name) throws IOException {
        File f=new File(root,name);if(!f.getCanonicalFile().equals(f.getAbsoluteFile()))throw new IOException("Unsafe session path");return f;
    }
    private static byte[] readFile(File f) throws IOException {if(Files.size(f.toPath())>LIMIT)throw new IOException("Session file too large");byte[] bytes=Files.readAllBytes(f.toPath());if(bytes.length>LIMIT)throw new IOException("Session file too large");return bytes;}
    static void atomic(File file,byte[] bytes) throws IOException {
        File parent=file.getParentFile();if(!parent.isDirectory()&&!parent.mkdirs())throw new IOException("Cannot create session directory");
        Path tmp=Files.createTempFile(parent.toPath(),".session-",".tmp");
        try{try(FileChannel channel=FileChannel.open(tmp,StandardOpenOption.WRITE)){ByteBuffer b=ByteBuffer.wrap(bytes);while(b.hasRemaining())channel.write(b);channel.force(true);}
            Files.move(tmp,file.toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
        }finally{Files.deleteIfExists(tmp);}
    }
    private static Document parse(byte[] bytes) throws IOException {
        try{
            // Unity writes UTF-8 XML. Reject declarations/entities without relying on
            // desktop-only parser feature flags unavailable on some Android versions.
            String text=new String(bytes,StandardCharsets.UTF_8);
            if(text.indexOf('\0')>=0||text.contains("<!DOCTYPE")||text.contains("<!ENTITY"))throw new IOException("Unsupported preferences document");
            DocumentBuilderFactory factory=DocumentBuilderFactory.newInstance();factory.setExpandEntityReferences(false);
            javax.xml.parsers.DocumentBuilder builder=factory.newDocumentBuilder();builder.setEntityResolver((publicId,systemId)->{throw new org.xml.sax.SAXException("External entity blocked");});
            Document doc=builder.parse(new ByteArrayInputStream(bytes));if(!"map".equals(doc.getDocumentElement().getTagName()))throw new IOException("Invalid game preferences");return doc;
        }catch(Exception e){throw new IOException("Cannot read game login preferences");}
    }
    private static byte[] xml(Document doc) throws IOException {try{ByteArrayOutputStream out=new ByteArrayOutputStream();TransformerFactory.newInstance().newTransformer().transform(new DOMSource(doc),new StreamResult(out));return out.toByteArray();}catch(Exception e){throw new IOException("Cannot write game login preferences");}}
    private static byte[] encode(byte[][] secrets,String[] values) throws IOException {
        ByteArrayOutputStream buffer=new ByteArrayOutputStream();try(DataOutputStream out=new DataOutputStream(buffer)){out.writeInt(1);for(byte[] value:secrets)writeBytes(out,value);for(String value:values)writeBytes(out,value==null?null:value.getBytes(StandardCharsets.UTF_8));}return buffer.toByteArray();
    }
    private static Snapshot decode(byte[] bytes) throws IOException {
        if(bytes==null||bytes.length>LIMIT)throw new IOException("Invalid saved session");
        Snapshot s=new Snapshot();try(DataInputStream in=new DataInputStream(new ByteArrayInputStream(bytes))){if(in.readInt()!=1)throw new IOException("Unknown saved session");for(int i=0;i<s.secrets.length;i++)s.secrets[i]=readBytes(in);for(int i=0;i<s.values.length;i++){byte[] value=readBytes(in);s.values[i]=value==null?null:new String(value,StandardCharsets.UTF_8);}if(in.available()!=0)throw new IOException("Invalid saved session");}return s;
    }
    private static void writeBytes(DataOutputStream out,byte[] value) throws IOException {out.writeInt(value==null?-1:value.length);if(value!=null)out.write(value);}
    private static byte[] readBytes(DataInputStream in) throws IOException {int length=in.readInt();if(length==-1)return null;if(length<0||length>LIMIT||length>in.available())throw new IOException("Invalid saved session length");byte[] value=new byte[length];in.readFully(value);return value;}
    private static final class Snapshot {final byte[][] secrets=new byte[SECRETS.length][];final String[] values=new String[2];}
}
