import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  copyFileSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock("../utils/scope-resolver", () => ({
  getProjectConfigsPath: vi.fn((root: string) => `${root}/.opencode/omo-configs`),
  getProjectTargetPath: vi.fn((root: string) => `${root}/.opencode/oh-my-openagent.jsonc`),
  getProjectRcPath: vi.fn((root: string) => `${root}/.opencode/.omorc`),
  loadProjectRc: vi.fn(() => null),
  saveProjectRc: vi.fn(),
  ensureProjectDirs: vi.fn(),
}));

import * as fs from "fs";
import * as path from "path";
import { ProjectStoreManager } from "./project-store";
import { saveProjectRc } from "../utils/scope-resolver";

describe("ProjectStoreManager", () => {
  const projectRoot = "/test/project";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("wires paths via scope-resolver", () => {
      const store = new ProjectStoreManager(projectRoot);
      expect(store.getProjectRoot()).toBe(projectRoot);
      expect(store.getConfigsPath()).toContain(".opencode");
      expect(store.getConfigsPath()).toContain("omo-configs");
      expect(store.getTargetPath()).toContain(".opencode");
      expect(store.getTargetPath()).toContain("oh-my-openagent");
      expect(store.getTargetPath()).toContain(".jsonc");
      expect(store.getRcPath()).toContain(".opencode");
      expect(store.getRcPath()).toContain(".omorc");
    });
  });

  describe("ensureDirectories", () => {
    it("ensures project dirs and creates backups folder", () => {
      const store = new ProjectStoreManager(projectRoot);
      const backupsPath = path.join(projectRoot, ".opencode", "backups");

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return false;
      });

      store.ensureDirectories();

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringMatching(/backups/),
        { recursive: true }
      );
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls.find((call: any) => call[0]?.includes(".gitignore"));
      expect(writeCall?.[0]).toBeTruthy();
      expect(writeCall?.[1]).toContain("backups");
      expect(writeCall?.[2]).toBe("utf-8");
    });

    it("appends backups/ to existing .gitignore if missing", () => {
      const store = new ProjectStoreManager(projectRoot);

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pStr = String(p);
        if (pStr.includes(".gitignore")) return true;
        if (pStr.endsWith("backups")) return false;
        return false;
      });
      vi.mocked(fs.readFileSync).mockReturnValue("node_modules/\n");

      store.ensureDirectories();

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      expect(writeCall[0]).toContain(".gitignore");
      expect(writeCall[1]).toContain("node_modules");
      expect(writeCall[1]).toContain("backups");
      expect(writeCall[2]).toBe("utf-8");
    });

    it("does not rewrite .gitignore when backups already present", () => {
      const store = new ProjectStoreManager(projectRoot);
      const gitignorePath = path.join(projectRoot, ".opencode", ".gitignore");

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (p === gitignorePath) return true;
        if (typeof p === "string" && p.endsWith("/.opencode/backups")) return true;
        return true;
      });
      vi.mocked(fs.readFileSync).mockReturnValue("backups/\n");

      store.ensureDirectories();

      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe("loadRc/saveRc", () => {
    it("delegates to scope-resolver", () => {
      const store = new ProjectStoreManager(projectRoot);
      const spySaveProjectRc = vi.spyOn({ saveProjectRc }, "saveProjectRc");

      store.saveRc({ activeProfileId: "p2" });
      expect(spySaveProjectRc).toHaveBeenCalledWith(projectRoot, { activeProfileId: "p2" });
    });
  });

  describe("getProfileConfigPath/configExists", () => {
    it("prefers jsonc", () => {
      const store = new ProjectStoreManager(projectRoot);

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pStr = String(p);
        return pStr.includes("jsonc") || pStr.includes("json");
      });

      expect(store.getProfileConfigPath("test")).toContain("jsonc");
      expect(store.configExists("test")).toBe(true);
    });

    it("returns null when missing", () => {
      const store = new ProjectStoreManager(projectRoot);
      vi.mocked(fs.existsSync).mockReturnValue(false);

      expect(store.getProfileConfigPath("test")).toBeNull();
      expect(store.configExists("test")).toBe(false);
    });
  });

  describe("getProfileConfigRaw/saveProfileConfigRaw", () => {
    it("reads content and path", () => {
      const store = new ProjectStoreManager(projectRoot);

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pStr = String(p);
        return pStr.includes("json");
      });

      vi.mocked(fs.readFileSync).mockReturnValue('{ "a": 1 }');

      const result = store.getProfileConfigRaw("test");
      expect(result).toEqual({ path: expect.stringMatching(/test\.jsonc$/), content: '{ "a": 1 }' });
    });

    it("writes config and ensures directories first", () => {
      const store = new ProjectStoreManager(projectRoot);

      vi.mocked(fs.existsSync).mockReturnValue(true);

      store.saveProfileConfigRaw("test", "{}", ".jsonc");

      const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
      const configWriteCall = writeCalls.find((call: any) => call[0] && String(call[0]).includes("test.jsonc"));
      expect(configWriteCall?.[0]).toContain(".jsonc");
      expect(configWriteCall?.[1]).toBe("{}");
      expect(configWriteCall?.[2]).toBe("utf-8");
    });
  });

  describe("listProfiles", () => {
    it("returns empty when configs dir missing", () => {
      const store = new ProjectStoreManager(projectRoot);
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(store.listProfiles()).toEqual([]);
    });

    it("lists unique profile ids and prefers jsonc", () => {
      const store = new ProjectStoreManager(projectRoot);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(["a.json", "a.jsonc", "b.json", "README.md"]);

      const result = store.listProfiles().sort();

      expect(result).toEqual(["a", "b"]);
    });
  });

  describe("createBackup", () => {
    it("creates backups dir when missing and copies file", () => {
      const store = new ProjectStoreManager(projectRoot);

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pStr = String(p);
        // Source file exists
        if (pStr.endsWith("oh-my-openagent.json")) return true;
        // Backups dir does NOT exist (so mkdirSync should be called)
        return false;
      });

      const backupPath = store.createBackup("/test/oh-my-openagent.json");

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringMatching(/backups/),
        { recursive: true }
      );
      expect(backupPath).toBeTruthy();
      expect(path.normalize(backupPath!)).toContain("oh-my-openagent.json");
      const copyCall = vi.mocked(fs.copyFileSync).mock.calls[0];
      expect(copyCall).toBeTruthy();
    });
  });

  describe("deleteProfileConfig", () => {
    it("deletes existing config", () => {
      const store = new ProjectStoreManager(projectRoot);

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pStr = String(p);
        return pStr.endsWith("test.json");
      });

      expect(store.deleteProfileConfig("test")).toBe(true);
      expect(fs.unlinkSync).toHaveBeenCalled();
      const unlinkCall = vi.mocked(fs.unlinkSync).mock.calls[0][0];
      expect(path.normalize(unlinkCall)).toContain("test.json");
    });

    it("returns false when config missing", () => {
      const store = new ProjectStoreManager(projectRoot);
      vi.mocked(fs.existsSync).mockReturnValue(false);

      expect(store.deleteProfileConfig("test")).toBe(false);
      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });
  });
});
