'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import type { editor as MonacoEditor } from 'monaco-editor';
import Link from 'next/link';
import { lintContract, LintResult } from '../lib/lint';
import { deployContract } from '../lib/genlayer';
import { useWallet } from '../lib/wallet-context';
import { useToast } from './Toast';
import { normalizePythonSource } from '../lib/normalize';

const MonacoEditorComponent = dynamic(() => import('@monaco-editor/react'), { ssr: false });

const DRAFT_KEY = 'genmarket_contract_draft';

const STARTER_TEMPLATE = `# { "Depends": "py-genlayer:test" }

from genlayer import *


class HelloWorld(gl.Contract):
    greeting: str
    call_count: u256

    def __init__(self) -> None:
        self.greeting = "Hello from GenLayer!"
        self.call_count = u256(0)

    @gl.public.view
    def get_greeting(self) -> str:
        return self.greeting

    @gl.public.view
    def get_call_count(self) -> str:
        return str(self.call_count)

    @gl.public.write
    def set_greeting(self, new_greeting: str) -> None:
        assert len(new_greeting) > 0, "Greeting cannot be empty"
        self.greeting = new_greeting
        self.call_count += u256(1)
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

function getInitialCode(): string {
  if (typeof window === 'undefined') return STARTER_TEMPLATE;
  const pending = sessionStorage.getItem('pending_source');
  if (pending) {
    sessionStorage.removeItem('pending_source');
    localStorage.setItem(DRAFT_KEY, pending);
    return pending;
  }
  return localStorage.getItem(DRAFT_KEY) ?? STARTER_TEMPLATE;
}

export default function GenLayerEditor() {
  const router = useRouter();
  const { writeClient, connect, connecting } = useWallet();
  const { showToast } = useToast();
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [code, setCode] = useState(STARTER_TEMPLATE);
  const [hasDraft, setHasDraft] = useState(false);
  const [lintResult, setLintResult] = useState<LintResult | null>(null);
  const [linting, setLinting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deployedAddress, setDeployedAddress] = useState<string | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [copiedAddr, setCopiedAddr] = useState(false);

  useEffect(() => {
    const initial = getInitialCode();
    setCode(initial);
    setHasDraft(initial !== STARTER_TEMPLATE);
    if (editorRef.current) {
      editorRef.current.setValue(initial);
    }
    runLint(initial);

    // Jump to a specific error line if navigating from the sell page lint failure
    const jumpStr = sessionStorage.getItem('genmarket_jump_to_line');
    if (jumpStr) {
      sessionStorage.removeItem('genmarket_jump_to_line');
      const lineNum = parseInt(jumpStr, 10);
      if (!isNaN(lineNum)) {
        // Delay so Monaco has time to finish rendering
        setTimeout(() => {
          const editor = editorRef.current;
          if (editor) {
            editor.revealLineInCenter(lineNum);
            editor.setPosition({ lineNumber: lineNum, column: 1 });
            editor.focus();
          }
        }, 600);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runLint = useCallback((source: string) => {
    setLinting(true);
    const result = lintContract(source);
    setLintResult(result);

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
    setHasDraft(src !== STARTER_TEMPLATE);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setLinting(true);
    debounceRef.current = setTimeout(() => {
      localStorage.setItem(DRAFT_KEY, src);
      runLint(src);
    }, 400);
  }

  function handleEditorMount(
    editor: MonacoEditor.IStandaloneCodeEditor,
    monaco: typeof import('monaco-editor')
  ) {
    editorRef.current = editor;
    monacoRef.current = monaco;
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

  function handleFormatCode() {
    const cleaned = normalizePythonSource(code);
    setCode(cleaned);
    localStorage.setItem(DRAFT_KEY, cleaned);
    if (editorRef.current) {
      editorRef.current.setValue(cleaned);
    }
    runLint(cleaned);
    showToast('Code spacing cleaned', 'success');
  }

  function handleResetTemplate() {
    localStorage.removeItem(DRAFT_KEY);
    setCode(STARTER_TEMPLATE);
    setHasDraft(false);
    editorRef.current?.setValue(STARTER_TEMPLATE);
    runLint(STARTER_TEMPLATE);
  }

  function handleUseInListing() {
    const cleaned = normalizePythonSource(code);
    localStorage.setItem(DRAFT_KEY, cleaned);
    sessionStorage.setItem('pending_source', cleaned);
    router.push('/sell');
  }

  async function handleDeploy() {
    setDeployError(null);
    setDeployedAddress(null);
    if (!writeClient) {
      await connect();
      return;
    }
    if (lintResult && lintResult.errors.length > 0) {
      setDeployError(`Fix ${lintResult.errors.length} lint error${lintResult.errors.length > 1 ? 's' : ''} before deploying.`);
      return;
    }
    setDeploying(true);
    try {
      const addr = await deployContract(writeClient, code);
      setDeployedAddress(addr);
    } catch (e: any) {
      setDeployError(e.message ?? 'Deployment failed.');
    } finally {
      setDeploying(false);
    }
  }

  function copyDeployedAddr() {
    if (!deployedAddress) return;
    navigator.clipboard.writeText(deployedAddress);
    setCopiedAddr(true);
    setTimeout(() => setCopiedAddr(false), 1500);
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="flex flex-col h-screen bg-neutral-900">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-700 bg-neutral-900 shrink-0">
        <div className="flex items-center gap-2 sm:gap-3">
          <Link href="/" className="text-sm font-bold text-neutral-100 hover:text-white transition-colors">
            GenMarket<span className="text-neutral-500">.</span>
          </Link>
          <span className="hidden sm:inline-flex text-xs font-mono text-neutral-300 bg-neutral-800 border border-neutral-700 px-2.5 py-1 rounded-md">
            GenLayer Python
          </span>
          <LintBadge result={lintResult} linting={linting} />
        </div>
        <div className="flex items-center gap-2">
          {hasDraft && (
            <button
              onClick={handleResetTemplate}
              className="hidden sm:block text-xs text-neutral-500 hover:text-neutral-300 px-2 py-1.5 rounded-lg transition-colors"
              title="Discard draft and reset to starter template"
            >
              Reset template
            </button>
          )}
          <button
            onClick={handleFormatCode}
            className="hidden sm:block text-xs text-neutral-400 hover:text-neutral-100 bg-neutral-800 border border-neutral-700 px-3 py-1.5 rounded-lg transition-colors"
            title="Clean up whitespace, tabs, and hidden characters"
          >
            Format code
          </button>
          <button
            onClick={handleCopy}
            className="hidden sm:block text-xs text-neutral-400 hover:text-neutral-100 bg-neutral-800 border border-neutral-700 px-3 py-1.5 rounded-lg transition-colors"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button
            onClick={handleDeploy}
            disabled={deploying || connecting}
            className="hidden sm:flex items-center gap-1.5 text-xs text-emerald-300 hover:text-emerald-100 bg-emerald-900/40 border border-emerald-700/60 hover:border-emerald-500 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {deploying ? (
              <>
                <span className="w-3 h-3 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                Deploying…
              </>
            ) : connecting ? 'Connecting…' : '⬆ Deploy'}
          </button>
          <button
            onClick={handleUseInListing}
            className="text-xs text-neutral-900 bg-[#F7F4EF] hover:bg-white px-3 py-1.5 rounded-lg font-medium transition-colors"
          >
            Use in listing →
          </button>
        </div>
      </div>

      {/* Deploy result / error banner */}
      {(deployedAddress || deployError) && (
        <div className={`shrink-0 px-4 py-2.5 flex items-center gap-3 border-b text-xs ${
          deployedAddress
            ? 'bg-emerald-950/60 border-emerald-700/50 text-emerald-300'
            : 'bg-red-950/60 border-red-700/50 text-red-300'
        }`}>
          {deployedAddress ? (
            <>
              <span className="text-emerald-400 font-semibold shrink-0">Deployed:</span>
              <span className="font-mono flex-1 truncate">{deployedAddress}</span>
              <button
                onClick={copyDeployedAddr}
                className="shrink-0 bg-emerald-900/60 border border-emerald-700 px-2 py-0.5 rounded hover:bg-emerald-800/60 transition-colors"
              >
                {copiedAddr ? 'Copied!' : 'Copy'}
              </button>
              <button onClick={() => setDeployedAddress(null)} className="shrink-0 text-emerald-600 hover:text-emerald-300 transition-colors">×</button>
            </>
          ) : (
            <>
              <span className="text-red-400 font-semibold shrink-0">Deploy error:</span>
              <span className="flex-1 truncate">{deployError}</span>
              <button onClick={() => setDeployError(null)} className="shrink-0 text-red-600 hover:text-red-300 transition-colors">×</button>
            </>
          )}
        </div>
      )}

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
