import { ChatInputCommandInteraction, SlashCommandBuilder, AttachmentBuilder, Message } from 'discord.js';
import { Command } from '../command';
import { getDb } from '../database';
import logger from '../logger';
import * as fs from 'fs';
import * as path from 'path';

const CACHE_DIR = path.resolve(__dirname, '..', '..', 'run', '.cache');

export class RandCommand implements Command {
    readonly data = new SlashCommandBuilder()
        .setName('rand')
        .setDescription('Send a random cached image');

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply();

        try {
            const filePath = this.getRandomImage();
            if (!filePath) {
                await interaction.editReply('キャッシュに画像がありません。');
                return;
            }
            const ext = path.extname(filePath);
            const attachment = new AttachmentBuilder(filePath, { name: `random${ext}` });
            await interaction.editReply({ files: [attachment] });
        } catch (err) {
            logger.error(`Rand command error: ${err}`);
            const message = err instanceof Error ? err.message : String(err);
            await interaction.editReply(`Error: ${message}`).catch(() => { });
        }
    }

    async onMessage(message: Message): Promise<void> {
        try {
            const filePath = this.getRandomImage();
            if (!filePath) {
                await message.reply('キャッシュに画像がありません。');
                return;
            }
            const ext = path.extname(filePath);
            const attachment = new AttachmentBuilder(filePath, { name: `random${ext}` });
            await message.reply({ files: [attachment] });
        } catch (err) {
            logger.error(`Rand command error: ${err}`);
            const errMsg = err instanceof Error ? err.message : String(err);
            await message.reply(`Error: ${errMsg}`).catch(() => { });
        }
    }

    private getRandomImage(): string | null {
        const db = getDb();
        const row = db.prepare('SELECT file_path FROM cache_entries ORDER BY RANDOM() LIMIT 1').get() as { file_path: string } | undefined;
        if (!row) return null;

        const absPath = path.resolve(CACHE_DIR, row.file_path);
        if (!fs.existsSync(absPath)) {
            // ファイルが消えていたらDBエントリも削除して再試行
            db.prepare('DELETE FROM cache_entries WHERE file_path = ?').run(row.file_path);
            logger.info(`[rand] Stale cache entry removed: ${row.file_path}`);
            return null;
        }

        return absPath;
    }
}
