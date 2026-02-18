import ffmpeg from 'fluent-ffmpeg';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

export type OutputFormat = 'mp4' | 'gif';

function tempPath(ext: string): string {
    return path.join(os.tmpdir(), `compose-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
}

function renderMp4(backgroundPath: string, foregroundPath: string, outputPath: string, lowQuality: boolean = false): Promise<string> {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(backgroundPath, (err, metadata) => {
            if (err) return reject(new Error(`ffprobe error: ${err.message}`));

            const videoStream = metadata.streams.find(s => s.width && s.height);
            if (!videoStream) return reject(new Error('Failed to get stream info from image'));

            const bgWidth = videoStream.width!;
            const bgHeight = videoStream.height!;
            const outHeight = 360;
            const outWidth = Math.ceil((bgWidth / bgHeight) * outHeight / 2) * 2;

            ffmpeg()
                .input(backgroundPath)
                .input(foregroundPath)
                .complexFilter([
                    {
                        filter: 'scale',
                        options: { w: outWidth, h: outHeight, flags: 'lanczos' },
                        inputs: '0:v',
                        outputs: 'bg'
                    },
                    {
                        filter: 'colorkey',
                        options: { color: 'black', similarity: 0.01, blend: 0.5 },
                        inputs: '1:v',
                        outputs: 'ck'
                    },
                    {
                        filter: 'scale',
                        options: {
                            w: outWidth,
                            h: outHeight,
                            force_original_aspect_ratio: 'increase',
                            flags: 'lanczos'
                        },
                        inputs: 'ck',
                        outputs: 'scaled'
                    },
                    {
                        filter: 'overlay',
                        options: { x: '(W-w)/2', y: '(H-h)/2' },
                        inputs: ['bg', 'scaled']
                    }
                ])
                .outputOptions([
                    '-c:v libx264',
                    '-preset ultrafast',
                    '-crf ' + (lowQuality ? '43' : '35'),
                    '-pix_fmt yuv420p'
                ])
                .noAudio()
                .save(outputPath)
                .on('end', () => resolve(outputPath))
                .on('error', (e) => reject(new Error(`ffmpeg error: ${e.message}`)));
        });
    });
}

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

export async function compose(backgroundPath: string, foregroundPath: string, outputPath: string, format: OutputFormat = 'mp4', lowQuality: boolean = false): Promise<string> {
    if (format === 'mp4') {
        return renderMp4(backgroundPath, foregroundPath, outputPath, lowQuality);
    }

    const tmpMp4 = tempPath('.mp4');
    try {
        await renderMp4(backgroundPath, foregroundPath, tmpMp4, lowQuality);
        return await mp4ToGif(tmpMp4, outputPath);
    } finally {
        try { fs.unlinkSync(tmpMp4); } catch { }
    }
}
