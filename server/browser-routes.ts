import express from "express";
import { execa } from "execa";
import { browserBaseArgs, getBrowserEnv, PROFILE_DIR } from "./browser/config.js";

interface BrowserStatus {
  installed: boolean;
  cliVersion: string | null;
  chromeVersion: string | null;
  raw?: string;
}

async function getStatus(): Promise<BrowserStatus> {
  try {
    const r = await execa("agent-browser", ["doctor"], {
      preferLocal: true,
      timeout: 15_000,
      reject: false,
    });
    const raw = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
    const cliMatch = raw.match(/CLI version\s+([\d.]+)/);
    const chromeMatch = raw.match(/Google Chrome for Testing\s+([\d.]+)/);
    return {
      installed: Boolean(chromeMatch),
      cliVersion: cliMatch?.[1] ?? null,
      chromeVersion: chromeMatch?.[1] ?? null,
    };
  } catch (err) {
    return {
      installed: false,
      cliVersion: null,
      chromeVersion: null,
      raw: err instanceof Error ? err.message : String(err),
    };
  }
}

export function createBrowserRouter(): express.Router {
  const router = express.Router();

  router.get("/status", async (_req, res) => {
    res.json(await getStatus());
  });

  router.post("/install", async (_req, res) => {
    // Chrome for Testing is ~150MB. Bound at 5min — covers slow connections
    // without leaving the request hanging forever if something is wedged.
    try {
      const r = await execa("agent-browser", ["install"], {
        preferLocal: true,
        timeout: 5 * 60_000,
        reject: false,
      });
      const after = await getStatus();
      res.json({
        ok: r.exitCode === 0 && after.installed,
        exitCode: r.exitCode,
        output: `${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim().slice(-4000),
        status: after,
      });
    } catch (err) {
      res
        .status(500)
        .json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/login", async (req, res) => {
    const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    if (!url) {
      res.status(400).json({ error: "url required" });
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      res.status(400).json({ error: "invalid url" });
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      res.status(400).json({ error: "url must be http(s)" });
      return;
    }
    // Fire and forget — `agent-browser open` returns once navigation completes
    // (a few seconds), but the Chrome window stays open for the user to log in.
    // We wait briefly to surface any immediate launch errors, then return.
    const child = execa("agent-browser", [...browserBaseArgs(), "open", parsed.toString()], {
      preferLocal: true,
      timeout: 30_000,
      reject: false,
      env: await getBrowserEnv(),
    });
    child.catch((err) => console.error("[browser-login] post-launch error", err));
    res.json({ ok: true, url: parsed.toString(), profile: PROFILE_DIR });
  });

  return router;
}
