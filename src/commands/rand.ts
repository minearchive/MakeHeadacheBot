import { ChatInputCommandInteraction, SlashCommandBuilder, AttachmentBuilder, Message } from 'discord.js';
import { Command } from '../command';
import { CACHE_DIR } from '../cache';
import { getDb } from '../database';
import logger from '../logger';
import * as fs from 'fs';
import * as path from 'path';

export class RandCommand implements Command {
    readonly data = new SlashCommandBuilder()
        .setName('rand')
        .setDescription('Send a random cached image');

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.deferReply();

        try {
            const result = this.getRandomCachedFile();
            await interaction.editReply(
                result
                    ? { files: [result] }
                    : { content: 'キャッシュに画像がありません。' }
            );
        } catch (err) {
            logger.error(`Rand command error: ${err}`);
            const msg = err instanceof Error ? err.message : String(err);
            await interaction.editReply(`Error: ${msg}`).catch(() => { });
        }
    }

    async onMessage(message: Message): Promise<void> {
        try {
            const result = this.getRandomCachedFile();
            await message.reply(
                result
                    ? { files: [result] }
                    : { content: 'キャッシュに画像がありません。' }
            );
        } catch (err) {
            logger.error(`Rand command error: ${err}`);
            const errMsg = err instanceof Error ? err.message : String(err);
            await message.reply(`Error: ${errMsg}`).catch(() => { });
        }
    }

    /** Get a random cached file as an AttachmentBuilder, or null if none available */
    private getRandomCachedFile(): AttachmentBuilder | null {
        const db = getDb();
        const row = db.prepare('SELECT file_path FROM cache_entries ORDER BY RANDOM() LIMIT 1')
            .get() as { file_path: string } | undefined;

        if (!row) return null;

        const absPath = path.resolve(CACHE_DIR, row.file_path);
        if (!fs.existsSync(absPath)) {
            db.prepare('DELETE FROM cache_entries WHERE file_path = ?').run(row.file_path);
            logger.info(`[rand] Stale cache entry removed: ${row.file_path}`);
            return null;
        }

        const ext = path.extname(absPath);
        return new AttachmentBuilder(absPath, { name: `random${ext}` });
    }
}
