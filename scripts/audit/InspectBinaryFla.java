// Lists zero-length frames and unlinked pages in a binary FLA using JPEXS fla-convert classes (LGPL-2.1, not bundled).
// Build: javac -cp <jpexs classes> InspectBinaryFla.java ; Run: java -cp <jpexs classes>:. InspectBinaryFla file.fla
import com.jpexs.flash.fla.reader.*;
import java.io.File;
import java.nio.charset.Charset;
import java.util.*;
public class InspectBinaryFla {
  static void walk(FlaRecord r, Map<String,Integer> c, int depth){ if(depth>200) return; c.merge(r.getClassName(),1,Integer::sum); for(FlaRecord k: r.getChildren()) walk(k,c,depth+1); }
  static void layers(FlaRecord r, String page, int depth){
    if(depth>200) return;
    if("CPicLayer".equals(r.getClassName())){
      List<FlaRecord> fr=r.getChildren(); long start=0; int n=fr.size(); int i=0;
      for(FlaRecord f: fr){ if(!"CPicFrame".equals(f.getClassName())){i++;continue;}
        Object d=f.get("duration"); long dur=d instanceof Number?((Number)d).longValue():1;
        if(dur<=0){
          Map<String,Integer> c=new TreeMap<>(); for(FlaRecord k: f.getChildren()) walk(k,c,0);
          System.out.println("ZERO page="+page+" layer='"+r.get("name")+"' frameIdx="+i+"/"+n+" startFrame="+start+" lastInLayer="+(i==n-1)+" frameFields="+filter(f.getFields())+" contents="+c);
        }
        start+= Math.max(dur,0); i++;
      }
    }
    for(FlaRecord k: r.getChildren()) layers(k,page,depth+1);
  }
  static Map<String,Object> filter(Map<String,Object> m){ Map<String,Object> o=new TreeMap<>(); for(var e: m.entrySet()){ Object v=e.getValue(); if(v instanceof Number||v instanceof String||v instanceof Boolean) o.put(e.getKey(),v);} return o; }
  public static void main(String[] a) throws Exception {
    BinaryFlaDocument doc=new BinaryFlaReader(Charset.forName("windows-1252")).read(new File(a[0]));
    for(BinaryFlaDocument.Page p: doc.getPages()){
      String path=p.getStream().getPath();
      layers(p.getRoot(), path+"("+p.getRole()+" "+p.getName()+")", 0);
      if(p.getRole()==BinaryFlaDocument.Page.Role.UNLINKED){
        Map<String,Integer> c=new TreeMap<>(); walk(p.getRoot(),c,0);
        List<String> names=new ArrayList<>(); collectNames(p.getRoot(),names,0);
        System.out.println("UNLINKED "+path+" name="+p.getName()+" libId="+p.getLibraryId()+" classes="+c+" layerNames="+names+" rootFields="+filter(p.getRoot().getFields()));
      }
    }
    // which library ids are referenced by instances anywhere
    Set<Object> refs=new TreeSet<>(Comparator.comparing(Object::toString));
    for(BinaryFlaDocument.Page p: doc.getPages()) refsOf(p.getRoot(),refs,0);
    System.out.println("REFERENCED_LIBIDS "+refs.size());
    for(BinaryFlaDocument.Page p: doc.getPages()) if(p.getRole()==BinaryFlaDocument.Page.Role.UNLINKED) System.out.println("  unlinked "+p.getStream().getPath()+" referencedByStreamIdNumber? "+refs.contains(p.getStream().getPath()));
  }
  static void collectNames(FlaRecord r,List<String> o,int d){ if(d>200)return; if("CPicLayer".equals(r.getClassName())) o.add(String.valueOf(r.get("name"))); for(FlaRecord k:r.getChildren()) collectNames(k,o,d+1);}
  static void refsOf(FlaRecord r,Set<Object> s,int d){ if(d>200)return; for(String k: new String[]{"libraryItemName","symbolId","libraryId","symbolPath","className"}){Object v=r.get(k); if(v!=null && "CPicSymbol".equals(r.getClassName())) s.add(k+"="+v);} for(FlaRecord k:r.getChildren()) refsOf(k,s,d+1);}
}
