import initSqlJs, { type SqlJsStatic } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

let p: Promise<SqlJsStatic> | null = null;
/** Loads the SQLite WASM once (served from the app bundle, no network needed after first load). */
export function getSql(): Promise<SqlJsStatic> {
  p ??= initSqlJs({ locateFile: () => wasmUrl });
  return p;
}
