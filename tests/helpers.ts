import { createRequire } from 'node:module';
import initSqlJs, { type SqlJsStatic } from 'sql.js';

const require_ = createRequire(import.meta.url);
let cached: Promise<SqlJsStatic> | null = null;
export function nodeSql(): Promise<SqlJsStatic> {
  cached ??= initSqlJs({ locateFile: (f: string) => require_.resolve(`sql.js/dist/${f}`) });
  return cached;
}
