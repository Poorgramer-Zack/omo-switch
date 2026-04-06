import { Command } from "commander";
import chalk from "chalk";
import ora, { type Ora } from "ora";
import * as path from "path";
import { StoreManager, SettingsManager, OmosConfigManager } from "../store";
import { downloadFile, readBundledAsset } from "../utils/downloader";
import { findExistingConfigPath, getConfigTargetDir, ensureConfigDir } from "../utils/config-path";
import { getOmosConfigTargetPath } from "../utils/omos-config-path";
import { resolveProjectRoot, NEW_AGENT_CONFIG_FILE } from "../utils/scope-resolver";
import * as fs from "fs";

const SCHEMA_URL = "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json";
const SLIM_SCHEMA_URL = "https://raw.githubusercontent.com/Poorgramer-Zack/omo-switch/main/shared/assets/oh-my-opencode-slim.schema.json";

async function ensureSchema(
  store: StoreManager,
  spinner: Ora,
  url: string,
  filename: string,
  label: string,
): Promise<void> {
  const cachePath = path.join(store.getCacheSchemaPath(), filename);

  try {
    await downloadFile(url, store.getCacheSchemaPath(), filename, { source: "github" });
    spinner.succeed(`${label} downloaded from GitHub`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";

    if (fs.existsSync(cachePath)) {
      spinner.warn(`Failed to download ${label.toLowerCase()} from GitHub: ${errMsg}`);
      spinner.text = `Using cached ${label.toLowerCase()}...`;
      spinner.succeed(`Using cached ${label.toLowerCase()}`);
    } else {
      spinner.warn(`Failed to download ${label.toLowerCase()} from GitHub: ${errMsg}`);
      spinner.text = `Falling back to bundled ${label.toLowerCase()}...`;
      const bundledSchema = readBundledAsset(filename);
      if (bundledSchema) {
        store.saveCacheFile(store.getCacheSchemaPath(), filename, bundledSchema, { source: "bundled" });
        spinner.succeed(`Using bundled ${label.toLowerCase()}`);
      } else {
        spinner.fail(`No bundled ${label.toLowerCase()} available`);
        throw new Error(`Failed to download or find bundled ${label.toLowerCase()}`);
      }
    }
  }
}

export const initCommand = new Command("init")
  .description("Initialize omo-switch store with default profile")
  .action(async () => {
    const spinner = ora("Initializing omo-switch store...").start();

    try {
      const store = new StoreManager();
      const settings = new SettingsManager();
      const activeType = settings.getEffectiveType();

      spinner.text = "Creating directory structure...";
      store.ensureDirectories();

      spinner.text = "Downloading schema...";
      await ensureSchema(store, spinner, SCHEMA_URL, "oh-my-opencode.schema.json", "Schema");

      if (activeType === "slim") {
        spinner.text = "Downloading slim schema...";
        await ensureSchema(store, spinner, SLIM_SCHEMA_URL, "oh-my-opencode-slim.schema.json", "Slim schema");
      }

      spinner.text = "Creating default profile...";

      if (activeType === "slim") {
        const omosManager = new OmosConfigManager("user");

        if (omosManager.configExists()) {
          spinner.info(`Using existing config: ${omosManager.getTargetPath()}`);
          spinner.text = "Skipping default profile creation...";
        } else {
          const defaultTemplate = readBundledAsset("default-template-slim.json");
          if (!defaultTemplate) {
            spinner.fail("Default slim template not found");
            throw new Error("Default slim template not found in shared assets");
          }

          const defaultConfig = JSON.parse(defaultTemplate) as Record<string, unknown>;
          omosManager.saveConfig(defaultConfig);
          spinner.succeed(`Default slim config written to ${chalk.cyan(getOmosConfigTargetPath().path)}`);
        }

        spinner.succeed(`omo-switch initialized at ${chalk.cyan(store.getStorePath())}`);
        return;
      }
      
      // Check if user config already exists (jsonc or json)
      const existingConfig = findExistingConfigPath();
      if (existingConfig && existingConfig.exists) {
        spinner.info(`Using existing config: ${existingConfig.path}`);
        spinner.text = "Skipping default profile creation...";
        
        // Just ensure store directories exist, don't create/apply default profile
        const index = store.loadIndex();
        if (index.profiles.length === 0) {
          // Add a placeholder entry pointing to existing config
          spinner.succeed(`omo-switch initialized at ${chalk.cyan(store.getStorePath())}`);
          console.log(chalk.gray(`Existing config detected, no default profile created.`));
          console.log(chalk.gray(`Use 'omo-switch add <file>' to import your existing config as a profile.`));
          return;
        }
      } else {
        // No existing config, proceed with default profile creation
        const defaultTemplate = readBundledAsset("default-template.json");
        if (!defaultTemplate) {
          spinner.fail("Default template not found");
          throw new Error("Default template not found in shared assets");
        }

        const index = store.loadIndex();
        if (index.profiles.length === 0) {
          const defaultConfig = JSON.parse(defaultTemplate) as Record<string, unknown>;
          const profileId = "default";
          const profile = {
            id: profileId,
            name: "default",
            config: defaultConfig,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          
          index.profiles.push(profile);
          index.activeProfileId = profileId;
          store.saveProfileConfig(profileId, defaultConfig);
          store.saveIndex(index);

          // Apply default profile to target config
          spinner.text = "Applying default profile...";
          const targetDir = getConfigTargetDir();
          const targetPath = path.join(targetDir.dir, "oh-my-openagent.jsonc");
          ensureConfigDir(targetPath);
          
          const headerComment = `// Profile Name: ${profile.name}, edited by omo-switch`;
          const targetContent = `${headerComment}\n${JSON.stringify(defaultConfig, null, 2)}`;
          fs.writeFileSync(targetPath, targetContent, "utf-8");
          
          spinner.succeed(`Default profile applied to ${chalk.cyan(targetPath)}`);
        }
      }

      spinner.succeed(`omo-switch initialized at ${chalk.cyan(store.getStorePath())}`);
    } catch (err) {
      spinner.fail(`Initialization failed: ${err instanceof Error ? err.message : "Unknown error"}`);
      process.exit(1);
    }
  });
