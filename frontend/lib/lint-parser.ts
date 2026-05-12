export interface ParsedLintError {
  line: number | null;
  column: number | null;
  message: string;
  hint?: string;
}

export function parseLintOutput(stdout: string, stderr: string): ParsedLintError[] {
  // Prefer stderr for error messages; stdout may contain diagnostic info
  const combined = [stderr, stdout].filter(Boolean).join('\n');
  if (!combined.trim()) return [];

  const errors: ParsedLintError[] = [];

  // Format 1: /path/to/file.py:LINE:COL: ErrorType: message
  const fileColRe = /[\w/.\-]+\.py:(\d+):(\d+):\s*([^\n]+)/g;
  let m: RegExpExecArray | null;
  while ((m = fileColRe.exec(combined)) !== null) {
    errors.push({
      line: parseInt(m[1], 10),
      column: parseInt(m[2], 10),
      message: m[3].trim(),
      hint: getHint(m[3]),
    });
  }
  if (errors.length > 0) return errors;

  // Format 2: Python traceback — File "...", line N  +  error on last line
  const traceLineMatch = /line (\d+)/.exec(combined);
  const textLines = combined.split('\n').map((l) => l.trim()).filter(Boolean);
  const lastLine = textLines[textLines.length - 1] ?? '';

  errors.push({
    line: traceLineMatch ? parseInt(traceLineMatch[1], 10) : null,
    column: null,
    message: lastLine || 'Lint failed — see raw output below',
    hint: getHint(combined),
  });

  return errors;
}

function getHint(text: string): string | undefined {
  const lower = text.toLowerCase();
  if (lower.includes('unexpected indent') || lower.includes('indentationerror')) {
    return 'Hidden spaces or mixed indentation detected. Click "Format Code" in the editor, then lint again.';
  }
  if (lower.includes('invalid syntax') || lower.includes('syntaxerror')) {
    return 'Check for missing colons, brackets, or mismatched quotes near this line.';
  }
  if (lower.includes('non-breaking') || lower.includes(' ')) {
    return 'Non-breaking spaces detected. Click "Format Code" to remove them.';
  }
  if (lower.includes('not defined') && lower.includes('nameerror')) {
    return 'Make sure all variables and imports are defined before use.';
  }
  if (lower.includes('timed out') || lower.includes('sdk')) {
    return 'GenVM SDK may be unavailable. Try again in a moment.';
  }
  return undefined;
}
