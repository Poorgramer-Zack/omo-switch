import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockProcessExit } from "../test-setup";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("ora", () => {
  const mockSpinner: any = {
    start: vi.fn(function(this: any) { this.running = true; return this; }),
    text: "",
    succeed: vi.fn(function(this: any) { this.running = false; return this; }),
    fail: vi.fn(function(this: any) { this.running = false; return this; }),
    info: vi.fn(function(this: any) { this.running = false; return this; }),
    warn: vi.fn(function(this: any) { this.running = false; return this; }),
  };
  return {
    default: vi.fn(() => mockSpinner),
  };
});

vi.mock("chalk", () => ({
  default: {
    cyan: vi.fn((s: string) => s),
    gray: vi.fn((s: string) => s),
  },
}));

vi.mock("../store", async () => {
  const actual = await vi.importActual<typeof import("../store")>("../store");
  return {
    ...actual,
    SettingsManager: class {
      getEffectiveType() { return "omo"; }
      loadSettings() { return { activeType: "omo" }; }
    },
    OmosConfigManager: class {
      configExists() { return false; }
      saveConfig() {}
      getTargetPath() { return "/config/opencode/oh-my-opencode-slim.json"; }
    },
  };
});

vi.mock("../utils/downloader", () => ({
  downloadFile: vi.fn(),
  readBundledAsset: vi.fn(),
}));

vi.mock("../utils/config-path", () => ({
  findExistingConfigPath: vi.fn(),
  getConfigTargetDir: vi.fn(),
  ensureConfigDir: vi.fn(),
}));

vi.mock("../utils/omos-config-path", () => ({
  getOmosConfigTargetPath: vi.fn(() => ({ path: "/config/opencode/oh-my-opencode-slim.json", isPreferred: true })),
}));

import * as fs from "fs";
import ora from "ora";
import chalk from "chalk";
import { StoreManager, SettingsManager, OmosConfigManager } from "../store";
import { downloadFile, readBundledAsset } from "../utils/downloader";
import { findExistingConfigPath, getConfigTargetDir } from "../utils/config-path";

describe("initCommand", () => {
  let initCommand: any;
  let mockSpinner: any;

  beforeEach(async () => {
    vi.restoreAllMocks();
    mockProcessExit();

    vi.spyOn(StoreManager.prototype, "ensureDirectories");
    vi.spyOn(StoreManager.prototype, "getCacheSchemaPath").mockReturnValue("/cache/schema");
    vi.spyOn(StoreManager.prototype, "saveCacheFile");
    vi.spyOn(StoreManager.prototype, "saveProfileConfig");
    vi.spyOn(StoreManager.prototype, "saveIndex");
    vi.spyOn(StoreManager.prototype, "getProfileConfigRaw").mockReturnValue(null);
    vi.spyOn(StoreManager.prototype, "loadIndex").mockReturnValue({
      storeVersion: "1.0.0",
      profiles: [],
      activeProfileId: null,
    });

    vi.mocked(downloadFile).mockResolvedValue(true);
    vi.mocked(readBundledAsset).mockImplementation((name: string) => {
      if (name === "default-template.json") {
        return JSON.stringify({ agents: { build: { model: "test" } } });
      }
      if (name === "oh-my-opencode.schema.json") {
        return '{"$schema":"test"}';
      }
      return null;
    });
    vi.mocked(findExistingConfigPath).mockReturnValue({ path: "", exists: false });
    vi.mocked(getConfigTargetDir).mockReturnValue({ dir: "/config/opencode", isPreferred: true });
    vi.mocked(fs.existsSync).mockReturnValue(false);

    // obtain the mock spinner instance from the mocked ora factory
    mockSpinner = vi.mocked(ora)();
    mockSpinner.start.mockClear();
    mockSpinner.succeed.mockClear();
    mockSpinner.fail.mockClear();
    mockSpinner.info.mockClear();
    mockSpinner.warn.mockClear();

    // dynamically import the command module so it picks up the above mocks and spies
    const mod = await import("./init");
    initCommand = mod.initCommand;
  });

  // Helper function to invoke the init command with mocked action handler
  async function runInit() {
    const cmd = initCommand as any;
    cmd._optionValues = {};
    cmd._optionValueSources = {};
    cmd.processedArgs = [];
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

  it("initializes store and downloads schema, creates default profile", async () => {
    await runInit();

    expect(downloadFile).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json",
      "/cache/schema",
      "oh-my-opencode.schema.json",
      { source: "github" }
    );
  });

  it("uses bundled schema when GitHub download fails", async () => {
    vi.mocked(downloadFile).mockRejectedValueOnce(new Error("Network error"));

    await runInit();

    expect(mockSpinner.warn).toHaveBeenCalled();
    expect(mockSpinner.succeed).toHaveBeenCalled();
  });

  it("uses cached schema when available and GitHub download fails", async () => {
    vi.mocked(downloadFile).mockRejectedValue(new Error("Network error"));
    vi.mocked(readBundledAsset).mockReturnValue(null);
    vi.mocked(fs.existsSync).mockImplementation((path) => {
      return typeof path === "string" && path.includes("oh-my-opencode.schema.json");
    });

    await runInit();

    expect(mockSpinner.warn).toHaveBeenCalled();
    expect(mockSpinner.succeed).toHaveBeenCalledWith(expect.stringContaining("Using cached"));
  });



  it("skips default profile creation when existing config detected", async () => {
    vi.mocked(readBundledAsset).mockReturnValue(null);
    vi.mocked(findExistingConfigPath).mockReturnValue({ path: "/config/opencode/config.json", exists: true });
    vi.mocked(fs.existsSync).mockImplementation((path) => {
      if (typeof path === "string" && path.includes("configs")) return false;
      return true;
    });
    vi.spyOn(StoreManager.prototype, "loadIndex").mockReturnValue({
      storeVersion: "1.0.0",
      profiles: [],
      activeProfileId: null,
    });

    await runInit();

    expect(mockSpinner.info).toHaveBeenCalledWith(expect.stringContaining("Using existing config"));
    expect(mockSpinner.succeed).toHaveBeenCalled();
  });

  it("fails when no default template is available", async () => {
    vi.mocked(readBundledAsset).mockReturnValue(null);

    await runInit();

    expect(mockSpinner.fail).toHaveBeenCalled();
  });

  it("fails when both GitHub and bundled schema are unavailable", async () => {
    vi.mocked(readBundledAsset).mockReturnValue(null);
    vi.mocked(downloadFile).mockRejectedValue(new Error("Network error"));

    await runInit();

    expect(mockSpinner.fail).toHaveBeenCalledWith(expect.stringContaining("No bundled schema"));
  });

  // --- Slim mode tests ---

  it("initializes slim mode when activeType is slim", async () => {
    vi.spyOn(SettingsManager.prototype, "getEffectiveType").mockReturnValue("slim");
    vi.mocked(readBundledAsset).mockImplementation((name: string) => {
      if (name === "default-template-slim.json") {
        return JSON.stringify({ preset: "zen-free", presets: { "zen-free": { orchestrator: { model: "test/model" } } } });
      }
      if (name === "oh-my-opencode.schema.json") {
        return '{"$schema":"test"}';
      }
      return null;
    });

    await runInit();

    expect(downloadFile).toHaveBeenCalledWith(
      expect.stringContaining("oh-my-opencode-slim.schema.json"),
      "/cache/schema",
      "oh-my-opencode-slim.schema.json",
      { source: "github" }
    );
    expect(mockSpinner.succeed).toHaveBeenCalled();
  });

  it("uses bundled slim schema when GitHub download fails in slim mode", async () => {
    vi.spyOn(SettingsManager.prototype, "getEffectiveType").mockReturnValue("slim");
    vi.mocked(downloadFile).mockImplementation(async (_url: string, _dir: string, fileName: string) => {
      if (fileName === "oh-my-opencode-slim.schema.json") {
        throw new Error("Network error");
      }
      return true;
    });
    vi.mocked(readBundledAsset).mockImplementation((name: string) => {
      if (name === "default-template-slim.json") {
        return JSON.stringify({ preset: "zen-free", presets: {} });
      }
      if (name === "oh-my-opencode-slim.schema.json") {
        return '{"$schema":"test-slim"}';
      }
      if (name === "oh-my-opencode.schema.json") {
        return '{"$schema":"test"}';
      }
      return null;
    });

    await runInit();

    expect(mockSpinner.warn).toHaveBeenCalled();
    expect(mockSpinner.succeed).toHaveBeenCalled();
  });

  it("skips slim profile creation when config already exists", async () => {
    vi.spyOn(SettingsManager.prototype, "getEffectiveType").mockReturnValue("slim");
    vi.spyOn(OmosConfigManager.prototype, "configExists").mockReturnValue(true);
    vi.spyOn(OmosConfigManager.prototype, "getTargetPath").mockReturnValue("/config/opencode/oh-my-opencode-slim.json");

    await runInit();

    expect(mockSpinner.info).toHaveBeenCalledWith(expect.stringContaining("Using existing config"));
    expect(mockSpinner.succeed).toHaveBeenCalled();
  });

  it("fails when no slim template is available", async () => {
    vi.spyOn(SettingsManager.prototype, "getEffectiveType").mockReturnValue("slim");
    vi.mocked(readBundledAsset).mockImplementation((name: string) => {
      if (name === "oh-my-opencode.schema.json") {
        return '{"$schema":"test"}';
      }
      return null;
    });

    await runInit();

    expect(mockSpinner.fail).toHaveBeenCalledWith(expect.stringContaining("Default slim template not found"));
  });
});
