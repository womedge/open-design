import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/db.js';

export interface TempDb {
  db: Database.Database;
  dir: string;
  cleanup(): void;
}

export function openTempDb(): TempDb {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-usage-'));
  const db = openDatabase(dir, { dataDir: dir });
  return {
    db,
    dir,
    cleanup() {
      closeDatabase();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const T = (iso: string) => Date.parse(iso);
