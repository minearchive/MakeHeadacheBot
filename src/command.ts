import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

export interface Command {
    readonly data: SlashCommandBuilder;
    execute(interaction: ChatInputCommandInteraction): Promise<void>;
}
