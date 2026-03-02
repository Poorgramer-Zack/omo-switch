import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockProcessExit } from "../test-setup";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("ora", () => {
  let mockSpinner: any = {
    start: vi.fn(function(this: any) { this.running = true; return this; }),
    text: "",
    succeed: vi.fn(function(this: any) { this.running = false; return this; }),
    fail: vi.fn(function(this: any) { this.running = false; return this; }),
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
  },
}));

vi.mock("../store", async () => {
  const actual = await vi.importActual<typeof import("../store")>("../store");
  return {
    ...actual,
  };
});
vi.mock("../utils/downloader", () => ({
  downloadFile: vi.fn(),
  readBundledAsset: vi.fn(),
}));

vi.mock("../utils/scope-resolver", () => ({
  findProjectRoot: vi.fn(),
}));
import { downloadFile, readBundledAsset } from "../utils/downloader";
import { findProjectRoot } from "../utils/scope-resolver";
import * as fs from "fs";
import ora from "ora";
import chalk from "chalk";
import { StoreManager } from "../store";
import { downloadFile, readBundledAsset } from "../utils/downloader";
describe("schemaCommand", () => {
  let store: StoreManager;
  let mockSpinner: any;
  let schemaCommand: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    store = new StoreManager();
    mockProcessExit();

    // Dynamic import to ensure fresh module state
    const mod = await import("./schema");
    vi.mocked(fs.readFileSync).mockReturnValue("{}");
    vi.mocked(findProjectRoot).mockReturnValue(null);
    schemaCommand = mod.schemaCommand;

    mockSpinner = vi.mocked(ora)();

    vi.spyOn(StoreManager.prototype, "ensureDirectories");
    vi.spyOn(StoreManager.prototype, "getCacheSchemaPath").mockReturnValue("/cache/schema");
    vi.spyOn(StoreManager.prototype, "saveCacheFile");
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      const s = String(p || "");
      if (s.includes("oh-my-opencode.schema.json")) return false;
      if (s.includes("oh-my-opencode-slim.schema.json")) return false;
      return false;
    });
    vi.mocked(downloadFile).mockResolvedValue(true);
    vi.mocked(readBundledAsset).mockImplementation((name: string) => {
      if (name === "oh-my-opencode.schema.json") {
        return '{"$schema":"bundled"}';
      }
      return null;
    });
    vi.mocked(fs.existsSync).mockReturnValue(false);

    mockSpinner.start.mockClear();
    mockSpinner.succeed.mockClear();
    mockSpinner.fail.mockClear();
  });

  async function runSchemaRefresh(opts: { offline?: boolean } = {}) {
    const refreshCmd = schemaCommand.commands[0] as any;
    // Setup the command as Commander.js would after parsing
    refreshCmd._optionValues = {
      offline: opts.offline ?? false,
    };
    refreshCmd._optionValueSources = {};
    refreshCmd.processedArgs = [];
    // Call the internal action handler
    await refreshCmd._actionHandler(refreshCmd.processedArgs);
  }
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      const s = String(p || "");
      if (s.includes("oh-my-opencode.schema.json")) return true;
      return false;
    });
  it("refreshes schema from GitHub", async () => {
    await runSchemaRefresh({ offline: false });

    expect(downloadFile).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json",
      "/cache/schema",
      "oh-my-opencode.schema.json",
      { source: "github" }
    );
  });

  it("uses cached schema when offline mode and cache exists", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    await runSchemaRefresh({ offline: true });

    expect(downloadFile).not.toHaveBeenCalled();
    expect(readBundledAsset).not.toHaveBeenCalled();
    expect(chalk.gray).toHaveBeenCalledWith(expect.stringContaining("Path:"));
  });

  it("uses bundled schema when offline mode and no cache", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    await runSchemaRefresh({ offline: true });

    expect(downloadFile).not.toHaveBeenCalled();
    expect(readBundledAsset).toHaveBeenCalledWith("oh-my-opencode.schema.json");
    expect(StoreManager.prototype.saveCacheFile).toHaveBeenCalled();
  });

  it("exits when offline mode and no bundled schema available", async () => {
    vi.mocked(readBundledAsset).mockReturnValue(null);
    vi.mocked(fs.existsSync).mockReturnValue(false);

    try {
      await runSchemaRefresh({ offline: true });
    } catch (e: any) {
      if (!e.message.includes("process.exit")) throw e;
    }

    expect(mockSpinner.fail).toHaveBeenCalledWith(expect.stringContaining("No bundled schema"));
  });

  it("fails on network error in online mode", async () => {
    vi.mocked(downloadFile).mockRejectedValue(new Error("Network error"));
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      const s = String(p || "");
      if (s.includes("oh-my-opencode.schema.json")) return true;
      return false;
    });
    try {
      await runSchemaRefresh({ offline: false });
    } catch (e: any) {
      if (!e.message.includes("process.exit")) throw e;
    }

    expect(mockSpinner.fail).toHaveBeenCalled();
  });

  it("creates store directories before operations", async () => {
    await runSchemaRefresh({ offline: true });

    expect(StoreManager.prototype.ensureDirectories).toHaveBeenCalled();
  });

  it("shows success message with schema path", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    await runSchemaRefresh({ offline: true });

    expect(mockSpinner.succeed).toHaveBeenCalled();
  });

  it("shows URL when downloading from GitHub", async () => {
    await runSchemaRefresh({ offline: false });

    expect(mockSpinner.succeed).toHaveBeenCalled();
  });
});
