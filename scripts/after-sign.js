/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * electron-builder afterSign hook — ad-hoc code signing for macOS.
 *
 * electron-updater's ShipIt process validates code signatures when applying
 * updates. Without a valid signature the update fails with:
 *   "Code signature did not pass validation: 代码未能满足指定的代码要求"
 *
 * The previous approach used `codesign --force --deep -s -`, but --deep is
 * unreliable: it does not guarantee correct signing order and may miss nested
 * components, causing kSecCSStrictValidate failures.
 *
 * This script signs each component individually from the inside out:
 *   1. All native binaries (.node, .dylib, .so)
 *   2. All Frameworks (*.framework)
 *   3. All Helper apps (*.app inside Frameworks/)
 *   4. The main .app bundle
 *
 * Runs in the afterSign hook so it executes AFTER electron-builder's own
 * signing step (which is a no-op with CSC_IDENTITY_AUTO_DISCOVERY=false)
 * and right before DMG/ZIP artifact creation.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Ad-hoc sign a single path. Failures are logged but non-fatal to avoid
 * breaking builds on edge-case binaries (e.g. debug symbols).
 */
function codesign(targetPath) {
  try {
    execSync(`codesign --force --sign - "${targetPath}"`, {
      stdio: 'pipe',
      timeout: 30000,
    });
  } catch (err) {
    console.warn(`[afterSign] Failed to sign ${targetPath}: ${err.message}`);
  }
}

/**
 * Recursively collect all files matching the given extensions.
 */
function collectFiles(dir, extensions) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Don't descend into .app or .framework bundles — they are signed as a unit
      if (entry.name.endsWith('.app') || entry.name.endsWith('.framework')) {
        continue;
      }
      results.push(...collectFiles(fullPath, extensions));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (extensions.includes(ext)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

/**
 * Collect bundle directories (.app, .framework) at a given depth.
 */
function collectBundles(dir, extension) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.endsWith(extension)) {
      results.push(path.join(dir, entry.name));
    }
  }
  return results;
}

module.exports = async function afterSign(context) {
  const platform = context.packager.platform.name;
  if (platform !== 'mac') return;

  const appOutDir = context.appOutDir;
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  if (!fs.existsSync(appPath)) {
    console.warn(`[afterSign] macOS app not found at ${appPath}, skipping ad-hoc signing`);
    return;
  }

  console.log(`[afterSign] Ad-hoc signing ${appPath} (individual component signing)...`);

  const contentsPath = path.join(appPath, 'Contents');
  const frameworksPath = path.join(contentsPath, 'Frameworks');
  let signed = 0;

  // ── Step 1: Sign all native binaries (.node, .dylib, .so) ─────────────
  // These are the innermost signable items. Must be signed before their
  // enclosing bundles.
  const nativeBinaries = collectFiles(contentsPath, ['.node', '.dylib', '.so']);
  for (const bin of nativeBinaries) {
    codesign(bin);
    signed++;
  }
  if (nativeBinaries.length > 0) {
    console.log(`[afterSign]   Signed ${nativeBinaries.length} native binaries (.node/.dylib/.so)`);
  }

  // ── Step 2: Sign all Frameworks ───────────────────────────────────────
  // Frameworks contain nested code that was already signed in step 1 (if any
  // .dylib/.so lived outside the framework) or that --sign covers here.
  const frameworks = collectBundles(frameworksPath, '.framework');
  for (const fw of frameworks) {
    codesign(fw);
    signed++;
  }
  if (frameworks.length > 0) {
    console.log(`[afterSign]   Signed ${frameworks.length} frameworks`);
  }

  // ── Step 3: Sign all Helper apps ──────────────────────────────────────
  // Electron ships multiple helper apps (GPU, Plugin, Renderer, etc.)
  const helperApps = collectBundles(frameworksPath, '.app');
  for (const helper of helperApps) {
    codesign(helper);
    signed++;
  }
  if (helperApps.length > 0) {
    console.log(`[afterSign]   Signed ${helperApps.length} helper apps`);
  }

  // ── Step 4: Sign the main app bundle ──────────────────────────────────
  codesign(appPath);
  signed++;

  console.log(`[afterSign] Ad-hoc signing complete — ${signed} components signed`);

  // ── Verify ────────────────────────────────────────────────────────────
  try {
    execSync(`codesign --verify --strict "${appPath}"`, {
      stdio: 'pipe',
      timeout: 30000,
    });
    console.log('[afterSign] Signature verification passed (--strict)');
  } catch (err) {
    console.error('[afterSign] WARNING: Signature verification FAILED:', err.stderr?.toString() || err.message);
  }
};
