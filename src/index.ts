import { Bot } from './bot';
import { FireCommand } from './commands/fire';
import { RandCommand } from './commands/rand';
import { initDb } from './database';
import config from '../config.json';

initDb();

const bot = new Bot(config.token);
bot.register(new FireCommand(), new RandCommand());
bot.start();
