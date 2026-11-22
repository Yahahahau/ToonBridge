// Regression test for the ToonBridge JPEXS patch (zero-length frames keep the timing of later keyframes).
// Part of ToonBridge (not of JPEXS); it only USES the JPEXS classes at run time.
//
// Every case is a real binary FLA made by JPEXS itself: XFL fixture -> JPEXS model -> selected frames set to
// duration 0 -> binary CS4 FLA written by JPEXS -> read back with the binary reader -> exported to XFL -> checked.
//
// Build/run (after build.sh): javac -cp <classes> -d <out> ZeroDurationFramesTest.java
//                              java -cp <classes>:<out> ZeroDurationFramesTest [fixture output dir]
import com.jpexs.flash.fla.converter.BinaryFlaConverter;
import com.jpexs.flash.fla.converter.FlaFormatVersion;
import com.jpexs.flash.fla.converter.XflReader;
import com.jpexs.flash.fla.exporter.BinaryFlaToXflExporter;
import com.jpexs.flash.fla.exporter.XflExportResult;
import com.jpexs.flash.fla.exporter.XflFormatVersion;
import com.jpexs.flash.fla.reader.BinaryFlaDocument;
import com.jpexs.flash.fla.reader.BinaryFlaReader;
import com.jpexs.flash.fla.reader.FlaRecord;
import java.io.File;
import java.io.ByteArrayInputStream;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

public class ZeroDurationFramesTest {
    static final String NS = "xmlns=\"http://ns.adobe.com/xfl/2008/\"";
    static String box(String c) {
        return "<DOMShape><fills><FillStyle index=\"1\"><SolidColor color=\"" + c + "\"/></FillStyle></fills><edges><Edge fillStyle1=\"1\" edges=\"!0 0|2000 0|2000 2000|0 2000|0 0\"/></edges></DOMShape>";
    }
    /** One frame: "e" = empty keyframe, otherwise a box (content). */
    static String fr(int index, int duration, boolean content) {
        return "<DOMFrame index=\"" + index + "\" duration=\"" + duration + "\" keyMode=\"9728\"><elements>" + (content ? box("#FF0000") : "") + "</elements></DOMFrame>";
    }
    static String frInst(int index, int duration, String lib) {
        return "<DOMFrame index=\"" + index + "\" duration=\"" + duration + "\" keyMode=\"9728\"><elements><DOMSymbolInstance libraryItemName=\"" + lib + "\" symbolType=\"graphic\" loop=\"loop\"><matrix><Matrix tx=\"10\" ty=\"10\"/></matrix></DOMSymbolInstance></elements></DOMFrame>";
    }
    /** Layer of frames; spec like "1e 2 3" = durations, "e" = empty. Indices are contiguous. */
    static String layer(String name, String spec) {
        StringBuilder b = new StringBuilder("<DOMLayer name=\"" + name + "\"><frames>");
        int at = 0;
        for (String s : spec.trim().split("\\s+")) {
            boolean empty = s.endsWith("e");
            int d = Integer.parseInt(empty ? s.substring(0, s.length() - 1) : s);
            b.append(fr(at, d, !empty));
            at += d;
        }
        return b.append("</frames></DOMLayer>").toString();
    }

    interface Mutation { void apply(BinaryFlaDocument d); }
    static final class Case {
        final String name, sceneLayers; final Map<String, String> symbols = new LinkedHashMap<>(); final Mutation mutation;
        final Map<String, String> expect = new LinkedHashMap<>();      // "timeline/layer" -> "start+dur[e] ..."
        final List<String> expectIssues = new ArrayList<>();           // substrings that must appear in the report
        final boolean zero;                                           // has zero-length frames (upstream JPEXS is expected to fail)
        Case(String name, String sceneLayers, boolean zero, Mutation m) { this.name = name; this.sceneLayers = sceneLayers; this.zero = zero; this.mutation = m; }
    }

    /** Sets the duration of frame #frameIndex (0-based, record order) of `layer` on page `page` to 0. */
    static Mutation zero(String page, String layer, int... frameIndexes) {
        return d -> {
            for (BinaryFlaDocument.Page p : d.getPages()) {
                if (!page.equals(p.getName())) continue;
                for (FlaRecord l : p.getRoot().getChildren()) {
                    if (!"CPicLayer".equals(l.getClassName()) || !layer.equals(l.get("name"))) continue;
                    List<FlaRecord> frames = new ArrayList<>();
                    for (FlaRecord f : l.getChildren()) if ("CPicFrame".equals(f.getClassName())) frames.add(f);
                    for (int i : frameIndexes) frames.get(i).set("duration", 0);
                    return;
                }
            }
            throw new IllegalStateException("fixture page/layer not found: " + page + "/" + layer);
        };
    }
    static Mutation both(Mutation a, Mutation b) { return d -> { a.apply(d); b.apply(d); }; }

    static List<Case> cases() {
        List<Case> cs = new ArrayList<>();
        Case c;
        c = new Case("zero-length-first-frame", layer("L", "1e 2 3"), true, zero("Scene 1", "L", 0));
        c.expect.put("Scene 1/L", "0+2 2+3"); c.expectIssues.add("outcome=skipped; timeline=\"Scene 1\"; layer=\"L\"; frame=1; duration=0"); cs.add(c);
        c = new Case("normal-one-frame-first-keyframe", layer("L", "1e 2 3"), false, d -> { });
        c.expect.put("Scene 1/L", "0+1e 1+2 3+3"); cs.add(c);
        c = new Case("multiple-zero-duration-frames", layer("L", "1e 1e 2 1e 3"), true, zero("Scene 1", "L", 0, 1, 3));
        c.expect.put("Scene 1/L", "0+2 2+3"); cs.add(c);
        c = new Case("empty-keyframes-kept", layer("L", "2 3e 1"), false, d -> { });
        c.expect.put("Scene 1/L", "0+2 2+3e 5+1"); cs.add(c);
        c = new Case("held-frames", layer("L", "10"), false, d -> { });
        c.expect.put("Scene 1/L", "0+10"); cs.add(c);
        c = new Case("layers-with-different-starts", layer("A", "3 2") + layer("B", "1e 3 2") + layer("C", "1e 4"), true, zero("Scene 1", "B", 0));
        c.expect.put("Scene 1/A", "0+3 3+2"); c.expect.put("Scene 1/B", "0+3 3+2"); c.expect.put("Scene 1/C", "0+1e 1+4"); cs.add(c);
        c = new Case("nested-animated-symbols", "<DOMLayer name=\"S\"><frames>" + frInst(0, 6, "Outer") + "</frames></DOMLayer>", true,
                both(zero("Inner", "art", 0), zero("Outer", "holder", 0)));
        c.symbols.put("Inner", layer("art", "1e 2 2"));
        c.symbols.put("Outer", "<DOMLayer name=\"holder\"><frames>" + fr(0, 1, false) + frInst(1, 4, "Inner") + "</frames></DOMLayer>");
        c.expect.put("Inner/art", "0+2 2+2"); c.expect.put("Outer/holder", "0+4"); c.expect.put("Scene 1/S", "0+6"); cs.add(c);
        c = new Case("zero-length-frame-with-content-is-kept", layer("L", "1 2"), true, zero("Scene 1", "L", 0));
        c.expect.put("Scene 1/L", "0+1 1+2"); c.expectIssues.add("outcome=modified"); cs.add(c);
        c = new Case("only-frame-of-layer-is-zero-length", layer("A", "3") + layer("Z", "1e"), true, zero("Scene 1", "Z", 0));
        c.expect.put("Scene 1/A", "0+3"); c.expect.put("Scene 1/Z", "0+1e"); c.expectIssues.add("outcome=modified"); cs.add(c);
        return cs;
    }

    static String docXml(Case c) {
        StringBuilder inc = new StringBuilder();
        for (String s : c.symbols.keySet()) inc.append("<Include href=\"").append(s).append(".xml\"/>");
        return "<DOMDocument " + NS + " width=\"200\" height=\"200\" frameRate=\"24\" xflVersion=\"2.2\"><symbols>" + inc + "</symbols><timelines><DOMTimeline name=\"Scene 1\"><layers>"
                + c.sceneLayers + "</layers></DOMTimeline></timelines></DOMDocument>";
    }
    static String symXml(String name, String layers) {
        return "<DOMSymbolItem " + NS + " name=\"" + name + "\" symbolType=\"graphic\"><timeline><DOMTimeline name=\"" + name + "\"><layers>" + layers + "</layers></DOMTimeline></timeline></DOMSymbolItem>";
    }

    /** "timeline/layer" -> "start+dur[e] ..." read from the exported XFL. */
    static Map<String, String> timelines(XflExportResult r) throws Exception {
        Map<String, String> out = new LinkedHashMap<>();
        for (Map.Entry<String, ?> e : r.getFiles().entrySet()) {
            String k = e.getKey();
            if (!k.equals("DOMDocument.xml") && !(k.startsWith("LIBRARY/") && k.endsWith(".xml"))) continue;
            byte[] bytes = ((com.jpexs.flash.fla.reader.BinaryData) e.getValue()).toByteArray();
            DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
            f.setNamespaceAware(false);
            f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            Document d = f.newDocumentBuilder().parse(new ByteArrayInputStream(bytes));
            NodeList tls = d.getElementsByTagName("DOMTimeline");
            for (int i = 0; i < tls.getLength(); i++) {
                Element tl = (Element) tls.item(i);
                NodeList ls = tl.getElementsByTagName("DOMLayer");
                for (int j = 0; j < ls.getLength(); j++) {
                    Element l = (Element) ls.item(j);
                    StringBuilder b = new StringBuilder();
                    NodeList fs = l.getElementsByTagName("DOMFrame");
                    for (int m = 0; m < fs.getLength(); m++) {
                        Element fe = (Element) fs.item(m);
                        NodeList el = fe.getElementsByTagName("elements");
                        boolean empty = el.getLength() == 0 || ((Element) el.item(0)).getElementsByTagName("*").getLength() == 0;
                        b.append(m == 0 ? "" : " ").append(fe.getAttribute("index")).append('+').append(fe.getAttribute("duration")).append(empty ? "e" : "");
                    }
                    out.put(tl.getAttribute("name") + "/" + l.getAttribute("name"), b.toString());
                }
            }
        }
        return out;
    }

    public static void main(String[] args) throws Exception {
        Path fixtures = args.length > 0 ? Path.of(args[0]) : null;
        Path work = Files.createTempDirectory("tb-jpexs-zero");
        int failures = 0;
        for (Case c : cases()) {
            Path dir = work.resolve(c.name);
            Files.createDirectories(dir.resolve("LIBRARY"));
            Files.write(dir.resolve("DOMDocument.xml"), docXml(c).getBytes(StandardCharsets.UTF_8));
            for (Map.Entry<String, String> s : c.symbols.entrySet())
                Files.write(dir.resolve("LIBRARY/" + s.getKey() + ".xml"), symXml(s.getKey(), s.getValue()).getBytes(StandardCharsets.UTF_8));
            Files.write(dir.resolve(c.name + ".xfl"), "PROXY-CS5".getBytes(StandardCharsets.US_ASCII));
            // XFL -> JPEXS model -> zero-length frames -> binary CS4 FLA (written by JPEXS) -> binary reader -> XFL.
            BinaryFlaDocument model = new XflReader(StandardCharsets.UTF_8).read(dir.resolve(c.name + ".xfl").toFile());
            c.mutation.apply(model);
            File fla = work.resolve(c.name + ".fla").toFile();
            new BinaryFlaConverter(FlaFormatVersion.CS4, StandardCharsets.UTF_8).convert(model).writeToFile(fla);
            BinaryFlaDocument bin = new BinaryFlaReader(Charset.forName("windows-1252")).read(fla);
            XflExportResult out = new BinaryFlaToXflExporter(XflFormatVersion.CS6).export(bin);
            Map<String, String> got = timelines(out);
            String report = out.getReport();
            List<String> problems = new ArrayList<>();
            for (Map.Entry<String, String> e : c.expect.entrySet())
                if (!e.getValue().equals(got.get(e.getKey()))) problems.add(e.getKey() + ": expected " + e.getValue() + ", got " + got.get(e.getKey()));
            for (String s : c.expectIssues) if (!report.contains(s)) problems.add("report lacks: " + s);
            System.out.println((problems.isEmpty() ? "PASS " : "FAIL ") + c.name + (problems.isEmpty() ? "" : "\n    " + String.join("\n    ", problems)));
            if (!problems.isEmpty()) failures++;
            if (fixtures != null) {
                Files.createDirectories(fixtures);
                Files.copy(fla.toPath(), fixtures.resolve(c.name + ".fla"), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                out.writeToZip(fixtures.resolve(c.name + ".xfl.zip").toFile());
            }
        }
        System.out.println(failures == 0 ? "ALL PASS" : failures + " FAILED");
        System.exit(failures == 0 ? 0 : 1);
    }
}
