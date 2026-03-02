import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import * as path from "path";
import * as fs from "fs";
import { StoreManager, SettingsManager } from "../store";
import { downloadFile, readBundledAsset } from "../utils/downloader";
import { findProjectRoot } from "../utils/scope-resolver";

const SCHEMA_URL = "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json";
const SLIM_SCHEMA_URL = "https://raw.githubusercontent.com/Poorgramer-Zack/omo-switch/main/shared/assets/oh-my-opencode-slim.schema.json";

const SCHEMA_FILE_NAME = "oh-my-opencode.schema.json";
const SLIM_SCHEMA_FILE_NAME = "oh-my-opencode-slim.schema.json";

async function refreshSchema(offline: boolean): Promise<void> {
  const spinner = ora("Refreshing schema...").start();

  try {
    const store = new StoreManager();
    const settings = new SettingsManager();
    const projectRoot = findProjectRoot();
    const activeType = settings.getEffectiveType(projectRoot ?? undefined);
    store.ensureDirectories();

    const url = activeType === "slim" ? SLIM_SCHEMA_URL : SCHEMA_URL;
    const filename = activeType === "slim" ? SLIM_SCHEMA_FILE_NAME : SCHEMA_FILE_NAME;
    const label = activeType === "slim" ? "Slim schema" : "Schema";
    const schemaPath = path.join(store.getCacheSchemaPath(), filename);

    if (offline) {
      spinner.text = `Checking local cache for ${label.toLowerCase()}...`;

      if (fs.existsSync(schemaPath)) {
        spinner.succeed(`Using cached ${label.toLowerCase()}`);
        console.log(chalk.gray(`  Path: ${schemaPath}`));
        return;
      }

      spinner.text = `Loading bundled ${label.toLowerCase()}...`;
      const bundledSchema = readBundledAsset(filename);
      if (!bundledSchema) {
        spinner.fail(`No bundled ${label.toLowerCase()} available`);
        process.exit(1);
      }

      store.saveCacheFile(store.getCacheSchemaPath(), filename, bundledSchema, { source: "bundled" });
      spinner.succeed(`Using bundled ${label.toLowerCase()}`);
      console.log(chalk.gray(`  Path: ${schemaPath}`));
      return;
    }

    spinner.text = `Downloading ${label.toLowerCase()} from GitHub...`;
    await downloadFile(
      url,
      store.getCacheSchemaPath(),
      filename,
      { source: "github" }
    );

    spinner.succeed(`${label} refreshed successfully`);
    console.log(chalk.gray(`  Path: ${schemaPath}`));
    console.log(chalk.gray(`  URL: ${url}`));
  } catch (err) {
    spinner.fail(`Failed to refresh schema: ${err instanceof Error ? err.message : "Unknown error"}`);
    process.exit(1);
  }
}

export const schemaCommand = new Command("schema")
  .description("Schema management commands")
  .addCommand(new Command("refresh")
    .description("Refresh the schema cache")
    .option("--offline", "Use offline mode (no network download)")
    .action(async (options) => {
      await refreshSchema(options.offline as boolean);
    }));
