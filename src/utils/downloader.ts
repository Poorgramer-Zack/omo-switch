import * as https from "https";
import * as http from "http";
import * as fs from "fs";
import * as path from "path";

/**
 * Download the resource at `url`, write it to `cacheDir/fileName`, and write metadata to `cacheDir/meta.json`.
 *
 * @param url - The HTTP(S) URL to download.
 * @param cacheDir - Directory where the downloaded file and `meta.json` will be written.
 * @param fileName - Filename to use for the downloaded content.
 * @param meta - Additional properties to include in `meta.json`; an `updatedAt` timestamp is added automatically.
 * @returns `true` if the file and metadata were written successfully.
 * @throws Error when the HTTP response status is not 200, when the request fails, or when writing files fails.
 */
export async function downloadFile(url: string, cacheDir: string, fileName: string, meta: Record<string, unknown> = {}): Promise<boolean> {
  const filePath = path.join(cacheDir, fileName);
  const metaPath = path.join(cacheDir, "meta.json");

  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;

    protocol.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download: HTTP ${res.statusCode}`));
        return;
      }

      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try {
          const content = Buffer.concat(chunks).toString("utf-8");
          fs.writeFileSync(filePath, content, "utf-8");
          fs.writeFileSync(metaPath, JSON.stringify({ ...meta, updatedAt: new Date().toISOString() }, null, 2), "utf-8");
          resolve(true);
        } catch (err) {
          reject(err);
        }
      });
    }).on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Load a bundled asset from the project's shared assets directory.
 *
 * @param relativePath - File path relative to the `shared/assets` directory
 * @returns The file contents as a UTF-8 string if the asset exists, `null` otherwise
 */
export function readBundledAsset(relativePath: string): string | null {
  const projectRoot = path.resolve(__dirname, "../../");
  const assetPath = path.join(projectRoot, "shared", "assets", relativePath);
  if (!fs.existsSync(assetPath)) {
    return null;
  }
  return fs.readFileSync(assetPath, "utf-8");
}
