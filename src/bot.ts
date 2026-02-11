import { Client, GatewayIntentBits } from 'discord.js';
import { Command } from './command';

export class Bot {
    private readonly client: Client;
    private readonly commands: Map<string, Command> = new Map();

    constructor(private readonly token: string) {
        this.client = new Client({ intents: [GatewayIntentBits.Guilds] });
        this.client.once('clientReady', () => this.onReady());
        this.client.on('interactionCreate', (interaction) => {
            if (interaction.isChatInputCommand()) {
                this.onCommand(interaction);
            }
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
        console.log(`Logged in as ${this.client.user!.tag}`);

        const commandData = [...this.commands.values()].map(c => c.data.toJSON());
        await this.client.application!.commands.set(commandData);
        console.log(`Registered ${commandData.length} command(s)`);
    }

    private async onCommand(interaction: import('discord.js').ChatInputCommandInteraction): Promise<void> {
        const command = this.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction);
        } catch (err) {
            console.error(`Command error [${interaction.commandName}]:`, err);
        }
    }
}
