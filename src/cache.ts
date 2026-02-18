import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { getDb } from './database';
import logger from './logger';

const CACHE_DIR = path.resolve(__dirname, '..', 'run', '.cache');

export function generateCacheId(imageBuffer: Buffer, lowQuality: boolean): string {
    const hash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
    const suffix = lowQuality ? '_lq' : '';
    return `${hash}${suffix}`;
}

export function getCachedResult(cacheId: string): string | null {
    const db = getDb();
    const row = db.prepare('SELECT file_path FROM cache_entries WHERE id = ?').get(cacheId) as { file_path: string } | undefined;

    if (!row) return null;

    const absPath = path.resolve(CACHE_DIR, row.file_path);
    if (!fs.existsSync(absPath)) {
        // ファイルが消えていたらDBエントリも削除
        db.prepare('DELETE FROM cache_entries WHERE id = ?').run(cacheId);
        return null;
    }

    db.prepare('UPDATE cache_entries SET hit_count = hit_count + 1 WHERE id = ?').run(cacheId);
    logger.info(`[cache] HIT: ${cacheId}`);
    return absPath;
}

export function saveCacheResult(
    cacheId: string,
    imageHash: string,
    lowQuality: boolean,
    sourcePath: string
): string {
    const cacheDir = path.join(CACHE_DIR, cacheId);
    fs.mkdirSync(cacheDir, { recursive: true });

    const ext = '.gif';
    const destPath = path.join(cacheDir, `result${ext}`);
    fs.copyFileSync(sourcePath, destPath);

    const relativePath = path.join(cacheId, `result${ext}`);

    const db = getDb();
    db.prepare(`
        INSERT OR REPLACE INTO cache_entries (id, image_hash, low_quality, file_path, created_at, hit_count)
        VALUES (?, ?, ?, ?, ?, 0)
    `).run(cacheId, imageHash, lowQuality ? 1 : 0, relativePath, new Date().toISOString());

    logger.info(`[cache] SAVED: ${cacheId}`);
    return destPath;
}
