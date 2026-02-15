import { ChatInputCommandInteraction, SlashCommandBuilder, AttachmentBuilder, Message } from 'discord.js';
import { Command } from '../command';
import { compose, OutputFormat } from '../compose';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as https from 'https';
import * as http from 'http';
import config from '../../config.json';

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
        const imagePath = this.tempPath('.png');
        const format = (interaction.options.getString('format') || 'gif') as OutputFormat;
        const lowQuality = interaction.options.getBoolean('low_quality') ?? false;
        const ext = format === 'gif' ? '.gif' : '.mp4';
        const outputPath = this.tempPath(ext);
        const fgPath = path.resolve(config.foregroundVideo);

        try {
            if (!fs.existsSync(fgPath)) {
                await interaction.editReply('Error: foreground video file not found');
                return;
            }

            await this.downloadFile(imageUrl, imagePath);
            await compose(imagePath, fgPath, outputPath, format, lowQuality);

            const attachment = new AttachmentBuilder(outputPath, { name: `fire${ext}` });
            await interaction.editReply({ files: [attachment] });
        } catch (err) {
            console.error('Error:', err);
            const message = err instanceof Error ? err.message : String(err);
            await interaction.editReply(`Error: ${message}`).catch(() => { });
        } finally {
            this.cleanup(imagePath, outputPath);
        }
    }

    async onMessage(message: Message): Promise<void> {
        const fgPath = path.resolve(config.foregroundVideo);
        if (!fs.existsSync(fgPath)) {
            await message.reply('Error: foreground video file not found');
            return;
        }

        const imageAttachments = message.attachments.filter(
            a => a.contentType?.startsWith('image/')
        );

        let replyPrefix = '';
        let imageUrl: string;
        let imagePath: string;

        if (imageAttachments.size > 0) {
            if (imageAttachments.size > 1) {
                replyPrefix = '⚠️ 複数の添付ファイルがありますが、最初の画像のみ使用します。\n';
            }
            const firstImage = imageAttachments.first()!;
            imageUrl = firstImage.url;
            imagePath = this.tempPath(path.extname(firstImage.name || '.png') || '.png');
        } else {
            imageUrl = message.author.displayAvatarURL({ size: 1024, extension: 'png' });
            imagePath = this.tempPath('.png');
        }

        const format: OutputFormat = 'gif';
        const ext = '.gif';
        const outputPath = this.tempPath(ext);

        try {
            await this.downloadFile(imageUrl, imagePath);
            await compose(imagePath, fgPath, outputPath, format);

            const attachment = new AttachmentBuilder(outputPath, { name: `fire${ext}` });
            await message.reply({ content: replyPrefix || undefined, files: [attachment] });
        } catch (err) {
            console.error('Error:', err);
            const errMsg = err instanceof Error ? err.message : String(err);
            await message.reply(`Error: ${errMsg}`).catch(() => { });
        } finally {
            this.cleanup(imagePath, outputPath);
        }
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

