import { beforeEach, describe, expect, it, vi } from "vitest";

// IMPORTANT: module-level mock must be hoisted before importing the module under test
vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  copyFileSync: vi.fn(),
}));

import * as fs from "fs";
import { StoreManager } from "./index";
import { STORE_VERSION } from "./types";

describe("StoreManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("ensureDirectories", () => {
    it("creates missing directories", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const store = new StoreManager();
      store.ensureDirectories();

      expect(fs.mkdirSync).toHaveBeenCalled();
      // All mkdir calls should be recursive
      for (const call of vi.mocked(fs.mkdirSync).mock.calls) {
        expect(call[1]).toEqual({ recursive: true });
      }
    });

    it("does not create directories when they already exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const store = new StoreManager();
      store.ensureDirectories();

      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });
  });

  describe("loadIndex/saveIndex", () => {
    it("returns default index when index.json does not exist", () => {
      const store = new StoreManager();
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        // only index path check matters here
        return p !== store.getIndexPath();
      });

      const index = store.loadIndex();

      expect(index).toEqual({
        storeVersion: STORE_VERSION,
        activeProfileId: null,
        profiles: [],
      });
      expect(fs.readFileSync).not.toHaveBeenCalled();
    });

    it("parses existing index", () => {
      const store = new StoreManager();
      const existingIndex = {
        storeVersion: STORE_VERSION,
        activeProfileId: "test-profile",
        profiles: [
          {
            id: "test-profile",
            name: "Test Profile",
            config: {},
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
        ],
      };
      vi.mocked(fs.existsSync).mockImplementation((p) => p === store.getIndexPath());
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingIndex));

      const index = store.loadIndex();

      expect(index).toEqual(existingIndex);
      expect(fs.readFileSync).toHaveBeenCalledWith(store.getIndexPath(), "utf-8");
    });

    it("writes index to file", () => {
      const store = new StoreManager();
      const index = {
        storeVersion: STORE_VERSION,
        activeProfileId: "test",
        profiles: [],
      };

      store.saveIndex(index);

      expect(fs.writeFileSync).toHaveBeenCalledWith(store.getIndexPath(), JSON.stringify(index, null, 2), "utf-8");
    });
  });

   describe("profile config read/write", () => {
    it("prefers jsonc over json when resolving config path", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const store = new StoreManager();
      const result = store.getProfileConfigPath("test");

      expect(result).toBeTruthy();
      expect(result).toContain(".jsonc");
    });

    it("returns null when neither jsonc nor json exists", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const store = new StoreManager();
      expect(store.getProfileConfigPath("test")).toBeNull();
    });

    it("returns parsed config when profile exists", () => {
      const store = new StoreManager();
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ a: 1 }));

      expect(store.getProfileConfig("test")).toEqual({ a: 1 });
      expect(fs.readFileSync).toHaveBeenCalled();
    });

  it("returns raw config content and path", () => {
      const store = new StoreManager();
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('{ "a": 1 }');

      const result = store.getProfileConfigRaw("test");
      expect(result).toBeTruthy();
      expect(result.content).toBe('{ "a": 1 }');
      expect(fs.readFileSync).toHaveBeenCalled();
    });

  it("saves raw config with requested extension", () => {
      const store = new StoreManager();

      store.saveProfileConfigRaw("test", "{}", ".jsonc");
      expect(fs.writeFileSync).toHaveBeenCalled();
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      expect(writeCall[0]).toContain("test.jsonc");
      expect(writeCall[1]).toBe("{}");
      expect(writeCall[2]).toBe("utf-8");
    });
  });

  describe("createBackup", () => {
    it("returns null when source file does not exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const store = new StoreManager();

      expect(store.createBackup("/missing.json")).toBeNull();
      expect(fs.copyFileSync).not.toHaveBeenCalled();
    });

    it("copies file to backups folder with timestamp prefix", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const store = new StoreManager();

      const backupPath = store.createBackup("/test/oh-my-openagent.json");

      expect(backupPath).toBeTruthy();
      expect(backupPath).toContain("oh-my-openagent.json");
      expect(fs.copyFileSync).toHaveBeenCalled();
    });
  });

  describe("saveCacheFile", () => {
  it("writes cache content and meta.json", () => {
      const store = new StoreManager();

      store.saveCacheFile("/cache", "schema.json", "content", { source: "github" });

      const calls = vi.mocked(fs.writeFileSync).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(2);
      
      const firstCall = calls.find((call: any) => call[0]?.includes("schema.json"));
      expect(firstCall).toBeTruthy();
      expect(firstCall[1]).toBe("content");
      expect(firstCall[2]).toBe("utf-8");

      const secondCall = calls.find((call: any) => call[0]?.includes("meta.json"));
      expect(secondCall).toBeTruthy();
      expect(secondCall[0]).toContain("meta.json");
      expect(secondCall[1]).toContain("updatedAt");
    });
  });

  describe("syncProfiles", () => {
    it("adds orphaned config files to index and persists", () => {
      const store = new StoreManager();
      const existingIndex = { storeVersion: STORE_VERSION, activeProfileId: null, profiles: [] };

      vi.mocked(fs.existsSync).mockImplementation((p) => p === store.getIndexPath() || p === store.getConfigsPath());
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingIndex));
      vi.mocked(fs.readdirSync).mockReturnValue(["orphan.json"]);

      const result = store.syncProfiles();

      expect(result.added).toEqual(["orphan"]);
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it("does not persist when no new profiles are found", () => {
      const store = new StoreManager();
      const existingIndex = {
        storeVersion: STORE_VERSION,
        activeProfileId: null,
        profiles: [{ id: "existing", name: "Existing", config: {}, createdAt: "2024-01-01", updatedAt: "2024-01-01" }],
      };

      vi.mocked(fs.existsSync).mockImplementation((p) => p === store.getIndexPath() || p === store.getConfigsPath());
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingIndex));
      vi.mocked(fs.readdirSync).mockReturnValue(["existing.json"]);

      const result = store.syncProfiles();

      expect(result.added).toEqual([]);
      expect(result.existing).toEqual(["existing"]);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });
});
