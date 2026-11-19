// Collects everything that was not converted 1:1. Nothing is dropped silently (rule 6).

export type Severity = 'loss' | 'approx' | 'warn' | 'info';
export interface DiagItem { severity: Severity; code: string; message: string; count: number; }

export class Diagnostics {
  private map = new Map<string, DiagItem>();
  add(severity: Severity, code: string, message: string, count = 1): void {
    const key = `${severity}|${code}|${message}`;
    const ex = this.map.get(key);
    if (ex) ex.count += count; else this.map.set(key, { severity, code, message, count });
  }
  loss(code: string, message: string, count = 1) { this.add('loss', code, message, count); }
  approx(code: string, message: string, count = 1) { this.add('approx', code, message, count); }
  warn(code: string, message: string, count = 1) { this.add('warn', code, message, count); }
  info(code: string, message: string, count = 1) { this.add('info', code, message, count); }
  items(): DiagItem[] {
    const order: Record<Severity, number> = { loss: 0, approx: 1, warn: 2, info: 3 };
    return [...this.map.values()].sort((a, b) =>
      order[a.severity] - order[b.severity] || a.code.localeCompare(b.code) || a.message.localeCompare(b.message));
  }
}
