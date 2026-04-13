import { Command } from "commander";
import chalk from "chalk";
import * as fs from "fs";
import JSON5 from "json5";
import { StoreManager, ProjectStoreManager, SettingsManager, OmosConfigManager } from "../store";
import { findProjectRoot, getProjectTargetPath } from "../utils/scope-resolver";
import { deepMerge, generateDiffOutput } from "../utils/merge-config";
import { findExistingConfigPath } from "../utils/config-path";

type ShowScope = "user" | "project" | "merged";

interface ShowOptions {
  scope: ShowScope;
}

/**
 * Handle OMOS config/preset display.
 * Shows active preset or specific preset from OMOS config.
 */
function handleOmosShow(
  identifier: string | undefined,
  scope: ShowScope,
  projectRoot: string | null
): void {
  if (scope === "user") {
    // Show global OMOS config/preset
    const omosManager = new OmosConfigManager("user");
    const config = omosManager.loadConfig();

    if (!config) {
      console.error(chalk.red("No global OMOS config found."));
      console.error(chalk.gray("Run 'omo-switch add <preset-file>' to add a preset first."));
      process.exit(1);
    }

    const activePreset = omosManager.getActivePreset();

    if (!identifier) {
      // Show full config or active preset
      console.log(chalk.cyan("OMOS Configuration [user]"));
      console.log(chalk.gray(`Target: ${omosManager.getTargetPath()}`));
      console.log(chalk.gray(`Active Preset: ${activePreset ?? "(none)"}`));
      console.log(chalk.gray("-".repeat(40)));
      console.log(JSON.stringify(config, null, 2));
    } else {
      // Show specific preset
      const preset = omosManager.getPreset(identifier);
      if (!preset) {
        console.error(chalk.red(`Preset '${identifier}' not found in global OMOS config.`));
        process.exit(1);
      }

      const isActive = activePreset === identifier;
      console.log(chalk.cyan(`Preset: ${identifier} [user]${isActive ? chalk.green(" (active)") : ""}`));
      console.log(chalk.gray("-".repeat(40)));
      console.log(JSON.stringify(preset, null, 2));
    }
  } else if (scope === "project") {
    // Show project OMOS config/preset
    if (!projectRoot) {
      console.error(chalk.red("No .opencode/ directory found in parent directories."));
      process.exit(1);
    }

    const omosManager = new OmosConfigManager("project", projectRoot);
    const config = omosManager.loadConfig();

    if (!config) {
      console.error(chalk.red("No project OMOS config found."));
      console.error(chalk.gray("Run 'omo-switch add <preset-file> --scope project' first."));
      process.exit(1);
    }

    const activePreset = omosManager.getActivePreset();

    if (!identifier) {
      console.log(chalk.cyan("OMOS Configuration [project]"));
      console.log(chalk.gray(`Project: ${projectRoot}`));
      console.log(chalk.gray(`Target: ${omosManager.getTargetPath()}`));
      console.log(chalk.gray(`Active Preset: ${activePreset ?? "(none)"}`));
      console.log(chalk.gray("-".repeat(40)));
      console.log(JSON.stringify(config, null, 2));
    } else {
      const preset = omosManager.getPreset(identifier);
      if (!preset) {
        console.error(chalk.red(`Preset '${identifier}' not found in project OMOS config.`));
        process.exit(1);
      }

      const isActive = activePreset === identifier;
      console.log(chalk.cyan(`Preset: ${identifier} [project]${isActive ? chalk.green(" (active)") : ""}`));
      console.log(chalk.gray("-".repeat(40)));
      console.log(JSON.stringify(preset, null, 2));
    }
  } else {
    // Merged view: show both global and project OMOS configs
    const globalManager = new OmosConfigManager("user");
    const globalConfig = globalManager.loadConfig();

    let projectConfig = null;
    if (projectRoot) {
      const projectManager = new OmosConfigManager("project", projectRoot);
      projectConfig = projectManager.loadConfig();
    }

    if (!globalConfig && !projectConfig) {
      console.error(chalk.red("No OMOS config found in either scope."));
      console.error(chalk.gray("Use 'omo-switch add <preset-file>' to add a preset first."));
      process.exit(1);
    }

    console.log(chalk.cyan("OMOS Merged Configuration View"));
    console.log(chalk.gray(`Global: ${globalManager.getTargetPath()}`));
    if (projectRoot) {
      const projectManager = new OmosConfigManager("project", projectRoot);
      console.log(chalk.gray(`Project: ${projectManager.getTargetPath()}`));
    } else {
      console.log(chalk.gray("Project: (none)"));
    }
    console.log(chalk.gray("-".repeat(50)));

    if (globalConfig && projectConfig) {
      // Both exist - show with indicators
      console.log(chalk.yellow("// Global config:"));
      console.log(JSON.stringify(globalConfig, null, 2));
      console.log();
      console.log(chalk.green("// Project config (takes precedence):"));
      console.log(JSON.stringify(projectConfig, null, 2));
    } else if (projectConfig) {
      console.log(chalk.gray("// Project config only (no global config)"));
      console.log(JSON.stringify(projectConfig, null, 2));
    } else if (globalConfig) {
      console.log(chalk.gray("// Global config only (no project config)"));
      console.log(JSON.stringify(globalConfig, null, 2));
    }
  }
}

/**
 * Handle OMO profile display.
 * Original OMO show logic.
 */
function handleOmoShow(
  identifier: string | undefined,
  scope: ShowScope,
  projectRoot: string | null
): void {
  const globalStore = new StoreManager();
  globalStore.syncProfiles();
  const globalIndex = globalStore.loadIndex();

  let projectStore: ProjectStoreManager | null = null;
  if (projectRoot) {
    projectStore = new ProjectStoreManager(projectRoot);
  }

  if (scope === "user") {
    // Show global profile only
    if (!identifier) {
      // Use active global profile
      if (!globalIndex.activeProfileId) {
        console.error(chalk.red("No active global profile. Specify a profile ID or name."));
        process.exit(1);
      }
      identifier = globalIndex.activeProfileId;
    }

    const profile = globalIndex.profiles.find(
      (p) => p.id === identifier || p.name.toLowerCase() === identifier!.toLowerCase()
    );

    if (!profile) {
      console.error(chalk.red(`Profile not found: ${identifier}`));
      process.exit(1);
    }

    console.log(chalk.cyan(`Profile: ${profile.name} (${profile.id}) [user]`));
    console.log(chalk.gray(`Created: ${profile.createdAt}`));
    console.log(chalk.gray(`Updated: ${profile.updatedAt}`));
    console.log(chalk.gray("-".repeat(40)));

    const configRaw = globalStore.getProfileConfigRaw(profile.id);
    if (configRaw) {
      console.log(configRaw.content);
    } else {
      console.error(chalk.red(`Profile config file not found`));
      process.exit(1);
    }
  } else if (scope === "project") {
    // Show project profile only
    if (!projectStore) {
      console.error(chalk.red("No .opencode/ directory found in parent directories."));
      process.exit(1);
    }

    const projectRc = projectStore.loadRc();
    let profileId = identifier;

    if (!profileId) {
      // Use active project profile
      if (!projectRc?.activeProfileId) {
        console.error(chalk.red("No active project profile. Specify a profile ID."));
        process.exit(1);
      }
      profileId = projectRc.activeProfileId;
    }

    const configRaw = projectStore.getProfileConfigRaw(profileId);
    if (!configRaw) {
      console.error(chalk.red(`Project profile not found: ${profileId}`));
      process.exit(1);
    }

    console.log(chalk.cyan(`Profile: ${profileId} (${profileId}) [project]`));
    console.log(chalk.gray(`Project: ${projectRoot}`));
    console.log(chalk.gray("-".repeat(40)));
    console.log(configRaw.content);
  } else {
    // Merged view: read actual TARGET configs, not profile store configs
    let globalConfig: Record<string, unknown> | null = null;
    let projectConfig: Record<string, unknown> | null = null;
    let globalConfigPath = "";
    let projectConfigPath = "";

    // Get global TARGET config from ~/.config/opencode/oh-my-openagent.jsonc (or .json)
    const globalTargetResult = findExistingConfigPath();
    if (globalTargetResult && globalTargetResult.exists) {
      globalConfigPath = globalTargetResult.path;
      try {
        const content = fs.readFileSync(globalConfigPath, "utf-8");
        globalConfig = JSON5.parse(content) as Record<string, unknown>;
      } catch {
        // Ignore parse errors
      }
    }

    // Get project TARGET config: checks oh-my-openagent.json(c) then falls back to oh-my-opencode.json(c)
    if (projectRoot) {
      const projectTargetJsonc = getProjectTargetPath(projectRoot);
      const projectTargetJson = projectTargetJsonc.replace(/\.jsonc$/, ".json");

      if (fs.existsSync(projectTargetJsonc)) {
        projectConfigPath = projectTargetJsonc;
        try {
          const content = fs.readFileSync(projectTargetJsonc, "utf-8");
          projectConfig = JSON5.parse(content) as Record<string, unknown>;
        } catch {
          // Ignore parse errors
        }
      } else if (fs.existsSync(projectTargetJson)) {
        projectConfigPath = projectTargetJson;
        try {
          const content = fs.readFileSync(projectTargetJson, "utf-8");
          projectConfig = JSON5.parse(content) as Record<string, unknown>;
        } catch {
          // Ignore parse errors
        }
      }
    }

    if (!globalConfig && !projectConfig) {
      console.error(chalk.red("No applied config found in either scope."));
      console.error(chalk.gray("Use 'omo-switch apply <profile>' to apply a config first."));
      process.exit(1);
    }

    // Display merged view
    console.log(chalk.cyan("Merged Configuration View (Applied Configs)"));
    if (globalConfigPath) {
      console.log(chalk.gray(`Global: ${globalConfigPath}`));
    } else {
      console.log(chalk.gray(`Global: (none)`));
    }
    if (projectConfigPath) {
      console.log(chalk.gray(`Project: ${projectConfigPath}`));
    } else {
      console.log(chalk.gray(`Project: (none)`));
    }
    console.log(chalk.gray("-".repeat(50)));

    if (globalConfig && projectConfig) {
      // Both exist - show diff
      const merged = deepMerge(globalConfig, projectConfig);
      const diffOutput = generateDiffOutput(globalConfig, merged, projectConfig);
      console.log(diffOutput);
    } else if (projectConfig) {
      // Only project config
      console.log(chalk.gray("// Project config only (no global config applied)"));
      console.log(JSON.stringify(projectConfig, null, 2));
    } else if (globalConfig) {
      // Only global config
      console.log(chalk.gray("// Global config only (no project config applied)"));
      console.log(JSON.stringify(globalConfig, null, 2));
    }
  }
}

export const showCommand = new Command("show")
  .description("Show profile or OMOS preset configuration")
  .argument("[identifier]", "Profile ID/name (OMO) or preset name (OMOS), optional for merged view")
  .option("--scope <scope>", "View scope (user, project, merged)", "merged")
  .action((identifier: string | undefined, options: ShowOptions) => {
    try {
      const scope = options.scope as ShowScope;

      if (scope !== "user" && scope !== "project" && scope !== "merged") {
        console.error(chalk.red(`Invalid scope: ${scope}. Use 'user', 'project', or 'merged'.`));
        process.exit(1);
      }

      const projectRoot = findProjectRoot();
      const settings = new SettingsManager();
      const activeType = settings.getEffectiveType(projectRoot ?? undefined);

      if (activeType === "slim") {
        handleOmosShow(identifier, scope, projectRoot);
      } else {
        handleOmoShow(identifier, scope, projectRoot);
      }
    } catch (err) {
      console.error(chalk.red(`Failed to show config: ${err instanceof Error ? err.message : "Unknown error"}`));
      process.exit(1);
    }
  });
