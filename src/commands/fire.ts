import { ChatInputCommandInteraction, SlashCommandBuilder, AttachmentBuilder, Message } from 'discord.js';
import { Command } from '../command';
import { compose, OutputFormat, InputType, gifToMp4 } from '../compose';
import { generateCacheId, getCachedResult, saveCacheResult } from '../cache';
import { detectInputType, detectInputTypeFromUrl, isSupportedMedia, extensionForType, extractUrlFromContent } from '../media';
import { tempPath, cleanup } from '../utils';
import logger from '../logger';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import config from '../../config.json';

interface ProcessResult {
    filePath: string;
    cleanup: () => void;
}

interface DownloadResult {
    filePath: string;
    contentType: string | null;
}

interface MediaSource {
    url: string;
    inputType: InputType;
    warning?: string;
}

export class FireCommand implements Command {
    readonly data = new SlashCommandBuilder()
        .setName('fire')
        .setDescription('Compose fire effect on avatar')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Target user (defaults to self)')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('format')
                .setDescription('Output format (defaults to gif)')
                .addChoices(
                    { name: 'GIF', value: 'gif' },
                    { name: 'MP4', value: 'mp4' }
                )
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option.setName('low_quality')
                .setDescription('Extra low quality output')
                .setRequired(false)
        )
        .addAttachmentOption(option =>
            option.setName('image')
                .setDescription('Image/GIF/Video to use (defaults to avatar)')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('url')
                .setDescription('URL of image/GIF/video to use')
                .setRequired(false)
        ) as SlashCommandBuilder;

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply();

        const imageAttachment = interaction.options.getAttachment('image');
        const urlOption = interaction.options.getString('url');
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const format = (interaction.options.getString('format') || 'gif') as OutputFormat;
        const lowQuality = interaction.options.getBoolean('low_quality') ?? false;

        let mediaUrl: string;
        let inputType: InputType = 'image';

        if (imageAttachment) {
            const detected = detectInputType(imageAttachment.contentType, imageAttachment.url);
            if (!detected) {
                await interaction.editReply('❌ 対応していないファイル形式です。画像・GIF・動画を添付してください。');
                return;
            }
            mediaUrl = imageAttachment.url;
            inputType = detected;
        } else if (urlOption) {
            mediaUrl = urlOption;
            inputType = detectInputTypeFromUrl(urlOption) || 'image';
        } else {
            mediaUrl = targetUser.displayAvatarURL({ size: 1024, extension: 'png' });
        }

        try {
            const result = await this.processMedia(mediaUrl, format, lowQuality, inputType);
            try {
                await interaction.editReply({ files: [this.buildAttachment(result.filePath, format)] });
            } finally {
                result.cleanup();
            }
        } catch (err) {
            logger.error(`Error: ${err}`);
            const msg = err instanceof Error ? err.message : String(err);
            await interaction.editReply(`Error: ${msg}`).catch(() => { });
        }
    }

    async onMessage(message: Message): Promise<void> {
        const source = await this.resolveMediaSource(message);

        try {
            const result = await this.processMedia(source.url, 'gif', false, source.inputType);
            try {
                const attachment = this.buildAttachment(result.filePath, 'gif');
                await message.reply({ content: source.warning || undefined, files: [attachment] });
            } finally {
                result.cleanup();
            }
        } catch (err) {
            logger.error(`Error: ${err}`);
            const errMsg = err instanceof Error ? err.message : String(err);
            await message.reply(`Error: ${errMsg}`).catch(() => { });
        }
    }

    // ── Media source resolution ──

    /** Resolve media URL and input type from a message, checking attachments → text URLs → reply → avatar */
    private async resolveMediaSource(message: Message): Promise<MediaSource> {
        // 1. Message attachments
        const fromAttachments = this.extractFromAttachments(message);
        if (fromAttachments) return fromAttachments;

        // 2. URL in message text
        const urlFromContent = extractUrlFromContent(message.content);
        if (urlFromContent) {
            return { url: urlFromContent, inputType: detectInputTypeFromUrl(urlFromContent) || 'image' };
        }

        // 3. Reply target
        if (message.reference?.messageId) {
            const refMessage = await message.channel.messages.fetch(message.reference.messageId);
            const fromReply = await this.resolveFromReplyTarget(refMessage);
            if (fromReply) return fromReply;
        }

        // 4. Fallback: author avatar
        return { url: message.author.displayAvatarURL({ size: 1024, extension: 'png' }), inputType: 'image' };
    }

    /** Extract media from message attachments */
    private extractFromAttachments(message: Message): MediaSource | null {
        const media = message.attachments.filter(a => isSupportedMedia(a.contentType));
        if (media.size === 0) return null;

        const first = media.first()!;
        return {
            url: first.url,
            inputType: detectInputType(first.contentType, first.url) || 'image',
            warning: media.size > 1 ? '⚠️ 複数の添付ファイルがありますが、最初のメディアのみ使用します。\n' : undefined
        };
    }

    /** Extract media from a reply target message (attachments → text URL → embeds) */
    private async resolveFromReplyTarget(refMessage: Message): Promise<MediaSource | null> {
        // Reply attachments
        const fromAttachments = this.extractFromAttachments(refMessage);
        if (fromAttachments) {
            if (fromAttachments.warning) {
                fromAttachments.warning = '⚠️ リプライ先に複数のメディアがありますが、最初のメディアのみ使用します。\n';
            }
            return fromAttachments;
        }

        // Reply text URL
        const refUrl = extractUrlFromContent(refMessage.content);
        if (refUrl) {
            return { url: refUrl, inputType: detectInputTypeFromUrl(refUrl) || 'image' };
        }

        // Reply embeds
        for (const embed of refMessage.embeds) {
            if (embed.video?.url) {
                return { url: embed.video.url, inputType: 'video' };
            }
            if (embed.image?.url) {
                return { url: embed.image.url, inputType: detectInputTypeFromUrl(embed.image.url) || 'image' };
            }
            if (embed.thumbnail?.url) {
                return { url: embed.thumbnail.url, inputType: detectInputTypeFromUrl(embed.thumbnail.url) || 'image' };
            }
        }

        return null;
    }

    // ── Processing pipeline ──

    private async processMedia(
        mediaUrl: string,
        format: OutputFormat,
        lowQuality: boolean,
        inputType: InputType
    ): Promise<ProcessResult> {
        const fgPath = path.resolve(config.foregroundVideo);
        if (!fs.existsSync(fgPath)) {
            throw new Error('foreground video file not found');
        }

        // Download media and confirm input type from HTTP content-type
        const { path: mediaPath, inputType: confirmedType } = await this.downloadMedia(mediaUrl, inputType);

        try {
            // Animated inputs (GIF/video): render directly, no cache
            if (confirmedType !== 'image') {
                return await this.renderDirect(mediaPath, fgPath, format, lowQuality, confirmedType);
            }

            // Static images: use cache
            return await this.renderWithCache(mediaPath, fgPath, format, lowQuality, confirmedType);
        } catch (e) {
            cleanup(mediaPath);
            throw e;
        }
    }

    /** Download media, re-detect input type from HTTP content-type, rename if extension mismatches */
    private async downloadMedia(mediaUrl: string, initialType: InputType): Promise<{ path: string; inputType: InputType }> {
        const dlExt = extensionForType(initialType);
        const mediaPath = tempPath('fire', dlExt);
        const dlResult = await this.downloadFile(mediaUrl, mediaPath);

        const confirmedType = detectInputType(dlResult.contentType, mediaUrl) || initialType;
        const correctExt = extensionForType(confirmedType);

        // Rename if extension doesn't match detected type
        if (correctExt !== dlExt) {
            const newPath = tempPath('fire', correctExt);
            fs.renameSync(mediaPath, newPath);
            return { path: newPath, inputType: confirmedType };
        }

        return { path: mediaPath, inputType: confirmedType };
    }

    /** Render animated input directly (no caching) */
    private async renderDirect(
        mediaPath: string, fgPath: string, format: OutputFormat, lowQuality: boolean, inputType: InputType
    ): Promise<ProcessResult> {
        const outExt = format === 'gif' ? '.gif' : '.mp4';
        const tempOut = tempPath('fire', outExt);
        try {
            await compose(mediaPath, fgPath, tempOut, format, lowQuality, inputType);
        } finally {
            cleanup(mediaPath);
        }
        return { filePath: tempOut, cleanup: () => cleanup(tempOut) };
    }

    /** Render static image with cache support */
    private async renderWithCache(
        mediaPath: string, fgPath: string, format: OutputFormat, lowQuality: boolean, inputType: InputType
    ): Promise<ProcessResult> {
        const mediaBuffer = fs.readFileSync(mediaPath);
        const mediaHash = crypto.createHash('sha256').update(mediaBuffer).digest('hex');
        const cacheId = generateCacheId(mediaBuffer, lowQuality, inputType);

        let cachedGifPath = getCachedResult(cacheId);

        if (!cachedGifPath) {
            logger.info(`Cache miss, rendering: ${cacheId}`);
            const tempGif = tempPath('fire', '.gif');
            try {
                await compose(mediaPath, fgPath, tempGif, 'gif', lowQuality, inputType);
                cachedGifPath = saveCacheResult(cacheId, mediaHash, lowQuality, tempGif);
            } finally {
                cleanup(tempGif);
            }
        }

        cleanup(mediaPath);

        if (format === 'mp4') {
            const tempMp4 = tempPath('fire', '.mp4');
            await gifToMp4(cachedGifPath, tempMp4);
            return { filePath: tempMp4, cleanup: () => cleanup(tempMp4) };
        }

        // GIF: use cached file directly (no cleanup needed)
        return { filePath: cachedGifPath, cleanup: () => { } };
    }

    // ── Utilities ──

    private buildAttachment(filePath: string, format: OutputFormat): AttachmentBuilder {
        const ext = format === 'gif' ? '.gif' : '.mp4';
        return new AttachmentBuilder(filePath, { name: `fire${ext}` });
    }

    private downloadFile(url: string, dest: string): Promise<DownloadResult> {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(dest);
            const protocol = url.startsWith('https') ? https : http;
            protocol.get(url, (res) => {
                // Follow redirects
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    file.close();
                    fs.unlink(dest, () => { });
                    this.downloadFile(res.headers.location, dest).then(resolve).catch(reject);
                    return;
                }

                const contentType = res.headers['content-type'] || null;
                res.pipe(file);
                file.on('finish', () => file.close(() => resolve({ filePath: dest, contentType })));
            }).on('error', (err) => {
                fs.unlink(dest, () => { });
                reject(err);
            });
        });
    }
}
