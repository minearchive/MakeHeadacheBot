import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

/** Generate a unique temp file path */
export function tempPath(prefix: string, ext: string): string {
    return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
}

/** Silently delete files */
export function cleanup(...files: string[]): void {
    for (const file of files) {
        try { fs.unlinkSync(file); } catch { }
    }
}
