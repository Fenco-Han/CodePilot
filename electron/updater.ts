// =============================================================================
// Native auto-updater (electron-updater) — DISABLED
//
// Temporarily disabled due to macOS code signature validation failures with
// ad-hoc signing. Users are directed to download from GitHub Releases instead.
// The browser-mode update check (via /api/app/updates) remains active in the
// frontend to notify users of new versions.
//
// TODO: Re-enable after obtaining an Apple Developer certificate for proper
// code signing, then uncomment this file and the calls in main.ts / preload.ts.
// =============================================================================

// import { autoUpdater } from 'electron-updater';
import type { BrowserWindow } from 'electron';
// import { ipcMain, session } from 'electron';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function initAutoUpdater(_win: BrowserWindow) {
  console.log('[updater] Native auto-updater is disabled. Users should download updates from GitHub Releases.');
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function setUpdaterWindow(_win: BrowserWindow) {
  // no-op while native updater is disabled
}
