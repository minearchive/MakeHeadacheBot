import { Client, GatewayIntentBits } from 'discord.js';
import { Command } from './command';
import logger from './logger';

export class Bot {
    private readonly client: Client;
    private readonly commands: Map<string, Command> = new Map();

    constructor(private readonly token: string) {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent
            ]
        });
        this.client.once('clientReady', () => this.onReady());
        this.client.on('interactionCreate', (interaction) => {
            if (interaction.isChatInputCommand()) {
                this.onCommand(interaction);
            }
        });
        this.client.on('messageCreate', (message) => {
            if (message.author.bot) return;
            this.onMessageCommand(message);
        });
    }

    register(...commands: Command[]): this {
        for (const cmd of commands) {
            this.commands.set(cmd.data.name, cmd);
        }
        return this;
    }

    async start(): Promise<void> {
        await this.client.login(this.token);
    }

    private async onReady(): Promise<void> {
        logger.info(`Logged in as ${this.client.user!.tag}`);

        const commandData = [...this.commands.values()].map(c => c.data.toJSON());
        await this.client.application!.commands.set(commandData);
        logger.info(`Registered ${commandData.length} command(s)`);
    }

    private async onCommand(interaction: import('discord.js').ChatInputCommandInteraction): Promise<void> {
        const command = this.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction);
        } catch (err) {
            logger.error(`Command error [${interaction.commandName}]: ${err}`);
        }
    }

    private async onMessageCommand(message: import('discord.js').Message): Promise<void> {
        const content = message.content.trim();
        if (!content.startsWith('!')) return;

        const commandName = content.slice(1).split(/\s+/)[0].toLowerCase();
        const command = this.commands.get(commandName);
        if (!command || !command.onMessage) return;

        try {
            await command.onMessage(message);
        } catch (err) {
            logger.error(`Message command error [${commandName}]: ${err}`);
        }
    }
}
