import ffmpeg from 'fluent-ffmpeg';

const background = process.argv[2];
const foreground = process.argv[3];
const output = process.argv[4] || 'combine.mp4';

if (!background || !foreground) {
    console.error('Usage: npx ts-node src/a.ts <background> <foreground> [output]');
    process.exit(1);
}

ffmpeg.ffprobe(background, (err, metadata) => {
    if (err) {
        console.error('ffprobe error:', err.message);
        process.exit(1);
    }

    const videoStream = metadata.streams.find(s => s.width && s.height);
    if (!videoStream) {
        console.error('Error: failed to get stream info from image');
        process.exit(1);
    }

    const bgWidth = videoStream.width!;
    const bgHeight = videoStream.height!;

    ffmpeg()
        .input(background)
        .input(foreground)
        .complexFilter([
            {
                filter: 'colorkey',
                options: { color: 'black', similarity: 0.01, blend: 0.5 },
                inputs: '1:v',
                outputs: 'ck'
            },
            {
                filter: 'scale',
                options: {
                    w: bgWidth,
                    h: bgHeight,
                    force_original_aspect_ratio: 'increase'
                },
                inputs: 'ck',
                outputs: 'scaled'
            },
            {
                filter: 'overlay',
                options: { x: '(W-w)/2', y: '(H-h)/2' },
                inputs: ['0:v', 'scaled'],
                outputs: 'overlay_out'
            },
            {
                filter: 'pad',
                options: { w: 'ceil(iw/2)*2', h: 'ceil(ih/2)*2' },
                inputs: 'overlay_out'
            }
        ])
        .outputOptions([
            '-c:v libx264',
            '-preset medium',
            '-crf 18',
            '-pix_fmt yuv420p'
        ])
        .noAudio()
        .save(output)
        .on('end', () => console.log('Done!'))
        .on('error', (e) => console.error('Error:', e.message));
});
