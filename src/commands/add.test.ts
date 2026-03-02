import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockProcessExit } from "../test-setup";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock("ora", () => {
  let mockSpinner: any = {
    start: vi.fn(function(this: any) { this.running = true; return this; }),
    text: "",
    succeed: vi.fn(function(this: any) { this.running = false; return this; }),
    fail: vi.fn(function(this: any) { this.running = false; return this; }),
    warn: vi.fn(function(this: any) { this.running = false; return this; }),
    info: vi.fn(function(this: any) { this.running = false; return this; }),
    stop: vi.fn(function(this: any) { this.running = false; return this; }),
  };
  return {
    default: vi.fn(() => mockSpinner) as typeof import("ora").default,
  };
});

vi.mock("chalk", () => ({
  default: {
    cyan: vi.fn((s: string) => s),
    gray: vi.fn((s: string) => s),
    red: vi.fn((s: string) => s),
    green: vi.fn((s: string) => s),
  },
}));

vi.mock("@inquirer/prompts", () => ({
  select: vi.fn(),
}));

vi.mock("../utils/downloader", () => ({
  downloadFile: vi.fn(),
  readBundledAsset: vi.fn(),
}));

// Mock Validator so tests don't need the real schema compilation.
vi.mock("../utils/validator", () => {
  const mockValidate = vi.fn(() => ({ valid: true, errors: [] }));
  return {
    Validator: class {
      validate = mockValidate;
      constructor(_schemaPath: string) {}
    },
    // Export for test access
    __mockValidate: mockValidate,
  };
});

// Mock OmosValidator for slim mode tests
vi.mock("../utils/omos-validator", () => {
  const mockValidatePreset = vi.fn(() => ({ valid: true, errors: [] }));
  return {
    OmosValidator: class {
      validatePreset = mockValidatePreset;
      constructor(_schemaPath: string) {}
    },
    __mockValidatePreset: mockValidatePreset,
  };
});

vi.mock("../utils/scope-resolver", async () => {
  const actual = await vi.importActual<typeof import("../utils/scope-resolver")>("../utils/scope-resolver");
  return {
    ...actual,
    resolveProjectRoot: vi.fn(() => "/project"),
  };
});

// Use the real ../store module; we'll import it dynamically in beforeEach so tests can spy on prototypes.
// Provide a top-level mock for ../store so any dynamic import of ./add picks up the mocked classes.
const __createdStoreInstances: any[] = [];
const __createdProjectStoreInstances: any[] = [];
vi.mock("../store", () => {
    return {
      StoreManager: class {
        constructor() {
          __createdStoreInstances.push(this);
        }
        ensureDirectories() {}
        loadIndex() {
          return { profiles: [], activeProfileId: null };
        }
        saveIndex() {}
        saveProfileConfigRaw() {}
        getProfileConfigPath() {
          return null;
        }
        configExists() {
          return false;
        }
        getConfigsPath() {
          return "/configs";
        }
        getCacheSchemaPath() {
          return "/cache/schema";
        }
        saveCacheFile() {}
        createBackup() {
          return null;
        }
      },
      ProjectStoreManager: class {
        constructor(_projectRoot: string) {
          __createdProjectStoreInstances.push(this);
        }
        ensureDirectories() {}
        configExists() {
          return false;
        }
        saveProfileConfigRaw() {}
        deleteProfileConfig() {}
        getConfigsPath() {
          return "/project/.opencode/omo-configs";
        }
        saveRc() {}
        getTargetPath() {
          return "/project/.opencode/oh-my-opencode.jsonc";
        }
        listProfiles() {
          return [];
        }
      },
      SettingsManager: class {
        getEffectiveType() {
          return "omo";
        }
        loadSettings() {
          return { type: "omo" };
        }
        isProjectOverride() {
          return false;
        }
      },
      OmosConfigManager: class {
        constructor() {}
        getPreset() {
          return null;
        }
        addPreset() {}
        setActivePreset() {}
        getActivePreset() {
          return null;
        }
        createBackup() {
          return null;
        }
        getTargetPath() {
          return "/config/opencode/oh-my-opencode-slim.json";
        }
      },
    __createdStoreInstances,
    __createdProjectStoreInstances,
   };
});
import * as fs from "fs";
import * as path from "path";
import ora from "ora";
import chalk from "chalk";
import { select } from "@inquirer/prompts";
import { downloadFile, readBundledAsset } from "../utils/downloader";
import { resolveProjectRoot } from "../utils/scope-resolver";
// Note: do not import ../store or ./add at top-level. We will dynamically import them in beforeEach

describe("addCommand", () => {
  let store: any;
  let projectStore: any;
  let StoreManagerClass: any;
  let ProjectStoreManagerClass: any;
  let addCommand: any;
  let mockSpinner: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockProcessExit();

    // ensure mocked modules are loaded by importing the store module (which we mocked above)
    const storeModule = await import("../store");
    StoreManagerClass = storeModule.StoreManager;
    ProjectStoreManagerClass = storeModule.ProjectStoreManager;

    // Clear instance tracking arrays before creating test instances
    storeModule.__createdStoreInstances.length = 0;
    storeModule.__createdProjectStoreInstances.length = 0;

    // create instances after importing the mocked classes
    store = new StoreManagerClass();
    projectStore = new ProjectStoreManagerClass("/project");

    mockSpinner = vi.mocked(ora)();

    // make StoreManager methods no-op spies so we can assert calls without touching fs
    vi.spyOn(StoreManagerClass.prototype, "ensureDirectories").mockImplementation(() => {});
    vi.spyOn(StoreManagerClass.prototype, "loadIndex").mockReturnValue({ profiles: [], activeProfileId: null });
    vi.spyOn(StoreManagerClass.prototype, "saveIndex").mockImplementation(() => {
      // debug-visible side effect when action calls saveIndex
      // eslint-disable-next-line no-console
      console.log("MOCK: prototype.saveIndex called");
    });
    vi.spyOn(StoreManagerClass.prototype, "saveProfileConfigRaw").mockImplementation(() => {
      // eslint-disable-next-line no-console
      console.log("MOCK: prototype.saveProfileConfigRaw called");
    });
    vi.spyOn(StoreManagerClass.prototype, "getProfileConfigPath").mockReturnValue(null);
    vi.spyOn(StoreManagerClass.prototype, "configExists").mockReturnValue(false);

    vi.spyOn(ProjectStoreManagerClass.prototype, "ensureDirectories").mockImplementation(() => {});
    vi.spyOn(ProjectStoreManagerClass.prototype, "configExists").mockReturnValue(false);
    vi.spyOn(ProjectStoreManagerClass.prototype, "saveProfileConfigRaw").mockImplementation(() => {
      // eslint-disable-next-line no-console
      console.log("MOCK: project.saveProfileConfigRaw called");
    });
    vi.spyOn(ProjectStoreManagerClass.prototype, "deleteProfileConfig").mockImplementation(() => {
      // eslint-disable-next-line no-console
      console.log("MOCK: project.deleteProfileConfig called");
    });
    vi.spyOn(ProjectStoreManagerClass.prototype, "getConfigsPath").mockReturnValue("/project/.opencode/omo-configs");

    vi.mocked(resolveProjectRoot).mockReturnValue("/project");
    vi.mocked(downloadFile).mockResolvedValue(true);
    vi.mocked(readBundledAsset).mockImplementation((name: string) => {
      if (name === "oh-my-opencode.schema.json") {
        return '{"$schema":"test"}';
      }
      return null;
    });
    // fs exists/read behavior: normalize paths so tests are robust on Windows and Unix
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      const s = path.normalize(String(p || ""));
      const base = path.basename(s).toLowerCase();
      // force download of schema by default
      if (base === "oh-my-opencode.schema.json") return false;
      // treat common test files as present
      if (["config.json", "config.jsonc", "valid.json", "config.txt", "invalid.json"].includes(base)) return true;
      // pretend store/index files do not exist
      if (s.includes("omo-switch")) return false;
      return false;
    });
    vi.mocked(fs.readFileSync).mockImplementation((p: any) => {
      const s = path.normalize(String(p || ""));
      const base = path.basename(s);
      if (base === "invalid.json") throw new Error("Invalid JSON");
      if (base === "oh-my-opencode.schema.json") return '{"$schema":"test"}';
      return '{ "valid": "config" }';
    });
    vi.mocked(select).mockResolvedValue("user" as any);

    mockSpinner.start.mockClear();
    mockSpinner.succeed.mockClear();
    mockSpinner.fail.mockClear();
    mockSpinner.warn.mockClear();
    mockSpinner.info.mockClear();

    // dynamically import the command module so it picks up the above mocks and spies
    const mod = await import("./add");
    addCommand = mod.addCommand;
   });

  // Helper function to invoke the add command with mocked action handler
  async function runAdd(
    file: string,
    opts: { scope?: string; force?: boolean; id?: string } = {}
  ) {
    // Use the addCommand from scope (which has mocks applied)
    const cmd = addCommand as any;
    
    // Initialize option values and sources
    cmd._optionValues = {};
    cmd._optionValueSources = {};
    
    // Set individual options if provided
    if (opts.scope) {
      cmd._optionValues.scope = opts.scope;
      cmd._optionValueSources.scope = 'cli';
    }
    if (opts.force) {
      cmd._optionValues.force = true;
      cmd._optionValueSources.force = 'cli';
    }
    if (opts.id) {
      cmd._optionValues.id = opts.id;
      cmd._optionValueSources.id = 'cli';
    }
    
    // Set the file argument
    cmd.processedArgs = [file];
    
    // Call the action handler directly with processed args
    try {
      await cmd._actionHandler(cmd.processedArgs);
    } catch (err: any) {
      // Expected: process.exit(1) throws an Error("process.exit(1)")
      if (err.message?.includes?.("process.exit")) {
        // Expected exit, don't re-throw
        return;
      }
      // If not a process.exit error, re-throw it
      throw err;
    }
  }

  // helpers to access store instances created during action
  async function lastStoreInstance() {
    const m = await import("../store");
    return m.__createdStoreInstances[m.__createdStoreInstances.length - 1];
  }

  async function lastProjectStoreInstance() {
    const m = await import("../store");
    return m.__createdProjectStoreInstances[m.__createdProjectStoreInstances.length - 1];
  }

  it("adds profile from JSON file", async () => {
    vi.mocked(resolveProjectRoot).mockReturnValue("/project");
    vi.mocked(select).mockResolvedValue("user" as any);
    vi.spyOn(StoreManagerClass.prototype, "loadIndex").mockReturnValue({
      profiles: [],
      activeProfileId: null,
    });

    // Clear arrays before test runs to get only instances from this test
    const m = await import("../store");
    m.__createdStoreInstances.length = 0;
    m.__createdProjectStoreInstances.length = 0;

    await runAdd("/path/to/config.json", { scope: "user" });

    const inst = await lastStoreInstance();
    expect(inst.saveIndex).toHaveBeenCalled();
    expect(inst.saveProfileConfigRaw).toHaveBeenCalled();
  });

  it("adds profile from JSONC file", async () => {
    vi.mocked(resolveProjectRoot).mockReturnValue("/project");
    vi.mocked(select).mockResolvedValue("user" as any);
    vi.spyOn(StoreManagerClass.prototype, "loadIndex").mockReturnValue({
      profiles: [],
      activeProfileId: null,
    });

    await runAdd("/path/to/config.jsonc", { scope: "user" });

    const inst2 = await lastStoreInstance();
    expect(inst2.saveProfileConfigRaw).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      ".jsonc"
    );
  });

  it("validates configuration before adding", async () => {
    vi.mocked(select).mockResolvedValue("user" as any);
    vi.spyOn(StoreManagerClass.prototype, "loadIndex").mockReturnValue({
      profiles: [],
      activeProfileId: null,
    });

    const m = await import("../store");
    m.__createdStoreInstances.length = 0;

    await runAdd("/path/to/valid.json", { scope: "user" });

    // Should succeed after validation
    expect(mockSpinner.succeed).toHaveBeenCalled();
  });

  it("exits when file does not exist", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    await runAdd("/path/to/missing.json", { scope: "user" });

    expect(mockSpinner.fail).toHaveBeenCalled();
  });

  it("exits when file has invalid JSON", async () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error("Invalid JSON"); });

    await runAdd("/path/to/invalid.json", { scope: "user" });

    expect(mockSpinner.fail).toHaveBeenCalled();
  });

  it("exits when file has invalid extension", async () => {
    await runAdd("/path/to/config.txt", { scope: "user" });

    expect(mockSpinner.fail).toHaveBeenCalled();
    expect(chalk.red).toHaveBeenCalledWith(expect.stringContaining("Only .json and .jsonc"));
  });

  it("overwrites existing profile when --force flag is set", async () => {
    vi.mocked(select).mockResolvedValue("user" as any);
    vi.spyOn(StoreManagerClass.prototype, "loadIndex").mockReturnValue({
      profiles: [
        { id: "existing", name: "Existing", config: {}, createdAt: "2024-01-01", updatedAt: "2024-01-01" },
      ],
      activeProfileId: null,
    });
    vi.spyOn(StoreManagerClass.prototype, "getProfileConfigPath").mockReturnValue("/configs/existing.json");

    await runAdd("/path/to/config.json", { id: "existing", force: true, scope: "user" });

    expect(fs.unlinkSync).toHaveBeenCalled();
  });

  it("exits when profile exists without --force flag", async () => {
    vi.mocked(select).mockResolvedValue("user" as any);
    vi.spyOn(StoreManagerClass.prototype, "loadIndex").mockReturnValue({
      profiles: [
        { id: "existing", name: "Existing", config: {}, createdAt: "2024-01-01", updatedAt: "2024-01-01" },
      ],
      activeProfileId: null,
    });

    await runAdd("/path/to/config.json", { id: "existing", scope: "user" });

    expect(mockSpinner.fail).toHaveBeenCalled();
  });

  it("adds profile to project scope", async () => {
    vi.mocked(select).mockResolvedValue("project" as any);
    vi.spyOn(ProjectStoreManagerClass.prototype, "configExists").mockReturnValue(false);

    await runAdd("/path/to/config.json", { scope: "project" });

    const pinst = await lastProjectStoreInstance();
    expect(pinst.saveProfileConfigRaw).toHaveBeenCalled();
  });

  it("prompts for scope when not provided", async () => {
    vi.spyOn(StoreManagerClass.prototype, "loadIndex").mockReturnValue({
      profiles: [],
      activeProfileId: null,
    });

    await runAdd("/path/to/config.json", {});

    expect(select).toHaveBeenCalledWith({
      message: "Where do you want to store this profile?",
      choices: expect.arrayContaining([
        { name: "Global (user)", value: "user" },
        { name: "Project", value: "project" },
      ]),
    });
  });

  it("overwrites project profile when --force flag is set", async () => {
    vi.mocked(select).mockResolvedValue("project" as any);
    vi.spyOn(ProjectStoreManagerClass.prototype, "configExists").mockReturnValue(true);

    await runAdd("/path/to/config.json", { id: "existing", force: true, scope: "project" });

    const pinst2 = await lastProjectStoreInstance();
    expect(pinst2.deleteProfileConfig).toHaveBeenCalledWith("existing");
  });

  it("uses bundled schema when download fails", async () => {
    vi.mocked(downloadFile).mockRejectedValue(new Error("Network error"));
    vi.spyOn(StoreManagerClass.prototype, "loadIndex").mockReturnValue({
      profiles: [],
      activeProfileId: null,
    });

    await runAdd("/path/to/config.json", { scope: "user" });

    expect(readBundledAsset).toHaveBeenCalledWith("oh-my-opencode.schema.json");
  });

  it("exits when validation fails", async () => {
    const validatorModule = await import("../utils/validator");
    validatorModule.__mockValidate.mockReturnValueOnce({
      valid: false,
      errors: ["Invalid schema", "Missing required field"],
    });

    vi.spyOn(StoreManagerClass.prototype, "loadIndex").mockReturnValue({
      profiles: [],
      activeProfileId: null,
    });

    await runAdd("/path/to/config.json", { scope: "user" });

    expect(mockSpinner.fail).toHaveBeenCalled();
    expect(chalk.red).toHaveBeenCalled();
  });

  // --- Slim mode tests ---

  it("adds preset in slim mode", async () => {
    const storeModule = await import("../store");
    vi.spyOn(storeModule.SettingsManager.prototype, "getEffectiveType").mockReturnValue("slim");
    vi.spyOn(storeModule.OmosConfigManager.prototype, "addPreset").mockImplementation(() => {});
    vi.spyOn(storeModule.OmosConfigManager.prototype, "createBackup").mockReturnValue(null);
    vi.spyOn(storeModule.OmosConfigManager.prototype, "getPreset").mockReturnValue(null);
    vi.spyOn(storeModule.OmosConfigManager.prototype, "getTargetPath").mockReturnValue("/config/opencode/oh-my-opencode-slim.json");
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      const s = path.normalize(String(p || ""));
      const base = path.basename(s).toLowerCase();
      if (base === "preset.json") return true;
      return false;
    });
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ orchestrator: { model: "test/model" } }));
    vi.mocked(select).mockResolvedValue("user" as any);

    await runAdd("/path/to/preset.json", { scope: "user" });

    expect(storeModule.OmosConfigManager.prototype.addPreset).toHaveBeenCalled();
    expect(mockSpinner.succeed).toHaveBeenCalledWith(expect.stringContaining("Added preset"));
  });

  it("downloads slim schema from remote in slim mode", async () => {
    const storeModule = await import("../store");
    vi.spyOn(storeModule.SettingsManager.prototype, "getEffectiveType").mockReturnValue("slim");
    vi.spyOn(storeModule.OmosConfigManager.prototype, "addPreset").mockImplementation(() => {});
    vi.spyOn(storeModule.OmosConfigManager.prototype, "createBackup").mockReturnValue(null);
    vi.spyOn(storeModule.OmosConfigManager.prototype, "getPreset").mockReturnValue(null);
    vi.spyOn(storeModule.OmosConfigManager.prototype, "getTargetPath").mockReturnValue("/config/opencode/oh-my-opencode-slim.json");
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      const s = path.normalize(String(p || ""));
      const base = path.basename(s).toLowerCase();
      if (base === "preset.json") return true;
      return false;
    });
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ orchestrator: { model: "test/model" } }));
    vi.mocked(select).mockResolvedValue("user" as any);

    await runAdd("/path/to/preset.json", { scope: "user" });

    expect(downloadFile).toHaveBeenCalledWith(
      expect.stringContaining("oh-my-opencode-slim.schema.json"),
      "/cache/schema",
      "oh-my-opencode-slim.schema.json",
      { source: "github" }
    );
  });

  it("uses bundled slim schema when download fails in slim mode", async () => {
    const storeModule = await import("../store");
    vi.spyOn(storeModule.SettingsManager.prototype, "getEffectiveType").mockReturnValue("slim");
    vi.spyOn(storeModule.OmosConfigManager.prototype, "addPreset").mockImplementation(() => {});
    vi.spyOn(storeModule.OmosConfigManager.prototype, "createBackup").mockReturnValue(null);
    vi.spyOn(storeModule.OmosConfigManager.prototype, "getPreset").mockReturnValue(null);
    vi.spyOn(storeModule.OmosConfigManager.prototype, "getTargetPath").mockReturnValue("/config/opencode/oh-my-opencode-slim.json");
    vi.mocked(downloadFile).mockImplementation(async (_url: string, _dir: string, fileName: string) => {
      if (fileName === "oh-my-opencode-slim.schema.json") {
        throw new Error("Network error");
      }
      return true;
    });
    vi.mocked(readBundledAsset).mockImplementation((name: string) => {
      if (name === "oh-my-opencode-slim.schema.json") return '{"$schema":"test-slim"}';
      if (name === "oh-my-opencode.schema.json") return '{"$schema":"test"}';
      return null;
    });
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      const s = path.normalize(String(p || ""));
      const base = path.basename(s).toLowerCase();
      if (base === "preset.json") return true;
      return false;
    });
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ orchestrator: { model: "test/model" } }));
    vi.mocked(select).mockResolvedValue("user" as any);

    await runAdd("/path/to/preset.json", { scope: "user" });

    expect(readBundledAsset).toHaveBeenCalledWith("oh-my-opencode-slim.schema.json");
    expect(mockSpinner.succeed).toHaveBeenCalled();
  });

  it("rejects .jsonc files in slim mode", async () => {
    const storeModule = await import("../store");
    vi.spyOn(storeModule.SettingsManager.prototype, "getEffectiveType").mockReturnValue("slim");
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      const s = path.normalize(String(p || ""));
      const base = path.basename(s).toLowerCase();
      if (base === "preset.jsonc") return true;
      return false;
    });

    await runAdd("/path/to/preset.jsonc", { scope: "user" });

    expect(mockSpinner.fail).toHaveBeenCalledWith(expect.stringContaining("Invalid file extension"));
  });

  it("exits when slim preset exists without --force", async () => {
    const storeModule = await import("../store");
    vi.spyOn(storeModule.SettingsManager.prototype, "getEffectiveType").mockReturnValue("slim");
    vi.spyOn(storeModule.OmosConfigManager.prototype, "getPreset").mockReturnValue({ orchestrator: { model: "test/model" } });
    vi.spyOn(storeModule.OmosConfigManager.prototype, "getTargetPath").mockReturnValue("/config/opencode/oh-my-opencode-slim.json");
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      const s = path.normalize(String(p || ""));
      const base = path.basename(s).toLowerCase();
      if (base === "preset.json") return true;
      return false;
    });
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ orchestrator: { model: "test/model" } }));
    vi.mocked(select).mockResolvedValue("user" as any);

    await runAdd("/path/to/preset.json", { scope: "user", id: "my-preset" });

    expect(mockSpinner.fail).toHaveBeenCalledWith(expect.stringContaining("already exists"));
  });
});
