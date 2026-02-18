import { ChatInputCommandInteraction, SlashCommandBuilder, AttachmentBuilder, Message } from 'discord.js';
import { Command } from '../command';
import { compose, OutputFormat, gifToMp4 } from '../compose';
import { generateCacheId, getCachedResult, saveCacheResult } from '../cache';
import logger from '../logger';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as https from 'https';
import * as http from 'http';
import config from '../../config.json';

interface ProcessResult {
    filePath: string;
    cleanup: () => void;
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
                .setDescription('Image to use (defaults to avatar)')
                .setRequired(false)
        ) as SlashCommandBuilder;

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply();

        const imageAttachment = interaction.options.getAttachment('image');
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const imageUrl = imageAttachment?.url ?? targetUser.displayAvatarURL({ size: 1024, extension: 'png' });
        const format = (interaction.options.getString('format') || 'gif') as OutputFormat;
        const lowQuality = interaction.options.getBoolean('low_quality') ?? false;

        try {
            const result = await this.processImage(imageUrl, format, lowQuality);
            try {
                const ext = format === 'gif' ? '.gif' : '.mp4';
                const attachment = new AttachmentBuilder(result.filePath, { name: `fire${ext}` });
                await interaction.editReply({ files: [attachment] });
            } finally {
                result.cleanup();
            }
        } catch (err) {
            logger.error(`Error: ${err}`);
            const message = err instanceof Error ? err.message : String(err);
            await interaction.editReply(`Error: ${message}`).catch(() => { });
        }
    }

    async onMessage(message: Message): Promise<void> {
        const imageAttachments = message.attachments.filter(
            a => a.contentType?.startsWith('image/')
        );

        let replyPrefix = '';
        let imageUrl: string;

        if (imageAttachments.size > 0) {
            if (imageAttachments.size > 1) {
                replyPrefix = '⚠️ 複数の添付ファイルがありますが、最初の画像のみ使用します。\n';
            }
            imageUrl = imageAttachments.first()!.url;
        } else if (message.reference?.messageId) {
            const refMessage = await message.channel.messages.fetch(message.reference.messageId);
            const refImageAttachments = refMessage.attachments.filter(
                a => a.contentType?.startsWith('image/')
            );
            if (refImageAttachments.size > 0) {
                if (refImageAttachments.size > 1) {
                    replyPrefix = '⚠️ リプライ先に複数の画像がありますが、最初の画像のみ使用します。\n';
                }
                imageUrl = refImageAttachments.first()!.url;
            } else {
                imageUrl = message.author.displayAvatarURL({ size: 1024, extension: 'png' });
            }
        } else {
            imageUrl = message.author.displayAvatarURL({ size: 1024, extension: 'png' });
        }

        try {
            const result = await this.processImage(imageUrl, 'gif', false);
            try {
                const attachment = new AttachmentBuilder(result.filePath, { name: 'fire.gif' });
                await message.reply({ content: replyPrefix || undefined, files: [attachment] });
            } finally {
                result.cleanup();
            }
        } catch (err) {
            console.error('Error:', err);
            const errMsg = err instanceof Error ? err.message : String(err);
            await message.reply(`Error: ${errMsg}`).catch(() => { });
        }
    }

    private async processImage(imageUrl: string, format: OutputFormat, lowQuality: boolean): Promise<ProcessResult> {
        const fgPath = path.resolve(config.foregroundVideo);
        if (!fs.existsSync(fgPath)) {
            throw new Error('foreground video file not found');
        }

        // 画像をダウンロードしてバッファに読み込む
        const imagePath = this.tempPath('.png');
        await this.downloadFile(imageUrl, imagePath);
        const imageBuffer = fs.readFileSync(imagePath);
        const imageHash = crypto.createHash('sha256').update(imageBuffer).digest('hex');

        // キャッシュIDを生成（format非依存）
        const cacheId = generateCacheId(imageBuffer, lowQuality);

        // キャッシュ確認
        let cachedGifPath = getCachedResult(cacheId);

        if (!cachedGifPath) {
            // キャッシュなし → GIFをレンダリングしてキャッシュに保存
            logger.info(`Cache miss, rendering: ${cacheId}`);
            const tempGif = this.tempPath('.gif');
            try {
                await compose(imagePath, fgPath, tempGif, 'gif', lowQuality);
                cachedGifPath = saveCacheResult(cacheId, imageHash, lowQuality, tempGif);
            } finally {
                this.cleanup(tempGif);
            }
        }

        this.cleanup(imagePath);

        // フォーマットに応じて返却
        if (format === 'mp4') {
            // GIFからMP4に変換
            const tempMp4 = this.tempPath('.mp4');
            await gifToMp4(cachedGifPath, tempMp4);
            return {
                filePath: tempMp4,
                cleanup: () => this.cleanup(tempMp4)
            };
        }

        // GIFの場合はキャッシュファイルをそのまま使用（削除しない）
        return {
            filePath: cachedGifPath,
            cleanup: () => { }
        };
    }

    private downloadFile(url: string, dest: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(dest);
            const protocol = url.startsWith('https') ? https : http;
            protocol.get(url, (res) => {
                res.pipe(file);
                file.on('finish', () => file.close(() => resolve(dest)));
            }).on('error', (err) => {
                fs.unlink(dest, () => { });
                reject(err);
            });
        });
    }

    private tempPath(ext: string): string {
        return path.join(os.tmpdir(), `fire-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    }

    private cleanup(...files: string[]): void {
        for (const file of files) {
            try { fs.unlinkSync(file); } catch { }
        }
    }
}
