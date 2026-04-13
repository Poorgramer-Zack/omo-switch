import * as os from "os";
import * as path from "path";
import * as fs from "fs";

export const NEW_AGENT_CONFIG_FILES = ["oh-my-openagent.jsonc", "oh-my-openagent.json"] as const;
export const LEGACY_CONFIG_FILES = ["oh-my-opencode.jsonc", "oh-my-opencode.json"] as const;
export const ALL_CONFIG_FILES = [...NEW_AGENT_CONFIG_FILES, ...LEGACY_CONFIG_FILES] as const;

function findConfigInDir(dir: string): { path: string; exists: boolean } | null {
  for (const file of ALL_CONFIG_FILES) {
    const configPath = path.join(dir, file);
    if (fs.existsSync(configPath)) {
      return { path: configPath, exists: true };
    }
  }
  return null;
}

export function findExistingConfigPath(): { path: string; exists: boolean } | null {
  if (os.platform() === "win32") {
    const userProfile = process.env.USERPROFILE || os.homedir();
    const appData = process.env.APPDATA || path.join(userProfile, "AppData", "Roaming");

    const preferredDir = path.join(userProfile, ".config", "opencode");
    const fallbackDir = path.join(appData, "opencode");

    const preferredResult = findConfigInDir(preferredDir);
    if (preferredResult) return preferredResult;

    const fallbackResult = findConfigInDir(fallbackDir);
    if (fallbackResult) return fallbackResult;

    return null;
  }

  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  const configDir = path.join(configHome, "opencode");

  const result = findConfigInDir(configDir);
  if (result) return result;

  return null;
}

export function getConfigTargetDir(): { dir: string; isPreferred: boolean } {
  if (os.platform() === "win32") {
    const userProfile = process.env.USERPROFILE || os.homedir();
    const appData = process.env.APPDATA || path.join(userProfile, "AppData", "Roaming");

    const preferredDir = path.join(userProfile, ".config", "opencode");

    const existingConfig = findExistingConfigPath();
    if (existingConfig) {
      const dir = path.dirname(existingConfig.path);
      return { dir, isPreferred: dir === preferredDir };
    }

    return { dir: preferredDir, isPreferred: true };
  }

  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  const configDir = path.join(configHome, "opencode");
  return { dir: configDir, isPreferred: true };
}

export function getConfigTargetPath(): { path: string; isPreferred: boolean } {
  const existingConfig = findExistingConfigPath();
  if (existingConfig) {
    return { path: existingConfig.path, isPreferred: true };
  }

  if (os.platform() === "win32") {
    const userProfile = process.env.USERPROFILE || os.homedir();
    const preferredPath = path.join(userProfile, ".config", "opencode", "oh-my-openagent.json");
    return { path: preferredPath, isPreferred: true };
  }

  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  const configPath = path.join(configHome, "opencode", "oh-my-openagent.json");
  return { path: configPath, isPreferred: true };
}

export function ensureConfigDir(configPath: string): void {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
