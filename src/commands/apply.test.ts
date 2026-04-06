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
    green: vi.fn((s: string) => s),
  },
}));

vi.mock("../store", async () => {
  const actual = await vi.importActual<typeof import("../store")>("../store");
  return {
    ...actual,
  };
});

vi.mock("../utils/validator", async () => {
  const actual = await vi.importActual<typeof import("../utils/validator")>("../utils/validator");
  return {
    ...actual,
  };
});

vi.mock("../utils/downloader", () => ({
  downloadFile: vi.fn(),
  readBundledAsset: vi.fn(),
}));

vi.mock("../utils/config-path", () => ({
  getConfigTargetDir: vi.fn(),
  ensureConfigDir: vi.fn(),
  ALL_CONFIG_FILES: ["oh-my-openagent.jsonc", "oh-my-openagent.json", "oh-my-opencode.jsonc", "oh-my-opencode.json"],
}));

vi.mock("../utils/scope-resolver", async () => {
  const actual = await vi.importActual<typeof import("../utils/scope-resolver")>("../utils/scope-resolver");
  return {
    ...actual,
    resolveProjectRoot: vi.fn(() => null),
  };
});

import * as fs from "fs";
import ora from "ora";
import chalk from "chalk";
import { StoreManager, ProjectStoreManager } from "../store";
import { downloadFile, readBundledAsset } from "../utils/downloader";
import { getConfigTargetDir, ensureConfigDir } from "../utils/config-path";
import { resolveProjectRoot } from "../utils/scope-resolver";

describe("applyCommand", () => {
  let store: StoreManager;
  let projectStore: ProjectStoreManager;
  let mockSpinner: any;
  let applyCommand: any;

  async function runApply(identifier: string, opts: { scope?: string } = {}) {
    const cmd = applyCommand as any;
    cmd._optionValues = {};
    cmd._optionValueSources = {};
    if (opts.scope) {
      cmd._optionValues.scope = opts.scope;
      cmd._optionValueSources.scope = 'cli';
    }
    cmd.processedArgs = [identifier];
    await cmd._actionHandler(cmd.processedArgs);
  }

  beforeEach(async () => {
    const mod = await import("./apply");
    applyCommand = mod.applyCommand;
    vi.clearAllMocks();

    store = new StoreManager();
    mockProcessExit();

    mockSpinner = vi.mocked(ora)();

     vi.spyOn(StoreManager.prototype, "syncProfiles").mockReturnValue({ added: [], existing: [] });
     vi.spyOn(StoreManager.prototype, "loadIndex").mockReturnValue({ profiles: [], activeProfileId: null });
     vi.spyOn(StoreManager.prototype, "getProfileConfigRaw").mockReturnValue(null);
     vi.spyOn(StoreManager.prototype, "saveIndex");
     vi.spyOn(StoreManager.prototype, "saveCacheFile");
     vi.spyOn(StoreManager.prototype, "createBackup").mockReturnValue("/backups/backup.json");
      vi.spyOn(StoreManager.prototype, "getCacheSchemaPath").mockReturnValue("/cache/schema");

     projectStore = new ProjectStoreManager("/project");
     vi.spyOn(ProjectStoreManager.prototype, "ensureDirectories");
     vi.spyOn(ProjectStoreManager.prototype, "getProfileConfigRaw").mockReturnValue(null);
     vi.spyOn(ProjectStoreManager.prototype, "listProfiles").mockReturnValue([]);
     vi.spyOn(ProjectStoreManager.prototype, "getTargetPath").mockReturnValue("/project/.opencode/oh-my-openagent.jsonc");
     vi.spyOn(ProjectStoreManager.prototype, "createBackup").mockReturnValue("/project/.opencode/backups/backup.json");
     vi.spyOn(ProjectStoreManager.prototype, "saveRc");

     vi.mocked(resolveProjectRoot).mockReturnValue(null);
     vi.mocked(downloadFile).mockResolvedValue(true);
     vi.mocked(readBundledAsset).mockImplementation((name: string) => {
       if (name === "oh-my-opencode.schema.json") {
         return '{"$schema":"test"}';
       }
       return null;
     });
      vi.mocked(getConfigTargetDir).mockReturnValue({ dir: "/config/opencode", isPreferred: true });
      vi.mocked(ensureConfigDir);
      vi.mocked(fs.existsSync).mockImplementation((path: string) => {
        if (typeof path === "string" && path.includes("oh-my-opencode.schema.json")) {
          return true;
        }
        return false;
      });
      vi.mocked(fs.readFileSync).mockImplementation((path: string) => {
        if (typeof path === "string" && path.includes("oh-my-opencode.schema.json")) {
          return '{"type": "object"}';
        }
        throw new Error("Invalid JSON");
      });
      vi.mocked(fs.writeFileSync);

     mockSpinner.start.mockClear();
     mockSpinner.succeed.mockClear();
     mockSpinner.fail.mockClear();
   });

   it("applies profile to user scope", async () => {
     vi.spyOn(StoreManager.prototype, "loadIndex").mockReturnValue({
       profiles: [
         { id: "test", name: "Test", updatedAt: "2024-01-01T00:00:00.000Z" },
       ],
       activeProfileId: null,
     });
     vi.spyOn(StoreManager.prototype, "getProfileConfigRaw").mockReturnValue({
       path: "/configs/test.json",
       content: '{ "agents": { "build": { "model": "test" } } }',
     });

     try {
       await runApply("test", { scope: "user" });
     } catch (e: any) {
       if (!e.message.includes("process.exit")) throw e;
     }

     expect(mockSpinner.succeed).toHaveBeenCalled();
   });

   it("validates profile before applying", async () => {
     vi.spyOn(StoreManager.prototype, "loadIndex").mockReturnValue({
       profiles: [
         { id: "invalid", name: "Invalid", updatedAt: "2024-01-01T00:00:00.000Z" },
       ],
       activeProfileId: null,
     });
     vi.spyOn(StoreManager.prototype, "getProfileConfigRaw").mockReturnValue({
       path: "/configs/invalid.json",
       content: '{ "invalid": true }',
     });
     vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error("Invalid JSON"); });

     try {
       await runApply("invalid", { scope: "user" });
     } catch (e: any) {
       if (!e.message.includes("process.exit")) throw e;
     }

     expect(mockSpinner.fail).toHaveBeenCalled();
   });

   it("exits when profile not found", async () => {
     vi.spyOn(StoreManager.prototype, "loadIndex").mockReturnValue({
       profiles: [],
       activeProfileId: null,
     });

     try {
       await runApply("missing", { scope: "user" });
     } catch (e: any) {
       if (!e.message.includes("process.exit")) throw e;
     }

     expect(mockSpinner.fail).toHaveBeenCalledWith(expect.stringContaining("not found"));
   });

   it("exits when validation fails", async () => {
     vi.spyOn(StoreManager.prototype, "loadIndex").mockReturnValue({
       profiles: [
         { id: "bad", name: "Bad", updatedAt: "2024-01-01T00:00:00.000Z" },
       ],
       activeProfileId: null,
     });
     vi.spyOn(StoreManager.prototype, "getProfileConfigRaw").mockReturnValue({
       path: "/configs/bad.json",
       content: '{ "bad": true }',
     });
     vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error("Invalid JSON"); });

     try {
       await runApply("bad", { scope: "user" });
     } catch (e: any) {
       if (!e.message.includes("process.exit")) throw e;
     }

     expect(mockSpinner.fail).toHaveBeenCalled();
   });

   it("creates backup before applying", async () => {
     vi.spyOn(StoreManager.prototype, "loadIndex").mockReturnValue({
       profiles: [
         { id: "backup-test", name: "Backup Test", updatedAt: "2024-01-01T00:00:00.000Z" },
       ],
       activeProfileId: null,
     });
     vi.spyOn(StoreManager.prototype, "getProfileConfigRaw").mockReturnValue({
       path: "/configs/backup-test.json",
       content: '{ "backup": true }',
     });
     // Mock existing config file to trigger backup
     vi.mocked(fs.existsSync).mockImplementation((path: string) => {
       if (typeof path === "string") {
         if (path.includes("oh-my-opencode.schema.json")) return true;
         if (path.includes("oh-my-openagent.jsonc")) return true;
       }
       return false;
     });

     try {
       await runApply("backup-test", { scope: "user" });
     } catch (e: any) {
       if (!e.message.includes("process.exit")) throw e;
     }

     expect(StoreManager.prototype.createBackup).toHaveBeenCalled();
   });

   it("applies to project scope", async () => {
     vi.mocked(resolveProjectRoot).mockReturnValue("/project");
     vi.spyOn(ProjectStoreManager.prototype, "listProfiles").mockReturnValue(["project-profile"]);
     vi.spyOn(ProjectStoreManager.prototype, "getProfileConfigRaw").mockReturnValue({
       path: "/project/.opencode/omo-configs/project-profile.json",
       content: '{ "project": true }',
     });
     vi.spyOn(ProjectStoreManager.prototype, "ensureDirectories");
     vi.spyOn(ProjectStoreManager.prototype, "saveRc");
     vi.spyOn(ProjectStoreManager.prototype, "getTargetPath").mockReturnValue("/project/.opencode/oh-my-openagent.jsonc");
     vi.spyOn(ProjectStoreManager.prototype, "createBackup").mockReturnValue("/project/.opencode/backups/backup.json");
     vi.mocked(fs.existsSync).mockImplementation((path: string) => {
       if (typeof path === "string") {
         if (path.includes("oh-my-opencode.schema.json")) return true;
         if (path.includes("oh-my-opencode")) return true;
       }
       return false;
     });
     vi.mocked(fs.readFileSync).mockImplementation((path: string) => {
       if (typeof path === "string" && path.includes("oh-my-opencode.schema.json")) {
         return '{"type": "object"}';
       }
       throw new Error("File not found");
     });

     try {
       await runApply("project-profile", { scope: "project" });
     } catch (e: any) {
       if (!e.message.includes("process.exit")) throw e;
     }

     expect(mockSpinner.succeed).toHaveBeenCalled();
   });

   it("prefers project profile when both scopes available", async () => {
     vi.mocked(resolveProjectRoot).mockReturnValue("/project");
     vi.spyOn(StoreManager.prototype, "loadIndex").mockReturnValue({
       profiles: [
         { id: "same-id", name: "Same ID", updatedAt: "2024-01-01T00:00:00.000Z" },
       ],
       activeProfileId: null,
     });
     vi.spyOn(StoreManager.prototype, "getProfileConfigRaw").mockReturnValue({
       path: "/configs/same-id.json",
       content: '{ "global": true }',
     });
     vi.spyOn(ProjectStoreManager.prototype, "listProfiles").mockReturnValue(["same-id"]);
     vi.spyOn(ProjectStoreManager.prototype, "getProfileConfigRaw").mockReturnValue({
       path: "/project/.opencode/omo-configs/same-id.json",
       content: '{ "project": true }',
     });
     vi.spyOn(ProjectStoreManager.prototype, "ensureDirectories");
     vi.spyOn(ProjectStoreManager.prototype, "saveRc");
     vi.spyOn(ProjectStoreManager.prototype, "getTargetPath").mockReturnValue("/project/.opencode/oh-my-openagent.jsonc");
     vi.spyOn(ProjectStoreManager.prototype, "createBackup").mockReturnValue("/project/.opencode/backups/backup.json");
     vi.mocked(fs.existsSync).mockImplementation((path: string) => {
       if (typeof path === "string") {
         if (path.includes("oh-my-opencode.schema.json")) return true;
         if (path.includes("oh-my-opencode")) return true;
       }
       return false;
     });
     vi.mocked(fs.readFileSync).mockImplementation((path: string) => {
       if (typeof path === "string" && path.includes("oh-my-opencode.schema.json")) {
         return '{"type": "object"}';
       }
       throw new Error("File not found");
     });

     try {
       await runApply("same-id", { scope: "project" });
     } catch (e: any) {
       if (!e.message.includes("process.exit")) throw e;
     }

     // Check that the profile was found and applied successfully
     expect(mockSpinner.succeed).toHaveBeenCalled();
   });

   it("handles JSONC parsing errors", async () => {
     vi.spyOn(StoreManager.prototype, "loadIndex").mockReturnValue({
       profiles: [
         { id: "jsonc-error", name: "JSONC Error", updatedAt: "2024-01-01T00:00:00.000Z" },
       ],
       activeProfileId: null,
     });
     vi.spyOn(StoreManager.prototype, "getProfileConfigRaw").mockReturnValue({
       path: "/configs/jsonc-error.jsonc",
       content: '{ // comment\n "invalid" json }',
     });
     vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error("Invalid JSON"); });

     try {
       await runApply("jsonc-error", { scope: "user" });
     } catch (e: any) {
       if (!e.message.includes("process.exit")) throw e;
     }
   });

   it("uses bundled schema when download fails", async () => {
     vi.spyOn(StoreManager.prototype, "getCacheSchemaPath").mockReturnValue("/cache/schema");
     vi.mocked(downloadFile).mockRejectedValue(new Error("Network error"));
     vi.mocked(readBundledAsset).mockReturnValue('{"$schema":"bundled"}');
     vi.spyOn(StoreManager.prototype, "loadIndex").mockReturnValue({
       profiles: [
         { id: "fallback", name: "Fallback", updatedAt: "2024-01-01T00:00:00.000Z" },
       ],
       activeProfileId: null,
     });
     vi.spyOn(StoreManager.prototype, "getProfileConfigRaw").mockReturnValue({
       path: "/configs/fallback.json",
       content: '{ "fallback": true }',
     });
     // Mock fs to NOT find schema file initially, forcing download attempt
     vi.mocked(fs.existsSync).mockImplementation((path: string) => {
       if (typeof path === "string" && path.includes("oh-my-opencode.schema.json")) {
         return false; // Force fallback to bundled
       }
       return false;
     });
     vi.mocked(fs.readFileSync).mockImplementation((path: string) => {
       throw new Error("File not found");
     });

     try {
       await runApply("fallback", { scope: "user" });
     } catch (e: any) {
       if (!e.message.includes("process.exit")) throw e;
     }

     expect(readBundledAsset).toHaveBeenCalledWith("oh-my-opencode.schema.json");
   });

   it("finds profile by name case-insensitively", async () => {
     vi.spyOn(StoreManager.prototype, "loadIndex").mockReturnValue({
       profiles: [
         { id: "case-test", name: "Case Test", updatedAt: "2024-01-01T00:00:00.000Z" },
       ],
       activeProfileId: null,
     });
     vi.spyOn(StoreManager.prototype, "getProfileConfigRaw").mockReturnValue({
       path: "/configs/case-test.json",
       content: '{ "case": true }',
     });

     try {
       await runApply("case test", { scope: "user" });
     } catch (e: any) {
       if (!e.message.includes("process.exit")) throw e;
     }

     expect(StoreManager.prototype.getProfileConfigRaw).toHaveBeenCalledWith("case-test");
   });
});
