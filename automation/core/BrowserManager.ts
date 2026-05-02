import puppeteer, { Browser, Page } from "puppeteer-core";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

function getChromePath(): string {
  // Allow override via env
  if (process.env.CHROME_PATH) {
    return process.env.CHROME_PATH;
  }

  switch (process.platform) {
    case "darwin":
      return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

    case "win32": {
      const candidates = [
        path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      ];
      const found = candidates.find((p) => fs.existsSync(p));
      if (found) return found;
      throw new Error("Chrome not found. Set CHROME_PATH env variable.");
    }

    case "linux": {
      const candidates = [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
      ];
      const found = candidates.find((p) => fs.existsSync(p));
      if (found) return found;
      throw new Error("Chrome not found. Set CHROME_PATH env variable.");
    }

    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

export class BrowserManager {
  private browser: Browser | null = null;

  async launch(profileDir: string): Promise<{ browser: Browser; page: Page }> {
    // Ensure profile directory exists
    if (!fs.existsSync(profileDir)) {
      fs.mkdirSync(profileDir, { recursive: true });
    }

    // Clean up orphan Chrome instances still holding this profile. After a
    // failed job the runner disconnects (instead of closing) so the user can
    // inspect; if we don't clear that orphan here, the NEW launch either
    // attaches to the stale Chrome or starts a degraded sibling process that
    // manifests as "Execution context was destroyed" errors mid-run.
    await this.killOrphanChrome(profileDir);
    this.removeSingletonLocks(profileDir);

    this.browser = await puppeteer.launch({
      headless: false,
      executablePath: getChromePath(),
      userDataDir: profileDir,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--start-maximized",
        "--disable-popup-blocking",
        "--disable-features=ChromeRuntimeRecognizedBlocking",
        // Hide automation signals so Google Accounts / Gmail / anti-bot DOM
        // checks don't reject the session when the runner opens a Gmail tab
        // for OTP fetching. Works in tandem with ignoreDefaultArgs below.
        "--disable-blink-features=AutomationControlled",
      ],
      ignoreDefaultArgs: ["--enable-automation"],
      defaultViewport: null,
      // Don't let Puppeteer tear Chrome down when the Node runner receives
      // a signal or exits — we manage the browser lifecycle ourselves so we
      // can leave Chrome open on errors for the user to inspect.
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });

    const page = await this.browser.newPage();
    return { browser: this.browser, page };
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Detach the Puppeteer client from Chrome without killing the Chrome
   * process. The user keeps seeing their tabs and can continue manually.
   * The next call to launch() on this same profile will forcibly kill the
   * orphaned Chrome so it doesn't interfere.
   */
  async disconnect(): Promise<void> {
    if (this.browser) {
      try { await this.browser.disconnect(); } catch { /* ignore */ }
      this.browser = null;
    }
  }

  /**
   * Kill any running Chrome process whose command-line contains the profile
   * directory path — but ONLY if the profile is currently held by a live
   * Chrome that's actually running with this profile dir. We detect that
   * via Chrome's own SingletonLock symlink (target format: `<hostname>-<pid>`)
   * and verify the recorded PID is BOTH alive AND owns a Chrome process
   * whose command line references this profile dir.
   *
   * The PID-only check (process.kill(pid, 0)) is too permissive — Linux
   * recycles PIDs aggressively, so a stale lock left behind by a crashed
   * Chrome routinely points at a recycled PID held by something completely
   * unrelated (PM2 daemon, mongod, …). Cross-checking the cmdline avoids
   * the false-positive "profile in use" error that locks users out of
   * their own profiles after PM2 restarts.
   */
  private async killOrphanChrome(profileDir: string): Promise<void> {
    const abs = path.resolve(profileDir);

    // 1. Check the SingletonLock for a live owner.
    const lockPath = path.join(abs, "SingletonLock");
    try {
      const target = fs.readlinkSync(lockPath);
      const m = target.match(/-(\d+)$/);
      if (m) {
        const pid = parseInt(m[1], 10);
        if (Number.isFinite(pid) && this.isOwnedByChromeWithProfile(pid, abs)) {
          throw new Error(
            `Chrome profile "${path.basename(abs)}" is already in use by another running job (PID ${pid}). ` +
            `Pick a different Chrome profile for this job, or wait for the running one to finish.`
          );
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EINVAL") {
        // No lock or not a symlink — no live owner, safe to continue.
      } else if (err instanceof Error && err.message.includes("already in use")) {
        throw err; // bubble our user-facing message
      }
      // Other read errors (EACCES etc.) — fall through and try to clean up.
    }

    // 2. No live owner. Reap any orphan Chrome processes.
    try {
      if (process.platform === "win32") {
        const escaped = abs.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        execSync(
          `wmic process where "CommandLine like '%%${escaped}%%'" delete`,
          { stdio: "ignore" }
        );
      } else {
        execSync(`pkill -f ${JSON.stringify(abs)}`, { stdio: "ignore" });
      }
      await new Promise((r) => setTimeout(r, 500));
    } catch {
      // No orphan process matched — that's fine.
    }
  }

  /**
   * Returns true iff the PID is alive AND its command line shows it's a
   * Chrome process running with the given profile directory. Anything else
   * (PID dead, PID recycled by an unrelated process, can't read cmdline)
   * returns false — meaning the SingletonLock is stale and we can clean it.
   */
  private isOwnedByChromeWithProfile(pid: number, profileDir: string): boolean {
    try {
      let cmdline: string;
      if (process.platform === "linux") {
        // /proc/<pid>/cmdline is NUL-delimited; replace with spaces for matching.
        cmdline = fs
          .readFileSync(`/proc/${pid}/cmdline`, "utf-8")
          .replace(/\0/g, " ");
      } else if (process.platform === "win32") {
        cmdline = execSync(
          `wmic process where ProcessId=${pid} get CommandLine /FORMAT:LIST`,
          { stdio: ["ignore", "pipe", "ignore"] }
        ).toString();
      } else {
        // macOS and other Unix variants — best-effort via ps.
        cmdline = execSync(`ps -p ${pid} -o command=`, {
          stdio: ["ignore", "pipe", "ignore"],
        }).toString();
      }
      const lower = cmdline.toLowerCase();
      return lower.includes("chrome") && cmdline.includes(profileDir);
    } catch {
      // Process gone, no permission, or unable to read cmdline — treat as
      // stale lock so the launch can proceed and clean up.
      return false;
    }
  }

  /**
   * Delete Chrome's singleton-instance lock files from the profile dir so a
   * fresh launch isn't blocked by leftovers from a previous (possibly
   * crashed) Chrome process.
   */
  private removeSingletonLocks(profileDir: string): void {
    for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
      const p = path.join(profileDir, name);
      try {
        // Some of these are symlinks — use lstat/unlink instead of existsSync.
        fs.lstatSync(p);
        fs.unlinkSync(p);
      } catch { /* file missing / not accessible — fine */ }
    }
  }
}
