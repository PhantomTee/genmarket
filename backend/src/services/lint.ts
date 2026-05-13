export interface LintItem {
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export interface LintResult {
  errors: LintItem[];
  warnings: LintItem[];
  info: LintItem[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function item(
  severity: LintItem['severity'],
  line: number,
  column: number,
  message: string
): LintItem {
  return { line, column, message, severity };
}

function findLineIndex(lines: string[], predicate: (l: string) => boolean): number {
  return lines.findIndex(predicate) + 1; // 1-based; 0 if not found
}

// Returns all 1-based line numbers where predicate matches
function findAllLines(lines: string[], predicate: (l: string) => boolean): number[] {
  return lines.reduce<number[]>((acc, l, i) => {
    if (predicate(l)) acc.push(i + 1);
    return acc;
  }, []);
}

// Indentation level (number of leading spaces)
function indent(line: string): number {
  return line.match(/^(\s*)/)?.[1].length ?? 0;
}

// ---------------------------------------------------------------------------
// Main lint function
// ---------------------------------------------------------------------------

export function lintContract(code: string): LintResult {
  const errors: LintItem[] = [];
  const warnings: LintItem[] = [];
  const info: LintItem[] = [];
  const lines = code.split('\n');

  // ── ERROR 1: Missing dependency header ────────────────────────────────────
  const firstLine = lines[0]?.trim() ?? '';
  const hasHeader =
    firstLine === '# { "Depends": "py-genlayer:test" }' ||
    /^#\s*\{\s*"Depends"\s*:\s*"py-genlayer:[^"]+"\s*\}$/.test(firstLine);

  if (!hasHeader) {
    errors.push(
      item(
        'error',
        1,
        1,
        'Missing GenLayer dependency header. First line must be # { "Depends": "py-genlayer:test" }'
      )
    );
  }

  // ── Locate contract class(es) ─────────────────────────────────────────────
  const contractClassLines = findAllLines(
    lines,
    (l) => /^\s*class\s+\w+\s*\(\s*gl\.Contract\s*\)/.test(l)
  );

  // ── ERROR 2: Missing contract class ──────────────────────────────────────
  if (contractClassLines.length === 0) {
    errors.push(
      item(
        'error',
        1,
        1,
        'No contract class found. Define a class that extends gl.Contract'
      )
    );
  }

  // ── ERROR 3: Multiple contract classes ───────────────────────────────────
  if (contractClassLines.length > 1) {
    contractClassLines.slice(1).forEach((ln) => {
      errors.push(
        item(
          'error',
          ln,
          1,
          'Only one gl.Contract subclass is allowed per contract file'
        )
      );
    });
  }

  // ── Contract-level checks (only if exactly one class found) ──────────────
  if (contractClassLines.length === 1) {
    const classLine = contractClassLines[0]; // 1-based
    const classIndent = indent(lines[classLine - 1]);

    // Collect lines that belong to this class (indented deeper than the class def)
    const classBodyLines = lines.slice(classLine).filter(
      (l) => l.trim() === '' || indent(l) > classIndent
    );

    // ── ERROR 5: Missing __init__ ────────────────────────────────────────
    const hasInit = classBodyLines.some((l) => /def\s+__init__\s*\(/.test(l));
    if (!hasInit) {
      errors.push(
        item('error', classLine, 1, 'Contract class is missing __init__ method')
      );
    }

    // ── INFO 10: __init__ body is just pass ──────────────────────────────
    if (hasInit) {
      const initIdx = lines.findIndex(
        (l, i) => i >= classLine && /def\s+__init__\s*\(/.test(l)
      );
      if (initIdx !== -1) {
        const initIndent = indent(lines[initIdx]);
        const bodyLines = lines
          .slice(initIdx + 1)
          .filter((l) => l.trim() !== '')
          .filter((l) => indent(l) > initIndent);

        const nonPassBody = bodyLines.filter(
          (l) => l.trim() !== 'pass' && !l.trim().startsWith('#')
        );
        if (nonPassBody.length === 0 && bodyLines.length > 0) {
          info.push(
            item(
              'info',
              initIdx + 2,
              1,
              '__init__ has no state initialization. Add state variables if your contract needs persistent data'
            )
          );
        }
      }
    }

    // ── INFO 9: No @gl.public methods ────────────────────────────────────
    const hasPublicMethods = classBodyLines.some((l) =>
      /@gl\.public\.(view|write)/.test(l)
    );
    if (!hasPublicMethods) {
      info.push(
        item(
          'info',
          classLine,
          1,
          'No public methods found. Add @gl.public.view or @gl.public.write methods to expose contract functionality'
        )
      );
    }

    // ── Per-method checks ────────────────────────────────────────────────
    // Walk through lines looking for @gl.public decorators followed by def
    for (let i = classLine; i < lines.length; i++) {
      const ln = lines[i];
      const lineNo = i + 1; // 1-based

      const isPublicDecorator = /@gl\.public\.(view|write)/.test(ln);
      if (!isPublicDecorator) continue;

      // Find the def line immediately after the decorator (skip blank lines)
      let defIdx = i + 1;
      while (defIdx < lines.length && lines[defIdx].trim() === '') defIdx++;
      if (defIdx >= lines.length) break;

      const defLine = lines[defIdx];
      const defLineNo = defIdx + 1;

      const methodMatch = defLine.match(/def\s+(\w+)\s*\(/);
      if (!methodMatch) continue;
      const methodName = methodMatch[1];
      const methodIndent = indent(defLine);

      // ── WARNING 7: Missing return type annotation ───────────────────
      if (!/\)\s*->\s*\S/.test(defLine)) {
        warnings.push(
          item(
            'warning',
            defLineNo,
            1,
            `Method '${methodName}' is missing a return type annotation`
          )
        );
      }

      // Collect the method body lines (indented deeper than the def)
      const methodBodyStart = defIdx + 1;
      const methodBody: Array<{ lineNo: number; text: string }> = [];
      for (let j = methodBodyStart; j < lines.length; j++) {
        const bl = lines[j];
        if (bl.trim() === '') continue;
        if (indent(bl) <= methodIndent) break;
        methodBody.push({ lineNo: j + 1, text: bl });
      }

      // Detect direct (top-level) vs nested non-det calls
      // Top-level means indented exactly one level deeper than def (not inside a nested def)
      const methodBodyIndent = methodIndent + 4; // expected body indent

      let insideNestedDef = false;
      let nestedDefIndent = -1;
      let nestedHasNonDet = false;
      let methodHasEqPrinciple = false;
      let directNonDetLine = -1;

      for (const { lineNo: bln, text: bl } of methodBody) {
        const stripped = bl.trim();

        // Entering a nested def
        if (/^\s*def\s+/.test(bl) && indent(bl) >= methodBodyIndent) {
          insideNestedDef = true;
          nestedDefIndent = indent(bl);
          continue;
        }

        // Exiting the nested def (back to method body level)
        if (insideNestedDef && indent(bl) <= nestedDefIndent && stripped !== '') {
          insideNestedDef = false;
          nestedDefIndent = -1;
        }

        if (/gl\.eq_principle_/.test(stripped)) {
          methodHasEqPrinciple = true;
        }

        const hasNonDet =
          /gl\.exec_prompt\s*\(/.test(stripped) || /gl\.nondet\b/.test(stripped);

        if (hasNonDet) {
          if (!insideNestedDef && directNonDetLine === -1) {
            directNonDetLine = bln;
          }
          if (insideNestedDef) {
            nestedHasNonDet = true;
          }
        }
      }

      // ── ERROR 4: Direct non-det call outside inner function ──────────
      if (directNonDetLine !== -1) {
        errors.push(
          item(
            'error',
            directNonDetLine,
            1,
            "gl.nondet.exec_prompt() must be called inside an inner function passed to gl.eq_principle.*"
          )
        );
      }

      // ── WARNING 6: Nested non-det but no eq_principle wrapper ────────
      if (nestedHasNonDet && !methodHasEqPrinciple) {
        warnings.push(
          item(
            'warning',
            defLineNo,
            1,
            'Inner function with non-deterministic call found but no gl.eq_principle_* wrapper detected in this method'
          )
        );
      }
    }
  }

  // ── WARNING 8: Hardcoded Ethereum address ─────────────────────────────────
  const ethAddressRe = /\b0x[0-9a-fA-F]{40}\b/g;
  lines.forEach((l, i) => {
    let match: RegExpExecArray | null;
    ethAddressRe.lastIndex = 0;
    while ((match = ethAddressRe.exec(l)) !== null) {
      warnings.push(
        item(
          'warning',
          i + 1,
          match.index + 1,
          `Hardcoded address detected. Use Address('0x...') for type safety`
        )
      );
    }
  });

  return { errors, warnings, info };
}
