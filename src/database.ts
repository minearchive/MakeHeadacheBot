import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

const RUN_DIR = path.resolve(__dirname, '..', 'run');
const DB_PATH = path.join(RUN_DIR, 'cache.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
    if (!db) {
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
    }
    return db;
}

export function initDb(): void {
    fs.mkdirSync(RUN_DIR, { recursive: true });
    const conn = getDb();
    conn.exec(`
        CREATE TABLE IF NOT EXISTS cache_entries (
            id          TEXT PRIMARY KEY,
            image_hash  TEXT NOT NULL,
            low_quality INTEGER NOT NULL,
            file_path   TEXT NOT NULL,
            created_at  TEXT NOT NULL,
            hit_count   INTEGER DEFAULT 0
        )
    `);
}
