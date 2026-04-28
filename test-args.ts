import { Command } from 'commander';
const program = new Command();
program
  .command("db [action]")
  .allowUnknownOption()
  .action((action, options, command) => {
    console.log("action:", action);
    console.log("command.args:", command.args);
  });
program.parse(["node", "cli.js", "db", "generate"]);
