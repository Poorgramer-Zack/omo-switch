import * as fs from "fs";
import * as path from "path";
import { ProjectRc } from "./types";
import { cleanOldBackups } from "../utils/backup-cleaner";
import { SettingsManager } from "./settings-manager";
import {
  getProjectConfigsPath,
  getProjectTargetPath,
  getProjectRcPath,
  loadProjectRc,
  saveProjectRc,
  ensureProjectDirs,
  ALL_PROJECT_CONFIG_FILES,
} from "../utils/scope-resolver";

const OPENCODE_DIR = ".opencode";
const BACKUPS_DIR = "backups";

export class ProjectStoreManager {
  private readonly projectRoot: string;
  private readonly configsPath: string;
  private readonly targetPath: string;
  private readonly rcPath: string;
  private readonly backupsPath: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.configsPath = getProjectConfigsPath(projectRoot);
    this.targetPath = getProjectTargetPath(projectRoot);
    this.rcPath = getProjectRcPath(projectRoot);
    this.backupsPath = path.join(projectRoot, OPENCODE_DIR, BACKUPS_DIR);
  }

  getProjectRoot(): string {
    return this.projectRoot;
  }

  getConfigsPath(): string {
    return this.configsPath;
  }

  getTargetPath(): string {
    return this.targetPath;
  }

  findExistingTargetConfig(): string | null {
    const opencodeDir = path.join(this.projectRoot, OPENCODE_DIR);
    for (const file of ALL_PROJECT_CONFIG_FILES) {
      const configPath = path.join(opencodeDir, file);
      if (fs.existsSync(configPath)) {
        return configPath;
      }
    }
    return null;
  }

  getRcPath(): string {
    return this.rcPath;
  }

  ensureDirectories(): void {
    ensureProjectDirs(this.projectRoot);
    if (!fs.existsSync(this.backupsPath)) {
      fs.mkdirSync(this.backupsPath, { recursive: true });
    }
    // Ensure backups folder is gitignored
    this.ensureGitignore();
  }

  /**
   * Ensure .opencode/.gitignore contains backups/ entry
   */
  private ensureGitignore(): void {
    const opencodeDir = path.join(this.projectRoot, OPENCODE_DIR);
    const gitignorePath = path.join(opencodeDir, ".gitignore");
    const backupsEntry = "backups/";

    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, "utf-8");
      // Check if backups/ is already in gitignore
      const lines = content.split(/\r?\n/);
      const hasBackups = lines.some(line => line.trim() === backupsEntry || line.trim() === "backups");
      if (!hasBackups) {
        // Append backups/ to existing gitignore
        const newContent = content.endsWith("\n") ? `${content}${backupsEntry}\n` : `${content}\n${backupsEntry}\n`;
        fs.writeFileSync(gitignorePath, newContent, "utf-8");
      }
    } else {
      // Create new gitignore with backups/
      fs.writeFileSync(gitignorePath, `${backupsEntry}\n`, "utf-8");
    }
  }

  loadRc(): ProjectRc | null {
    return loadProjectRc(this.projectRoot);
  }

  saveRc(rc: ProjectRc): void {
    saveProjectRc(this.projectRoot, rc);
  }

  getProfileConfigPath(profileId: string): string | null {
    const jsoncPath = path.join(this.configsPath, `${profileId}.jsonc`);
    const jsonPath = path.join(this.configsPath, `${profileId}.json`);
    if (fs.existsSync(jsoncPath)) {
      return jsoncPath;
    }
    if (fs.existsSync(jsonPath)) {
      return jsonPath;
    }
    return null;
  }

  getProfileConfigRaw(profileId: string): { path: string; content: string } | null {
    const configPath = this.getProfileConfigPath(profileId);
    if (!configPath) {
      return null;
    }
    const content = fs.readFileSync(configPath, "utf-8");
    return { path: configPath, content };
  }

  saveProfileConfigRaw(profileId: string, content: string, extension: ".json" | ".jsonc"): void {
    this.ensureDirectories();
    const configPath = path.join(this.configsPath, `${profileId}${extension}`);
    fs.writeFileSync(configPath, content, "utf-8");
  }

  configExists(profileId: string): boolean {
    return this.getProfileConfigPath(profileId) !== null;
  }

  /**
   * List all profile IDs in project config folder.
   */
  listProfiles(): string[] {
    if (!fs.existsSync(this.configsPath)) {
      return [];
    }
    const files = fs.readdirSync(this.configsPath);
    const profileIds = new Set<string>();
    for (const file of files) {
      if (file.endsWith(".jsonc")) {
        const id = file.replace(".jsonc", "");
        profileIds.add(id);
      } else if (file.endsWith(".json")) {
        const id = file.replace(".json", "");
        if (!profileIds.has(id)) {
          profileIds.add(id);
        }
      }
    }
    return Array.from(profileIds);
  }

  /**
   * Create backup of config file to <project>/.opencode/backups/
   */
  createBackup(configPath: string): string | null {
    if (!fs.existsSync(configPath)) {
      return null;
    }
    if (!fs.existsSync(this.backupsPath)) {
      fs.mkdirSync(this.backupsPath, { recursive: true });
    }

    // Clean up old backups before creating new one
    const settings = new SettingsManager();
    const retentionDays = settings.loadSettings().backupRetentionDays;
    cleanOldBackups(this.backupsPath, retentionDays);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFileName = `${timestamp}__${path.basename(configPath)}`;
    const backupPath = path.join(this.backupsPath, backupFileName);
    fs.copyFileSync(configPath, backupPath);
    return backupPath;
  }

  /**
   * Delete profile config file if exists.
   */
  deleteProfileConfig(profileId: string): boolean {
    const configPath = this.getProfileConfigPath(profileId);
    if (configPath && fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
      return true;
    }
    return false;
  }
}
