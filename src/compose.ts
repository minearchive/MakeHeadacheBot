import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import { tempPath, cleanup } from './utils';

export type OutputFormat = 'mp4' | 'gif';
export type InputType = 'image' | 'gif' | 'video';

interface RenderOptions {
    backgroundPath: string;
    foregroundPath: string;
    outputPath: string;
    lowQuality?: boolean;
    inputType?: InputType;
}

/** Probe background media to get dimensions */
function probe(filePath: string): Promise<ffmpeg.FfprobeData> {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) return reject(new Error(`ffprobe error: ${err.message}`));
            resolve(metadata);
        });
    });
}

/** Calculate output dimensions (360p height, even width preserving aspect ratio) */
function calcOutputSize(width: number, height: number): { w: number; h: number } {
    const h = 360;
    const w = Math.ceil((width / height) * h / 2) * 2;
    return { w, h };
}

/**
 * Build the FFmpeg filter chain for compositing.
 * - Static image: bg scale → fg colorkey+scale → overlay
 * - Animated (GIF/video): adds fps=15 to both streams, overlay uses shortest=1
 */
function buildFilterChain(outW: number, outH: number, animated: boolean): ffmpeg.FilterSpecification[] {
    const filters: ffmpeg.FilterSpecification[] = [];

    if (animated) {
        // FPS reduction for animated backgrounds
        filters.push(
            { filter: 'fps', options: { fps: 15 }, inputs: '0:v', outputs: 'bg_fps' },
            { filter: 'scale', options: { w: outW, h: outH, flags: 'lanczos' }, inputs: 'bg_fps', outputs: 'bg' },
            { filter: 'fps', options: { fps: 15 }, inputs: '1:v', outputs: 'fg_fps' },
            { filter: 'colorkey', options: { color: 'black', similarity: 0.01, blend: 0.5 }, inputs: 'fg_fps', outputs: 'ck' }
        );
    } else {
        filters.push(
            { filter: 'scale', options: { w: outW, h: outH, flags: 'lanczos' }, inputs: '0:v', outputs: 'bg' },
            { filter: 'colorkey', options: { color: 'black', similarity: 0.01, blend: 0.5 }, inputs: '1:v', outputs: 'ck' }
        );
    }

    // Shared: scale foreground + overlay
    filters.push(
        {
            filter: 'scale',
            options: { w: outW, h: outH, force_original_aspect_ratio: 'increase', flags: 'lanczos' },
            inputs: 'ck',
            outputs: 'scaled'
        },
        {
            filter: 'overlay',
            options: { x: '(W-w)/2', y: '(H-h)/2', ...(animated ? { shortest: 1 } : {}) },
            inputs: ['bg', 'scaled']
        }
    );

    return filters;
}

/** Core render: composites background + foreground → MP4 */
function renderToMp4(opts: RenderOptions): Promise<string> {
    const { backgroundPath, foregroundPath, outputPath, lowQuality = false, inputType = 'image' } = opts;
    const animated = inputType === 'gif' || inputType === 'video';

    return new Promise(async (resolve, reject) => {
        try {
            const metadata = await probe(backgroundPath);
            const videoStream = metadata.streams.find(s => s.width && s.height);
            if (!videoStream) return reject(new Error('Failed to get stream info from input'));

            const { w: outW, h: outH } = calcOutputSize(videoStream.width!, videoStream.height!);
            const duration = metadata.format.duration;

            const cmd = ffmpeg().input(backgroundPath);

            // Animated input options
            if (animated && !duration) {
                cmd.inputOptions(['-ignore_loop 0']);
            }

            cmd.input(foregroundPath);
            if (animated) {
                cmd.inputOptions(['-stream_loop -1']);
            }

            const outputOpts = [
                '-c:v libx264',
                '-preset ultrafast',
                `-crf ${lowQuality ? 43 : 35}`,
                '-pix_fmt yuv420p'
            ];

            // Duration cap for animated inputs (max 10 seconds)
            if (animated) {
                const maxDuration = Math.min(duration || 5, 10);
                outputOpts.push(`-t ${maxDuration}`);
            }

            cmd.complexFilter(buildFilterChain(outW, outH, animated))
                .outputOptions(outputOpts)
                .noAudio()
                .save(outputPath)
                .on('end', () => resolve(outputPath))
                .on('error', (e) => reject(new Error(`ffmpeg error: ${e.message}`)));
        } catch (e) {
            reject(e);
        }
    });
}

/** Convert MP4 to GIF with palette optimization */
function mp4ToGif(mp4Path: string, gifPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        ffmpeg()
            .input(mp4Path)
            .complexFilter([
                { filter: 'fps', options: { fps: 15 }, inputs: '0:v', outputs: 'f' },
                { filter: 'split', inputs: 'f', outputs: ['s0', 's1'] },
                { filter: 'palettegen', options: { max_colors: 64 }, inputs: 's0', outputs: 'p' },
                { filter: 'paletteuse', options: { dither: 'bayer', bayer_scale: 3 }, inputs: ['s1', 'p'] }
            ])
            .outputOptions(['-loop 0'])
            .noAudio()
            .save(gifPath)
            .on('end', () => resolve(gifPath))
            .on('error', (e) => reject(new Error(`ffmpeg gif error: ${e.message}`)));
    });
}

/** Convert GIF to MP4 */
export function gifToMp4(gifPath: string, mp4Path: string): Promise<string> {
    return new Promise((resolve, reject) => {
        ffmpeg()
            .input(gifPath)
            .outputOptions([
                '-c:v libx264',
                '-preset ultrafast',
                '-crf 35',
                '-pix_fmt yuv420p',
                '-movflags +faststart'
            ])
            .noAudio()
            .save(mp4Path)
            .on('end', () => resolve(mp4Path))
            .on('error', (e) => reject(new Error(`ffmpeg gif->mp4 error: ${e.message}`)));
    });
}

/** Main entry point: composite background + foreground, output as requested format */
export async function compose(
    backgroundPath: string,
    foregroundPath: string,
    outputPath: string,
    format: OutputFormat = 'mp4',
    lowQuality: boolean = false,
    inputType: InputType = 'image'
): Promise<string> {
    if (format === 'mp4') {
        return renderToMp4({ backgroundPath, foregroundPath, outputPath, lowQuality, inputType });
    }

    // GIF output: render to temp MP4 first, then convert
    const tmpMp4 = tempPath('compose', '.mp4');
    try {
        await renderToMp4({ backgroundPath, foregroundPath, outputPath: tmpMp4, lowQuality, inputType });
        return await mp4ToGif(tmpMp4, outputPath);
    } finally {
        cleanup(tmpMp4);
    }
}
