import { Bot } from './bot';
import { FireCommand } from './commands/fire';
import config from '../config.json';

const bot = new Bot(config.token);
bot.register(new FireCommand());
bot.start();
