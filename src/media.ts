import * as path from 'path';
import { InputType } from './compose';

/** Detect input type from MIME content-type string */
export function detectInputTypeFromContentType(contentType: string | null | undefined): InputType | null {
    if (!contentType) return null;
    const ct = contentType.split(';')[0].trim().toLowerCase();
    if (ct === 'image/gif') return 'gif';
    if (ct.startsWith('video/')) return 'video';
    if (ct.startsWith('image/')) return 'image';
    return null;
}

/** Detect input type from URL file extension */
export function detectInputTypeFromUrl(url: string): InputType | null {
    try {
        const pathname = new URL(url).pathname.toLowerCase();
        const ext = path.extname(pathname);
        switch (ext) {
            case '.gif': return 'gif';
            case '.mp4': case '.webm': case '.mov': case '.avi': case '.mkv': return 'video';
            case '.png': case '.jpg': case '.jpeg': case '.webp': case '.bmp': return 'image';
            default: return null;
        }
    } catch {
        return null;
    }
}

/** Detect input type — contentType takes priority, falls back to URL extension */
export function detectInputType(contentType: string | null | undefined, url?: string): InputType | null {
    return detectInputTypeFromContentType(contentType) ?? (url ? detectInputTypeFromUrl(url) : null);
}

/** Check if contentType is a supported media type */
export function isSupportedMedia(contentType: string | null | undefined): boolean {
    return detectInputTypeFromContentType(contentType) !== null;
}

/** Map InputType to a download file extension */
export function extensionForType(inputType: InputType): string {
    switch (inputType) {
        case 'gif': return '.gif';
        case 'video': return '.mp4';
        case 'image':
        default: return '.png';
    }
}

/** Extract first URL from text content */
export function extractUrlFromContent(content: string): string | null {
    const urlMatch = content.match(/https?:\/\/[^\s<>]+/i);
    return urlMatch ? urlMatch[0] : null;
}
