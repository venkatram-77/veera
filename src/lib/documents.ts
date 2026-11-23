import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { config } from "./config";

type BlockType = "heading" | "paragraph" | "bullet";
type Block = { type: BlockType; text: string; level?: number };
type Slide = { title: string; bullets: string[] };

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function cleanText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
}

function escapeXml(value: string): string {
  return cleanText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function inlineText(value: string): string {
  return cleanText(
    value
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/(^|\s)\*([^*]+)\*/g, "$1$2")
      .replace(/~~([^~]+)~~/g, "$1"),
  );
}

function parseMarkdown(markdown: string): Block[] {
  const blocks: Block[] = [];
  for (const rawLine of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        text: inlineText(heading[2]),
        level: Math.min(heading[1].length, 3),
      });
      continue;
    }
    const bullet = /^(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line);
    if (bullet) {
      blocks.push({ type: "bullet", text: inlineText(bullet[1]) });
      continue;
    }
    blocks.push({ type: "paragraph", text: inlineText(line) });
  }
  return blocks;
}

function buildSlides(title: string, content: string, supplied: unknown): Slide[] {
  if (Array.isArray(supplied) && supplied.length) {
    return supplied.slice(0, 60).map((item) => {
      const slide = item as Record<string, unknown>;
      const bullets = Array.isArray(slide.bullets)
        ? slide.bullets.map((bullet) => inlineText(String(bullet))).filter(Boolean)
        : [];
      return { title: inlineText(String(slide.title ?? "Slide")) || "Slide", bullets };
    });
  }

  const blocks = parseMarkdown(content);
  const slides: Slide[] = [];
  let current: Slide | null = null;
  for (const block of blocks) {
    if (block.type === "heading" && (block.level ?? 1) <= 2) {
      if (current) slides.push(current);
      current = { title: block.text || title, bullets: [] };
    } else {
      if (!current) current = { title, bullets: [] };
      current.bullets.push(block.text);
    }
  }
  if (current) slides.push(current);
  if (!slides.length) slides.push({ title, bullets: [] });
  return slides.slice(0, 60);
}

function safeFileName(name: string, fallback = "document"): string {
  const base = cleanText(name)
    .replace(/[^a-zA-Z0-9 _.-]/g, "-")
    .replace(/\s+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 60);
  return base || fallback;
}

async function buildDocx(title: string, blocks: Block[]): Promise<Buffer> {
  const paragraph = (style: string, text: string, bullet = false) => {
    const prefix = bullet ? "• " : "";
    return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(
      prefix + text,
    )}</w:t></w:r></w:p>`;
  };

  const body = [
    paragraph("Title", title),
    ...blocks.map((block) => {
      if (block.type === "heading") {
        return paragraph(block.level === 1 ? "Heading1" : "Heading2", block.text);
      }
      return paragraph("Normal", block.text, block.type === "bullet");
    }),
  ].join("");

  const documentXml = `${XML_DECL}
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body>
</w:document>`;

  const stylesXml = `${XML_DECL}
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="36"/><w:color w:val="1F2937"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="30"/><w:color w:val="312E81"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="4338CA"/></w:rPr></w:style>
</w:styles>`;

  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `${XML_DECL}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`,
  );
  zip.folder("_rels")?.file(
    ".rels",
    `${XML_DECL}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  const word = zip.folder("word");
  word?.file("document.xml", documentXml);
  word?.file("styles.xml", stylesXml);
  word?.folder("_rels")?.file(
    "document.xml.rels",
    `${XML_DECL}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main";

const groupShape = `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`;

const themeXml = `${XML_DECL}
<a:theme xmlns:a="${A_NS}" name="Veera">
  <a:themeElements>
    <a:clrScheme name="Veera">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1F2937"/></a:dk2>
      <a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
      <a:accent1><a:srgbClr val="4F46E5"/></a:accent1>
      <a:accent2><a:srgbClr val="9333EA"/></a:accent2>
      <a:accent3><a:srgbClr val="0EA5E9"/></a:accent3>
      <a:accent4><a:srgbClr val="10B981"/></a:accent4>
      <a:accent5><a:srgbClr val="F59E0B"/></a:accent5>
      <a:accent6><a:srgbClr val="EF4444"/></a:accent6>
      <a:hlink><a:srgbClr val="0563C1"/></a:hlink>
      <a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Veera">
      <a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Veera">
      <a:fillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"><a:lumMod val="80000"/></a:schemeClr></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"><a:lumMod val="60000"/></a:schemeClr></a:solidFill>
      </a:fillStyleLst>
      <a:lnStyleLst>
        <a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
        <a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
        <a:ln w="28575" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
      </a:lnStyleLst>
      <a:effectStyleLst>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
      </a:effectStyleLst>
      <a:bgFillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>`;

function slideTextBox(
  id: number,
  name: string,
  x: number,
  y: number,
  cx: number,
  cy: number,
  lines: Array<{ text: string; size: number; bold: boolean; bullet: boolean }>,
): string {
  const paragraphs = lines
    .map((line) => {
      const pPr = line.bullet
        ? `<a:pPr marL="285750" indent="-285750"><a:buChar char="•"/></a:pPr>`
        : `<a:pPr algn="l"/>`;
      return `<a:p>${pPr}<a:r><a:rPr lang="en-US" sz="${line.size}" b="${line.bold ? 1 : 0}" dirty="0"><a:solidFill><a:srgbClr val="${
        line.bold ? "1F2937" : "374151"
      }"/></a:solidFill><a:latin typeface="Aptos"/></a:rPr><a:t>${escapeXml(line.text)}</a:t></a:r></a:p>`;
    })
    .join("");
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escapeXml(
    name,
  )}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="t"/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}

async function buildPptx(slides: Slide[]): Promise<Buffer> {
  const slideXml = (slide: Slide) => {
    const bodyLines = slide.bullets.slice(0, 14).map((bullet) => ({
      text: bullet.length > 180 ? `${bullet.slice(0, 177)}...` : bullet,
      size: 1800,
      bold: false,
      bullet: true,
    }));
    return `${XML_DECL}
<p:sld xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}">
  <p:cSld><p:spTree>${groupShape}${slideTextBox(
    2,
    "Title",
    685800,
    457200,
    7772400,
    1143000,
    [{ text: slide.title, size: 3200, bold: true, bullet: false }],
  )}${
    bodyLines.length
      ? slideTextBox(3, "Content", 685800, 1600200, 7772400, 4572000, bodyLines)
      : ""
  }</p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
  };

  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `${XML_DECL}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  ${slides
    .map(
      (_, index) =>
        `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    )
    .join("\n  ")}
</Types>`,
  );
  zip.folder("_rels")?.file(
    ".rels",
    `${XML_DECL}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`,
  );

  const ppt = zip.folder("ppt");
  ppt?.file(
    "presentation.xml",
    `${XML_DECL}
<p:presentation xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>${slides
    .map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`)
    .join("")}</p:sldIdLst>
  <p:sldSz cx="9144000" cy="6858000" type="screen4x3"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`,
  );
  ppt?.folder("_rels")?.file(
    "presentation.xml.rels",
    `${XML_DECL}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  ${slides
    .map(
      (_, index) =>
        `<Relationship Id="rId${index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`,
    )
    .join("\n  ")}
</Relationships>`,
  );

  const master = ppt?.folder("slideMasters");
  master?.file(
    "slideMaster1.xml",
    `${XML_DECL}
<p:sldMaster xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}">
  <p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${groupShape}</p:spTree></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
  <p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles>
</p:sldMaster>`,
  );
  master?.folder("_rels")?.file(
    "slideMaster1.xml.rels",
    `${XML_DECL}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`,
  );

  const layout = ppt?.folder("slideLayouts");
  layout?.file(
    "slideLayout1.xml",
    `${XML_DECL}
<p:sldLayout xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}" type="blank" preserve="1">
  <p:cSld name="Blank"><p:spTree>${groupShape}</p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`,
  );
  layout?.folder("_rels")?.file(
    "slideLayout1.xml.rels",
    `${XML_DECL}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`,
  );

  ppt?.folder("theme")?.file("theme1.xml", themeXml);

  const slideFolder = ppt?.folder("slides");
  slides.forEach((slide, index) => {
    const number = index + 1;
    slideFolder?.file(`slide${number}.xml`, slideXml(slide));
    slideFolder?.folder("_rels")?.file(
      `slide${number}.xml.rels`,
      `${XML_DECL}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`,
    );
  });

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function pdfEscape(value: string): string {
  return cleanText(value)
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (!line) {
      line = word;
    } else if ((line + " " + word).length <= maxChars) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function buildPdf(title: string, blocks: Block[]): Buffer {
  const pages: string[] = [];
  let stream = "";
  let y = 745;

  const newPage = () => {
    if (stream) pages.push(stream);
    stream = "";
    y = 745;
  };

  const writeLine = (text: string, size: number, font: "F1" | "F2") => {
    if (y < 55) newPage();
    stream += `BT /${font} ${size} Tf 56 ${y} Td (${pdfEscape(text)}) Tj ET\n`;
    y -= size + 6;
  };

  writeLine(title, 20, "F2");
  y -= 10;
  for (const block of blocks) {
    if (block.type === "heading") {
      y -= 8;
      writeLine(block.text, block.level === 1 ? 15 : 13, "F2");
      y -= 2;
    } else {
      const text = block.type === "bullet" ? `- ${block.text}` : block.text;
      for (const line of wrapText(text, 92)) writeLine(line, 11, "F1");
      y -= 3;
    }
  }
  pages.push(stream);

  const objects: string[] = new Array(5 + pages.length * 2).fill("");
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pages
    .map((_, index) => `${5 + index * 2} 0 R`)
    .join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  pages.forEach((pageStream, index) => {
    const pageId = 5 + index * 2;
    const contentId = pageId + 1;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(pageStream, "latin1")} >>\nstream\n${pageStream}endstream`;
  });

  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [];
  objects.slice(1).forEach((body, index) => {
    offsets[index + 1] = Buffer.byteLength(pdf, "latin1");
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

export async function createDocument(args: Record<string, unknown>): Promise<string> {
  const format = String(args.format ?? "docx").toLowerCase();
  if (!["docx", "pptx", "pdf"].includes(format)) {
    return "Unsupported format. Choose docx, pptx, or pdf.";
  }
  const title = inlineText(String(args.title ?? "Veera Document")) || "Veera Document";
  const content = String(args.content ?? "").slice(0, 100_000);
  const blocks = parseMarkdown(content);
  if (!blocks.length && !Array.isArray(args.slides)) {
    return "Please provide document content or slides.";
  }

  try {
    let bytes: Buffer;
    if (format === "docx") bytes = await buildDocx(title, blocks);
    else if (format === "pptx") bytes = await buildPptx(buildSlides(title, content, args.slides));
    else bytes = buildPdf(title, blocks);

    fs.mkdirSync(config.uploadDir, { recursive: true });
    const name = `${safeFileName(String(args.filename ?? title))}_${Date.now()}.${format}`;
    const target = path.join(config.uploadDir, name);
    fs.writeFileSync(target, bytes);
    const label = format.toUpperCase();
    return `Created ${label}: [${name}](/api/files/${name})\n\nSaved to \`${target}\``;
  } catch (error) {
    return `Document creation failed: ${error instanceof Error ? error.message : "unknown error"}`;
  }
}
