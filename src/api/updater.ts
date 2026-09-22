/**
 * updater.ts — Typed wrappers around Tauri v2 Official Updater plugin.
 */
import { check, Update, DownloadEvent } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  version?: string;
  body?: string;
  date?: string;
  rawUpdate?: Update;
}

export async function getAppVersion(): Promise<string> {
  try {
    return await getVersion();
  } catch {
    return "0.2.0";
  }
}

export async function checkAppUpdate(): Promise<UpdateInfo> {
  try {
    const update = await check();
    const currentVer = await getAppVersion();
    if (update) {
      return {
        available: true,
        currentVersion: update.currentVersion || currentVer,
        version: update.version,
        body: update.body,
        date: update.date,
        rawUpdate: update,
      };
    }
    return {
      available: false,
      currentVersion: currentVer,
    };
  } catch (err) {
    console.warn("Update check failed:", err);
    throw err;
  }
}

export async function downloadAndInstallUpdate(
  update: Update,
  onProgress?: (downloaded: number, total: number) => void
): Promise<void> {
  let totalLength = 0;
  let downloadedBytes = 0;

  await update.downloadAndInstall((event: DownloadEvent) => {
    if (event.event === "Started") {
      totalLength = event.data.contentLength ?? 0;
      onProgress?.(0, totalLength);
    } else if (event.event === "Progress") {
      downloadedBytes += event.data.chunkLength;
      onProgress?.(downloadedBytes, totalLength);
    } else if (event.event === "Finished") {
      onProgress?.(totalLength, totalLength);
    }
  });
}
