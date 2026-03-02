import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import * as fs from "fs";
import * as path from "path";
import JSON5 from "json5";
import { select } from "@inquirer/prompts";
import { StoreManager, ProjectStoreManager, Scope, Profile, OmosConfigManager, SettingsManager, OmosPresetConfig, OmosConfig } from "../store";
import { Validator } from "../utils/validator";
import { OmosValidator } from "../utils/omos-validator";
import { readBundledAsset } from "../utils/downloader";
import { resolveProjectRoot, findProjectRoot } from "../utils/scope-resolver";

/**
 * Ensure the OMO (oh-my-opencode) JSON schema is present in the local cache and return its file path.
 *
 * If the schema is already cached this returns the cached path. If not cached but a bundled schema asset
 * is available, the bundled schema is written to the cache and its path is returned.
 *
 * @returns The absolute path to the cached `oh-my-opencode.schema.json` file.
 * @throws Error if the schema is not cached and no bundled fallback is available.
 */
async function ensureOmoSchemaAvailable(store: StoreManager): Promise<string> {
  const schemaPath = path.join(store.getCacheSchemaPath(), "oh-my-opencode.schema.json");

  if (fs.existsSync(schemaPath)) {
    return schemaPath;
  }

  // Schema not in cache - try bundled fallback
  const bundledSchema = readBundledAsset("oh-my-opencode.schema.json");
  if (bundledSchema) {
    store.saveCacheFile(store.getCacheSchemaPath(), "oh-my-opencode.schema.json", bundledSchema, { source: "bundled" });
    return schemaPath;
  }

  throw new Error(
    "Schema not found in cache. Run 'omo-switch init' or 'omo-switch schema refresh' to download the schema first."
  );
}

/**
 * Ensures the slim Oh-My-Opencode JSON schema is available in the store cache, saving a bundled fallback if present.
 *
 * @param store - Store manager used to resolve cache paths and persist the schema file.
 * @returns The absolute path to the slim schema file in the store cache.
 * @throws Error if the schema is not found in the cache and no bundled fallback is available; suggests running 'omo-switch init' or 'omo-switch schema refresh'.
 */
async function ensureOmosSchemaAvailable(store: StoreManager): Promise<string> {
  const schemaPath = path.join(store.getCacheSchemaPath(), "oh-my-opencode-slim.schema.json");

  if (fs.existsSync(schemaPath)) {
    return schemaPath;
  }

  // Schema not in cache - try bundled fallback
  const bundledSchema = readBundledAsset("oh-my-opencode-slim.schema.json");
  if (bundledSchema) {
    store.saveCacheFile(store.getCacheSchemaPath(), "oh-my-opencode-slim.schema.json", bundledSchema, { source: "bundled" });
    return schemaPath;
  }

  throw new Error(
    "Slim schema not found in cache. Run 'omo-switch init' or 'omo-switch schema refresh' to download the schema first."
  );
}

/**
 * Create a URL-friendly identifier from an arbitrary name.
 *
 * @param name - The source name to convert into an identifier
 * @returns A lowercase identifier containing only letters, digits, and single hyphens (no leading or trailing hyphens), truncated to at most 50 characters
 */
function deriveIdFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 50);
}

interface AddOptions {
  id?: string;
  name?: string;
  force?: boolean;
  scope?: Scope;
}

/**
 * Add and validate an OMOS preset file into the selected scope (user or project).
 *
 * Reads and parses a `.json` preset file, validates it against the OMOS schema, optionally prompts
 * for the target scope, creates a backup of existing configuration, and then adds or updates the
 * preset in the chosen store.
 *
 * This function will terminate the process with a non-zero exit code on fatal errors such as a
 * missing file, invalid extension, JSON parse errors, schema validation failures, an invalid scope,
 * or an attempt to overwrite an existing preset without `--force`.
 *
 * @param file - Path to the preset `.json` file to import
 * @param options - AddOptions controlling id/name/force/scope overrides
 * @param spinner - Ora spinner instance used to display progress and status
 */
async function handleOmosAdd(
  file: string,
  options: AddOptions,
  spinner: ReturnType<typeof ora>
): Promise<void> {
  const globalStore = new StoreManager();
  globalStore.ensureDirectories();
  const filePath = path.resolve(file);

  spinner.text = "Reading preset file...";
  if (!fs.existsSync(filePath)) {
    spinner.fail(`File not found: ${filePath}`);
    process.exit(1);
  }

  // OMOS only supports .json files
  const fileExt = path.extname(filePath).toLowerCase();
  if (fileExt !== ".json") {
    spinner.fail(`Invalid file extension: ${fileExt}`);
    console.error(chalk.red("OMOS mode only supports .json files (no .jsonc)"));
    process.exit(1);
  }

  const fileContent = fs.readFileSync(filePath, "utf-8");
  let presetConfig: OmosPresetConfig;

  try {
    presetConfig = JSON.parse(fileContent) as OmosPresetConfig;
  } catch (err) {
    spinner.fail(`Failed to parse file as JSON: ${err instanceof Error ? err.message : "Unknown error"}`);
    process.exit(1);
  }

  // Validate preset
  spinner.text = "Validating preset configuration...";
  const schemaPath = await ensureOmosSchemaAvailable(globalStore);
  const validator = new OmosValidator(schemaPath);
  const validation = validator.validate(presetConfig as OmosConfig);

  if (!validation.valid) {
    spinner.fail("Preset validation failed");
    console.error(chalk.red("Validation errors:"));
    for (const err of validation.errors) {
      console.error(chalk.red(`  - ${err}`));
    }
    process.exit(1);
  }

  // Determine scope
  let scope: Scope = options.scope as Scope;
  if (!scope) {
    spinner.stop();
    const answer = await select({
      message: "Where do you want to add this preset?",
      choices: [
        { name: "Global (user)", value: "user" },
        { name: "Project", value: "project" },
      ],
    });
    scope = answer as Scope;
    spinner.start();
  }

  if (scope !== "user" && scope !== "project") {
    spinner.fail(`Invalid scope: ${scope}. Use 'user' or 'project'.`);
    process.exit(1);
  }

  // Derive preset name
  let presetName = options.name || options.id;
  if (!presetName) {
    presetName = deriveIdFromName(path.basename(filePath, path.extname(filePath)));
  }

  // Get the appropriate OMOS manager
  const omosManager = scope === "project"
    ? new OmosConfigManager("project", resolveProjectRoot())
    : new OmosConfigManager("user");

  // Check if preset exists
  const existingPreset = omosManager.getPreset(presetName);
  if (existingPreset && !options.force) {
    spinner.fail(`Preset '${presetName}' already exists. Use --force to overwrite.`);
    process.exit(1);
  }

  // Create backup before modification
  spinner.text = "Creating backup...";
  omosManager.createBackup();

  // Add preset
  spinner.text = "Adding preset...";
  omosManager.addPreset(presetName, presetConfig);

  const action = existingPreset ? "Updated" : "Added";
  spinner.succeed(`${action} preset '${presetName}' [${scope}]`);
  console.log(chalk.gray(`  Target: ${omosManager.getTargetPath()}`));
}

/**
 * Handle adding a profile in OMO mode (original behavior)
 */
async function handleOmoAdd(
  file: string,
  options: AddOptions,
  spinner: ReturnType<typeof ora>
): Promise<void> {
  const globalStore = new StoreManager();
  globalStore.ensureDirectories();
  const filePath = path.resolve(file);

  spinner.text = "Reading input file...";
  if (!fs.existsSync(filePath)) {
    spinner.fail(`File not found: ${filePath}`);
    process.exit(1);
  }

  const fileContent = fs.readFileSync(filePath, "utf-8");
  let config: Record<string, unknown>;

  try {
    config = JSON5.parse(fileContent) as Record<string, unknown>;
  } catch (err) {
    spinner.fail(`Failed to parse file as JSON/JSONC: ${err instanceof Error ? err.message : "Unknown error"}`);
    process.exit(1);
  }

  spinner.text = "Ensuring schema availability...";
  const schemaPath = await ensureOmoSchemaAvailable(globalStore);

  spinner.text = "Validating configuration...";
  const validator = new Validator(schemaPath);
  const validation = validator.validate(config);

  if (!validation.valid) {
    spinner.fail("Configuration validation failed");
    console.error(chalk.red("Validation errors:"));
    for (const err of validation.errors) {
      console.error(chalk.red(`  - ${err}`));
    }
    process.exit(1);
  }

  // Determine scope: if not provided, prompt user
  let scope: Scope = options.scope as Scope;
  if (!scope) {
    spinner.stop();
    const answer = await select({
      message: "Where do you want to store this profile?",
      choices: [
        { name: "Global (user)", value: "user" },
        { name: "Project", value: "project" },
      ],
    });
    scope = answer as Scope;
    spinner.start();
  }

  if (scope !== "user" && scope !== "project") {
    spinner.fail(`Invalid scope: ${scope}. Use 'user' or 'project'.`);
    process.exit(1);
  }

  let profileId = options.id;
  let profileName = options.name;

  if (!profileName && !profileId) {
    profileId = deriveIdFromName(path.basename(filePath, path.extname(filePath)));
    profileName = profileId;
  } else if (profileName && !profileId) {
    profileId = deriveIdFromName(profileName);
  } else if (!profileName && profileId) {
    profileName = profileId;
  }

  const fileExt = path.extname(filePath).toLowerCase() as ".json" | ".jsonc";

  if (fileExt !== ".json" && fileExt !== ".jsonc") {
    spinner.fail(`Invalid file extension: ${fileExt}`);
    console.error(chalk.red("Only .json and .jsonc files are supported"));
    process.exit(1);
  }

  // profileId and profileName are guaranteed to be set at this point
  const finalProfileId = profileId as string;
  const finalProfileName = profileName as string;

  if (scope === "project") {
    // Project scope: use ProjectStoreManager
    const projectRoot = resolveProjectRoot();
    const projectStore = new ProjectStoreManager(projectRoot);
    projectStore.ensureDirectories();

    const existingConfig = projectStore.configExists(finalProfileId);

    if (existingConfig && !options.force) {
      spinner.fail(`Profile with id '${finalProfileId}' already exists in project. Use --force to overwrite.`);
      process.exit(1);
    }

    if (existingConfig && options.force) {
      projectStore.deleteProfileConfig(finalProfileId);
    }

    projectStore.saveProfileConfigRaw(finalProfileId, fileContent, fileExt);

    const action = existingConfig ? "Updated" : "Added";
    spinner.succeed(`${action} profile '${finalProfileName}' (${finalProfileId}) [project]`);
    console.log(chalk.gray(`  Config: ${projectStore.getConfigsPath()}/${finalProfileId}${fileExt}`));
  } else {
    // User scope: use StoreManager (existing behavior)
    const index = globalStore.loadIndex();
    const existingProfile = index.profiles.find((p) => p.id === finalProfileId);

    if (existingProfile) {
      if (!options.force) {
        spinner.fail(`Profile with id '${finalProfileId}' already exists. Use --force to overwrite.`);
        console.error(chalk.gray(`  Name: ${existingProfile.name}`));
        console.error(chalk.gray(`  Updated: ${existingProfile.updatedAt}`));
        process.exit(1);
      }
      existingProfile.name = finalProfileName;
      existingProfile.config = config;
      existingProfile.updatedAt = new Date().toISOString();
    } else {
      const profile: Profile = {
        id: finalProfileId,
        name: finalProfileName,
        config: config,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      index.profiles.push(profile);
    }

    globalStore.saveIndex(index);

    if (existingProfile) {
      const existingConfigPath = globalStore.getProfileConfigPath(finalProfileId);
      if (existingConfigPath) {
        fs.unlinkSync(existingConfigPath);
      }
    }

    globalStore.saveProfileConfigRaw(finalProfileId, fileContent, fileExt);

    const action = existingProfile ? "Updated" : "Added";
    spinner.succeed(`${action} profile '${finalProfileName}' (${finalProfileId}) [user]`);
    console.log(chalk.gray(`  Config: ${globalStore.getConfigsPath()}/${finalProfileId}${fileExt}`));
  }
}

export const addCommand = new Command("add")
  .description("Add a profile or preset from a configuration file")
  .argument("<file>", "Path to the configuration file to import")
  .option("--id <id>", "Profile/Preset ID (defaults to derived from name)")
  .option("--name <name>", "Profile/Preset name (defaults to derived from id)")
  .option("--force", "Overwrite existing profile/preset with the same id")
  .option("--scope <scope>", "Target scope (user or project)")
  .action(async (file: string, options: AddOptions) => {
    const spinner = ora().start();

    try {
      // Determine active type
      const settings = new SettingsManager();
      const projectRoot = findProjectRoot();
      const activeType = settings.getEffectiveType(projectRoot ?? undefined);

      if (activeType === "slim") {
        await handleOmosAdd(file, options, spinner);
      } else {
        await handleOmoAdd(file, options, spinner);
      }
    } catch (err) {
      spinner.fail(`Failed to add: ${err instanceof Error ? err.message : "Unknown error"}`);
      process.exit(1);
    }
  });
