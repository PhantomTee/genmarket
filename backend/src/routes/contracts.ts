import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

const router = Router();

const TMP_DIR = process.env.CONTRACT_TMP_DIR ?? path.join(os.tmpdir(), 'genmarket-contracts');

// ---------------------------------------------------------------------------
// Helper: run a command with a timeout, return { code, stdout, stderr }
// ---------------------------------------------------------------------------

function runCommand(
  command: string,
  args: string[],
  timeoutMs = 60_000
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: false, env: process.env });
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: -1, stdout, stderr: stderr + '\nProcess timed out.' });
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

// ---------------------------------------------------------------------------
// POST /api/contracts/lint
// Writes source to a temp file, runs genvm-lint, returns structured result.
// Exit codes: 0=pass, 1=lint errors, 2=missing file, 3=SDK download failure
// ---------------------------------------------------------------------------

router.post('/lint', async (req: Request, res: Response) => {
  try {
    const { sourceCode } = req.body;
    if (!sourceCode || typeof sourceCode !== 'string') {
      return res.status(400).json({ success: false, error: 'sourceCode is required' });
    }

    await fs.mkdir(TMP_DIR, { recursive: true });
    const fileId = crypto.randomUUID();
    const filePath = path.join(TMP_DIR, `${fileId}.py`);

    await fs.writeFile(filePath, sourceCode, 'utf8');

    const result = await runCommand('genvm-lint', [filePath], 60_000);

    // Always clean up — fire-and-forget
    fs.rm(filePath, { force: true }).catch(() => {});

    const passed = result.code === 0;

    return res.json({
      passed,
      exitCode: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      // Friendly summary for the UI
      summary: passed
        ? 'Contract passed GenVM lint ✓'
        : result.code === 2
          ? 'Lint failed: contract file could not be read'
          : result.code === 3
            ? 'Lint failed: SDK artifact download error — try again'
            : 'Contract failed GenVM lint — see errors below',
    });
  } catch (err: any) {
    console.error('POST /contracts/lint error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
