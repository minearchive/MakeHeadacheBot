import { ChatInputCommandInteraction, SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
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
        ) as SlashCommandBuilder;

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply();

        const targetUser = interaction.options.getUser('user') || interaction.user;
        const avatarUrl = targetUser.displayAvatarURL({ size: 1024, extension: 'png' });
        const avatarPath = this.tempPath('.png');
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

            await this.downloadFile(avatarUrl, avatarPath);
            await compose(avatarPath, fgPath, outputPath, format, lowQuality);

            const attachment = new AttachmentBuilder(outputPath, { name: `fire${ext}` });
            await interaction.editReply({ files: [attachment] });
        } catch (err) {
            console.error('Error:', err);
            const message = err instanceof Error ? err.message : String(err);
            await interaction.editReply(`Error: ${message}`).catch(() => { });
        } finally {
            this.cleanup(avatarPath, outputPath);
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
