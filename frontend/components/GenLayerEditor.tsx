'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import type { editor as MonacoEditor } from 'monaco-editor';
import Link from 'next/link';
import { lintContract, LintResult } from '../lib/lint';

const MonacoEditorComponent = dynamic(() => import('@monaco-editor/react'), { ssr: false });

const STARTER_TEMPLATE = `# { "Depends": "py-genlayer:test" }

from genlayer import *
import json

class MyContract(gl.Contract):
    # Add your state variables here
    result: str

    def __init__(self) -> None:
        self.result = ""

    @gl.public.view
    def get_result(self) -> str:
        return self.result

    @gl.public.write
    def my_method(self, input: str) -> None:
        pass
`;


function LintBadge({ result, linting }: { result: LintResult | null; linting: boolean }) {
  if (linting) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-neutral-400 font-medium">
        <span className="w-3 h-3 border-2 border-neutral-400 border-t-transparent rounded-full animate-spin" />
        Linting…
      </span>
    );
  }
  if (!result) return null;
  const { errors, warnings } = result;
  if (errors.length > 0) {
    return (
      <span className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 px-2.5 py-1 rounded-full">
        ✕ {errors.length} error{errors.length > 1 ? 's' : ''}
      </span>
    );
  }
  if (warnings.length > 0) {
    return (
      <span className="text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">
        ⚠ {warnings.length} warning{warnings.length > 1 ? 's' : ''}
      </span>
    );
  }
  return (
    <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
      ✓ Clean
    </span>
  );
}

function LintPanel({
  result,
  onItemClick,
}: {
  result: LintResult | null;
  onItemClick: (line: number) => void;
}) {
  if (!result) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-neutral-400">
        Write some code to see lint results.
      </div>
    );
  }

  const total = result.errors.length + result.warnings.length + result.info.length;
  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-emerald-600 font-medium">
        ✓ No issues found
      </div>
    );
  }

  const sections = [
    { label: 'Errors', items: result.errors, color: 'text-red-600', dot: 'bg-red-500' },
    { label: 'Warnings', items: result.warnings, color: 'text-amber-600', dot: 'bg-amber-400' },
    { label: 'Info', items: result.info, color: 'text-blue-600', dot: 'bg-blue-400' },
  ];

  return (
    <div className="grid grid-cols-3 divide-x divide-neutral-700 h-full overflow-hidden">
      {sections.map(({ label, items, color, dot }) => (
        <div key={label} className="flex flex-col overflow-hidden">
          <div className="px-3 py-2 text-xs font-semibold text-neutral-400 border-b border-neutral-700 uppercase tracking-wide flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
            {label} ({items.length})
          </div>
          <div className="flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <p className="text-xs text-neutral-500 p-3">None</p>
            ) : (
              items.map((item, i) => (
                <button
                  key={i}
                  onClick={() => onItemClick(item.line)}
                  className={`w-full text-left px-3 py-2 text-xs border-b border-neutral-700/50 hover:bg-neutral-700/50 transition-colors ${color}`}
                >
                  <span className="font-mono text-neutral-400 mr-2">L{item.line}</span>
                  {item.message}
                </button>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function GenLayerEditor() {
  const router = useRouter();
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [code, setCode] = useState(STARTER_TEMPLATE);
  const [lintResult, setLintResult] = useState<LintResult | null>(null);
  const [linting, setLinting] = useState(false);
  const [copied, setCopied] = useState(false);

  const runLint = useCallback((source: string) => {
    setLinting(true);
    // Run synchronously in the browser — no API call, no cold-start delay
    const result = lintContract(source);
    setLintResult(result);

    // Draw squiggles in Monaco
    if (editorRef.current && monacoRef.current) {
      const model = editorRef.current.getModel();
      if (model) {
        const markers = [
          ...result.errors.map((e) => ({
            severity: monacoRef.current!.MarkerSeverity.Error,
            startLineNumber: e.line,
            startColumn: e.column,
            endLineNumber: e.line,
            endColumn: 999,
            message: e.message,
          })),
          ...result.warnings.map((w) => ({
            severity: monacoRef.current!.MarkerSeverity.Warning,
            startLineNumber: w.line,
            startColumn: w.column,
            endLineNumber: w.line,
            endColumn: 999,
            message: w.message,
          })),
          ...result.info.map((i) => ({
            severity: monacoRef.current!.MarkerSeverity.Info,
            startLineNumber: i.line,
            startColumn: i.column,
            endLineNumber: i.line,
            endColumn: 999,
            message: i.message,
          })),
        ];
        monacoRef.current.editor.setModelMarkers(model, 'genlayer-lint', markers);
      }
    }
    setLinting(false);
  }, []);

  function handleEditorChange(value: string | undefined) {
    const src = value ?? '';
    setCode(src);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setLinting(true);
    debounceRef.current = setTimeout(() => runLint(src), 400);
  }

  function handleEditorMount(
    editor: MonacoEditor.IStandaloneCodeEditor,
    monaco: typeof import('monaco-editor')
  ) {
    editorRef.current = editor;
    monacoRef.current = monaco;
    runLint(STARTER_TEMPLATE);
  }

  function jumpToLine(line: number) {
    if (!editorRef.current) return;
    editorRef.current.revealLineInCenter(line);
    editorRef.current.setPosition({ lineNumber: line, column: 1 });
    editorRef.current.focus();
  }

  function handleCopy() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleUseInListing() {
    sessionStorage.setItem('pending_source', code);
    router.push('/sell');
  }

  // Cleanup blob URLs and debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="flex flex-col h-screen bg-neutral-900">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-700 bg-neutral-900 shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm font-bold text-neutral-100 hover:text-white transition-colors mr-1">
            GenMarket<span className="text-neutral-500">.</span>
          </Link>
          <span className="text-xs font-mono text-neutral-300 bg-neutral-800 border border-neutral-700 px-2.5 py-1 rounded-md">
            GenLayer Python
          </span>
          <LintBadge result={lintResult} linting={linting} />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="text-xs text-neutral-400 hover:text-neutral-100 bg-neutral-800 border border-neutral-700 px-3 py-1.5 rounded-lg transition-colors"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button
            onClick={handleUseInListing}
            className="text-xs text-neutral-900 bg-[#F7F4EF] hover:bg-white px-3 py-1.5 rounded-lg font-medium transition-colors"
          >
            Use in listing →
          </button>
        </div>
      </div>

      {/* Editor — 65% */}
      <div style={{ height: '65%' }} className="shrink-0">
        <MonacoEditorComponent
          height="100%"
          language="python"
          theme="vs-dark"
          value={code}
          onChange={handleEditorChange}
          onMount={handleEditorMount}
          options={{
            fontSize: 13,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            tabSize: 4,
            insertSpaces: true,
            lineNumbers: 'on',
            glyphMargin: true,
            folding: true,
          }}
        />
      </div>

      {/* Lint panel — 35% */}
      <div className="flex-1 border-t border-neutral-700 bg-neutral-900 overflow-hidden">
        <LintPanel result={lintResult} onItemClick={jumpToLine} />
      </div>
    </div>
  );
}
