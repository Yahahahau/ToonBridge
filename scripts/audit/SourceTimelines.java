// Prints the timelines of a binary FLA as JSON, straight from the binary records (via JPEXS fla-convert classes,
// LGPL-2.1, not bundled): for every page and layer, each keyframe's start (sum of the earlier durations; a zero-length
// frame takes no time), its stored duration, and whether it holds anything. Layers are listed top first, like XFL.
// Build: javac -cp <jpexs classes> SourceTimelines.java ; Run: java -cp <jpexs classes>:. SourceTimelines file.fla
import com.jpexs.flash.fla.reader.*;
import java.io.File;
import java.nio.charset.Charset;
import java.util.*;

public class SourceTimelines {
  static String q(String s) { return s == null ? "null" : "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\""; }
  static boolean content(FlaRecord f) {
    Object sd = f.get("shapeData");
    boolean edges = sd instanceof FlaRecord && ((FlaRecord) sd).get("edges") instanceof List && !((List<?>) ((FlaRecord) sd).get("edges")).isEmpty();
    return !f.getChildren().isEmpty() || edges;
  }
  public static void main(String[] a) throws Exception {
    BinaryFlaDocument doc = new BinaryFlaReader(Charset.forName("windows-1252")).read(new File(a[0]));
    StringBuilder out = new StringBuilder("[");
    boolean firstPage = true;
    for (BinaryFlaDocument.Page p : doc.getPages()) {
      List<FlaRecord> layers = new ArrayList<>();
      for (FlaRecord l : p.getRoot().getChildren()) if ("CPicLayer".equals(l.getClassName())) layers.add(l);
      Collections.reverse(layers);   // same order the XFL exporter writes
      out.append(firstPage ? "" : ",").append("\n{\"stream\":").append(q(p.getStream().getPath())).append(",\"role\":").append(q(p.getRole().toString())).append(",\"name\":").append(q(p.getName())).append(",\"layers\":[");
      firstPage = false;
      for (int li = 0; li < layers.size(); li++) {
        FlaRecord l = layers.get(li);
        out.append(li == 0 ? "" : ",").append("{\"name\":").append(q(String.valueOf(l.get("name")))).append(",\"frames\":[");
        long start = 0; boolean ff = true;
        for (FlaRecord f : l.getChildren()) {
          if (!"CPicFrame".equals(f.getClassName())) continue;
          Object d = f.get("duration");
          long dur = d instanceof Number ? ((Number) d).longValue() : 1;
          out.append(ff ? "" : ",").append("{\"start\":").append(start).append(",\"duration\":").append(dur).append(",\"content\":").append(content(f)).append("}");
          ff = false;
          start += Math.max(0, dur);
        }
        out.append("]}");
      }
      out.append("]}");
    }
    System.out.println(out.append("\n]"));
  }
}
