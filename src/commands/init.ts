import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import * as path from "path";
import { StoreManager, SettingsManager, OmosConfigManager } from "../store";
import { STORE_VERSION } from "../store/types";
import { downloadFile, readBundledAsset } from "../utils/downloader";
import { findExistingConfigPath, getConfigTargetDir, ensureConfigDir } from "../utils/config-path";
import { getOmosConfigTargetPath } from "../utils/omos-config-path";
import * as fs from "fs";

const SCHEMA_URL = "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json";
const SLIM_SCHEMA_URL = "https://raw.githubusercontent.com/Poorgramer-Zack/omo-switch/main/shared/assets/oh-my-opencode-slim.schema.json";

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
      const schemaCachePath = path.join(store.getCacheSchemaPath(), "oh-my-opencode.schema.json");
      
      try {
        await downloadFile(
          SCHEMA_URL,
          store.getCacheSchemaPath(),
          "oh-my-opencode.schema.json",
          { source: "github" }
        );
        spinner.succeed("Schema downloaded from GitHub");
      } catch (err) {
        const metaPath = path.join(store.getCacheSchemaPath(), "meta.json");
        
        if (fs.existsSync(schemaCachePath)) {
          spinner.warn(`Failed to download schema from GitHub: ${err instanceof Error ? err.message : "Unknown error"}`);
          spinner.text = "Using cached schema...";
          spinner.succeed("Using cached schema");
        } else {
          spinner.warn(`Failed to download schema from GitHub: ${err instanceof Error ? err.message : "Unknown error"}`);
          spinner.text = "Falling back to bundled schema...";
          const bundledSchema = readBundledAsset("oh-my-opencode.schema.json");
          if (bundledSchema) {
            store.saveCacheFile(store.getCacheSchemaPath(), "oh-my-opencode.schema.json", bundledSchema, { source: "bundled" });
            spinner.succeed("Using bundled schema");
          } else {
            spinner.fail("No bundled schema available");
            throw new Error("Failed to download or find bundled schema");
          }
        }
      }

      if (activeType === "slim") {
        spinner.text = "Downloading slim schema...";
        const slimSchemaCachePath = path.join(store.getCacheSchemaPath(), "oh-my-opencode-slim.schema.json");

        try {
          await downloadFile(
            SLIM_SCHEMA_URL,
            store.getCacheSchemaPath(),
            "oh-my-opencode-slim.schema.json",
            { source: "github" }
          );
          spinner.succeed("Slim schema downloaded from GitHub");
        } catch (err) {
          if (fs.existsSync(slimSchemaCachePath)) {
            spinner.warn(`Failed to download slim schema from GitHub: ${err instanceof Error ? err.message : "Unknown error"}`);
            spinner.text = "Using cached slim schema...";
            spinner.succeed("Using cached slim schema");
          } else {
            spinner.warn(`Failed to download slim schema from GitHub: ${err instanceof Error ? err.message : "Unknown error"}`);
            spinner.text = "Falling back to bundled slim schema...";
            const bundledSchema = readBundledAsset("oh-my-opencode-slim.schema.json");
            if (bundledSchema) {
              store.saveCacheFile(store.getCacheSchemaPath(), "oh-my-opencode-slim.schema.json", bundledSchema, { source: "bundled" });
              spinner.succeed("Using bundled slim schema");
            } else {
              spinner.fail("No bundled slim schema available");
              throw new Error("Failed to download or find bundled slim schema");
            }
          }
        }
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
          const targetPath = path.join(targetDir.dir, "oh-my-opencode.jsonc");
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
