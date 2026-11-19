import { XMLParser } from 'fast-xml-parser';

export interface XNode { name: string; attrs: Record<string, string>; children: XNode[]; }

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  processEntities: true,
  ignoreDeclaration: true,
});

type Raw = Record<string, unknown>;

function conv(item: Raw): XNode | null {
  let name = '';
  for (const k of Object.keys(item)) if (k !== ':@' && k !== '#text') name = k;
  if (!name) return null;
  const attrs = (item[':@'] as Record<string, string> | undefined) ?? {};
  const kids = item[name] as Raw[];
  const children: XNode[] = [];
  for (const c of kids) { const n = conv(c); if (n) children.push(n); }
  return { name, attrs, children };
}

export function parseXml(text: string): XNode {
  const raw = parser.parse(text) as Raw[];
  for (const r of raw) { const n = conv(r); if (n) return n; }
  throw new Error('XML: empty document');
}

export const child = (n: XNode, name: string): XNode | undefined => n.children.find((c) => c.name === name);
export const kids = (n: XNode | undefined, name?: string): XNode[] =>
  n ? (name ? n.children.filter((c) => c.name === name) : n.children) : [];
export const attrNum = (n: XNode, k: string, d: number): number => {
  const v = n.attrs[k];
  if (v === undefined) return d;
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};
