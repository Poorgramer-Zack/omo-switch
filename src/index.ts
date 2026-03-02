#!/usr/bin/env node

import { Command } from "commander";
import { initCommand } from "./commands/init";
import { listCommand } from "./commands/list";
import { showCommand } from "./commands/show";
import { applyCommand } from "./commands/apply";
import { schemaCommand } from "./commands/schema";
import { addCommand } from "./commands/add";
import { rmCommand } from "./commands/rm";
import { typeCommand } from "./commands/type";

const program = new Command();

program
  .name("omo-switch")
  .description("CLI tool for managing oh-my-opencode profiles")
  .version("0.2.2");

program.addCommand(initCommand);
program.addCommand(listCommand);
program.addCommand(showCommand);
program.addCommand(applyCommand);
program.addCommand(schemaCommand);
program.addCommand(addCommand);
program.addCommand(rmCommand);
program.addCommand(typeCommand);

program.parse(process.argv);
