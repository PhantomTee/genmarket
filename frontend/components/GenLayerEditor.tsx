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
import { parseLintOutput, ParsedLintError } from '../lib/lint-parser';

const MonacoEditorComponent = dynamic(() => import('@monaco-editor/react'), { ssr: false });

const DRAFT_KEY = 'genmarket_contract_draft';

// ─── Templates ────────────────────────────────────────────────────────────────

const TEMPLATES: Record<string, string> = {
  HelloWorld: `# { "Depends": "py-genlayer:test" }

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
`,
  Storage: `# { "Depends": "py-genlayer:test" }

from genlayer import *


class StorageContract(gl.Contract):
    value: str
    owner: str

    def __init__(self, initial_value: str) -> None:
        self.value = initial_value
        self.owner = contract_runner.from_address

    @gl.public.view
    def get_value(self) -> str:
        return self.value

    @gl.public.write
    def set_value(self, new_value: str) -> None:
        assert contract_runner.from_address == self.owner, "Only owner"
        self.value = new_value
`,
  DAOVote: `# { "Depends": "py-genlayer:test" }

from genlayer import *


class DAOVote(gl.Contract):
    proposal: str
    votes_for: u256
    votes_against: u256

    def __init__(self, proposal: str) -> None:
        self.proposal = proposal
        self.votes_for = u256(0)
        self.votes_against = u256(0)

    @gl.public.view
    def get_result(self) -> str:
        return f"For: {self.votes_for}, Against: {self.votes_against}"

    @gl.public.write
    def vote(self, in_favor: bool) -> None:
        if in_favor:
            self.votes_for += u256(1)
        else:
            self.votes_against += u256(1)
`,
  Oracle: `# { "Depends": "py-genlayer:test" }

from genlayer import *
import json


class DataOracle(gl.Contract):
    data: str
    last_updated: u256

    def __init__(self) -> None:
        self.data = "{}"
        self.last_updated = u256(0)

    @gl.public.view
    def get_data(self) -> str:
        return self.data

    @gl.public.write
    def update_data(self, new_data: str) -> None:
        self.data = new_data
        self.last_updated += u256(1)
`,
};

// ─── Code parsers (run outside render) ───────────────────────────────────────

function parseConstructorParams(code: string): Array<{ name: string; type: string }> {
  const match = /def __init__\s*\(\s*self\s*(?:,\s*([\s\S]*?))?\s*\)\s*(?:->[\s\S]*?)?\s*:/m.exec(code);
  if (!match?.[1]) return [];
  const params: Array<{ name: string; type: string }> = [];
  let depth = 0;
  let cur = '';
  for (const ch of match[1]) {
    if ('[{('.includes(ch)) depth++;
    else if (']})'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) { push(cur.trim(), params); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) push(cur.trim(), params);
  return params;
}

function push(p: string, out: Array<{ name: string; type: string }>) {
  const noDefault = p.split('=')[0].trim();
  const colon = noDefault.indexOf(':');
  const name = colon === -1 ? noDefault : noDefault.slice(0, colon).trim();
  const type = colon === -1 ? 'str' : noDefault.slice(colon + 1).trim();
  if (name && !name.startsWith('*') && !name.startsWith('/')) out.push({ name, type: type || 'str' });
}

function parseContractInfo(code: string) {
  const className = /class\s+(\w+)\s*\(gl\.Contract\)/.exec(code)?.[1] ?? null;
  const methods: Array<{ name: string; kind: string }> = [];
  const methodRe = /@gl\.public\.(view|write(?:\.payable)?)\s*\n\s*def\s+(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = methodRe.exec(code)) !== null) methods.push({ kind: m[1], name: m[2] });
  const fields: Array<{ name: string; type: string }> = [];
  const lines = code.split('\n');
  let inMethod = false;
  for (const line of lines) {
    if (/^    def\s+/.test(line)) { inMethod = true; continue; }
    if (inMethod && !/^        /.test(line)) inMethod = false;
    if (!inMethod) {
      const fm = /^    (\w+)\s*:\s*([^\s=#]+)/.exec(line);
      if (fm && fm[1] !== 'def') fields.push({ name: fm[1], type: fm[2] });
    }
  }
  return { className, methods, fields };
}

function getChecklist(code: string, genVMLintPassed: boolean) {
  return [
    { label: 'GenLayer header comment', ok: code.includes('py-genlayer') },
    { label: 'Extends gl.Contract', ok: /class\s+\w+\(gl\.Contract\)/.test(code) },
    { label: '__init__ defined', ok: /def __init__/.test(code) },
    { label: 'At least one public method', ok: /@gl\.public\./.test(code) },
    { label: 'GenVM lint passed', ok: genVMLintPassed },
  ];
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SidebarSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-[#858585] border-b border-[#3e3e42]">
        {title}
      </div>
      <div className="px-3 py-2">{children}</div>
    </div>
  );
}

type GenVMLintStatus = 'not_run' | 'running' | 'passed' | 'failed';
type DeployStatus = 'idle' | 'deploying' | 'deployed' | 'failed';
type BottomTab = 'problems' | 'lint' | 'deploy' | 'debug' | 'raw';

function StatusBadge({ status }: { status: GenVMLintStatus | DeployStatus | 'draft' }) {
  const map: Record<string, string> = {
    draft: 'text-[#858585] bg-[#3e3e42]',
    not_run: 'text-[#858585] bg-[#3e3e42]',
    running: 'text-[#cca700] bg-[#3e3200]',
    passed: 'text-[#89d185] bg-[#1e3a1e]',
    failed: 'text-[#f48771] bg-[#3d1414]',
    idle: 'text-[#858585] bg-[#3e3e42]',
    deploying: 'text-[#cca700] bg-[#3e3200]',
    deployed: 'text-[#4fc1ff] bg-[#0d2d3e]',
  };
  const label: Record<string, string> = {
    draft: 'Draft',
    not_run: 'Not Run',
    running: 'Running…',
    passed: 'Lint Passed',
    failed: 'Lint Failed',
    idle: 'Not Deployed',
    deploying: 'Deploying…',
    deployed: 'Deployed',
  };
  return (
    <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded ${map[status] ?? map.draft}`}>
      {label[status] ?? status}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

function getInitialCode(): string {
  if (typeof window === 'undefined') return TEMPLATES.HelloWorld;
  const pending = sessionStorage.getItem('pending_source');
  if (pending) { sessionStorage.removeItem('pending_source'); localStorage.setItem(DRAFT_KEY, pending); return pending; }
  return localStorage.getItem(DRAFT_KEY) ?? TEMPLATES.HelloWorld;
}

export default function GenLayerEditor() {
  const router = useRouter();
  const { writeClient, connect, connecting, address } = useWallet();
  const { showToast } = useToast();
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const genVMDecoRef = useRef<string[]>([]);

  const [code, setCode] = useState(TEMPLATES.HelloWorld);
  const [filename] = useState('contract.py');

  // Browser lint (inline squiggles)
  const [lintResult, setLintResult] = useState<LintResult | null>(null);
  const [linting, setLinting] = useState(false);

  // GenVM lint (backend)
  const [genVMLintStatus, setGenVMLintStatus] = useState<GenVMLintStatus>('not_run');
  const [genVMLintOutput, setGenVMLintOutput] = useState('');
  const [genVMLintErrors, setGenVMLintErrors] = useState<ParsedLintError[]>([]);
  const [genVMLintRaw, setGenVMLintRaw] = useState('');

  // Deploy
  const [deployStatus, setDeployStatus] = useState<DeployStatus>('idle');
  const [deployedAddress, setDeployedAddress] = useState<string | null>(null);
  const [deployLogs, setDeployLogs] = useState('');

  // Constructor inputs
  const [constructorParams, setConstructorParams] = useState<Array<{ name: string; type: string }>>([]);
  const [constructorArgs, setConstructorArgs] = useState<Record<string, string>>({});

  // Parsed contract info
  const [contractInfo, setContractInfo] = useState(() => parseContractInfo(TEMPLATES.HelloWorld));

  // UI
  const [bottomTab, setBottomTab] = useState<BottomTab>('problems');
  const [bottomOpen, setBottomOpen] = useState(true);
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);

  // Load draft/sessionStorage on mount
  useEffect(() => {
    const initial = getInitialCode();
    setCode(initial);
    setContractInfo(parseContractInfo(initial));
    setConstructorParams(parseConstructorParams(initial));
    if (editorRef.current) editorRef.current.setValue(initial);
    runBrowserLint(initial);

    const jumpStr = sessionStorage.getItem('genmarket_jump_to_line');
    if (jumpStr) {
      sessionStorage.removeItem('genmarket_jump_to_line');
      const line = parseInt(jumpStr, 10);
      if (!isNaN(line)) setTimeout(() => {
        editorRef.current?.revealLineInCenter(line);
        editorRef.current?.setPosition({ lineNumber: line, column: 1 });
        editorRef.current?.focus();
      }, 600);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runBrowserLint = useCallback((src: string) => {
    setLinting(true);
    const result = lintContract(src);
    setLintResult(result);
    if (editorRef.current && monacoRef.current) {
      const model = editorRef.current.getModel();
      if (model) {
        const markers = [
          ...result.errors.map(e => ({ severity: monacoRef.current!.MarkerSeverity.Error, startLineNumber: e.line, startColumn: e.column, endLineNumber: e.line, endColumn: 999, message: e.message })),
          ...result.warnings.map(w => ({ severity: monacoRef.current!.MarkerSeverity.Warning, startLineNumber: w.line, startColumn: w.column, endLineNumber: w.line, endColumn: 999, message: w.message })),
        ];
        monacoRef.current.editor.setModelMarkers(model, 'genlayer-lint', markers);
      }
    }
    setLinting(false);
  }, []);

  function handleEditorChange(value: string | undefined) {
    const src = value ?? '';
    setCode(src);
    // Reset GenVM lint if code changes after a pass
    setGenVMLintStatus(prev => prev === 'passed' ? 'not_run' : prev);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setLinting(true);
    debounceRef.current = setTimeout(() => {
      localStorage.setItem(DRAFT_KEY, src);
      setContractInfo(parseContractInfo(src));
      setConstructorParams(parseConstructorParams(src));
      runBrowserLint(src);
    }, 400);
  }

  function handleEditorMount(ed: MonacoEditor.IStandaloneCodeEditor, monaco: typeof import('monaco-editor')) {
    editorRef.current = ed;
    monacoRef.current = monaco;
  }

  function jumpToLine(line: number) {
    editorRef.current?.revealLineInCenter(line);
    editorRef.current?.setPosition({ lineNumber: line, column: 1 });
    editorRef.current?.focus();
  }

  function handleFormat() {
    const cleaned = normalizePythonSource(code);
    setCode(cleaned);
    localStorage.setItem(DRAFT_KEY, cleaned);
    editorRef.current?.setValue(cleaned);
    runBrowserLint(cleaned);
    showToast('Code spacing cleaned', 'success');
  }

  function loadTemplate(name: string) {
    const tpl = TEMPLATES[name];
    if (!tpl) return;
    if (code !== TEMPLATES.HelloWorld && code !== tpl) {
      if (!confirm(`Load "${name}" template? Your current code will be replaced.`)) return;
    }
    setCode(tpl);
    localStorage.setItem(DRAFT_KEY, tpl);
    editorRef.current?.setValue(tpl);
    runBrowserLint(tpl);
    setContractInfo(parseContractInfo(tpl));
    setConstructorParams(parseConstructorParams(tpl));
    setConstructorArgs({});
    setGenVMLintStatus('not_run');
    setGenVMLintOutput('');
    setGenVMLintErrors([]);
    setActiveTemplate(name);
  }

  async function handleGenVMLint() {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
    if (!backendUrl) { showToast('NEXT_PUBLIC_BACKEND_URL is not set', 'error'); return; }
    setGenVMLintStatus('running');
    setGenVMLintOutput('');
    setGenVMLintErrors([]);
    setGenVMLintRaw('');
    setBottomTab('lint');
    setBottomOpen(true);
    const src = normalizePythonSource(code);
    try {
      const res = await fetch(`${backendUrl}/api/contracts/lint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceCode: src }),
      });
      const text = await res.text();
      setGenVMLintRaw(text);
      let data: any;
      try { data = JSON.parse(text); } catch { throw new Error(`Backend returned non-JSON: ${text.slice(0, 200)}`); }

      const combined = [data.stdout ?? '', data.stderr ?? ''].filter(Boolean).join('\n');
      setGenVMLintOutput(combined || (data.passed ? 'No issues found.' : 'Lint failed.'));

      if (data.passed) {
        setGenVMLintStatus('passed');
        // Clear GenVM markers
        if (editorRef.current && monacoRef.current) {
          const model = editorRef.current.getModel();
          if (model) monacoRef.current.editor.setModelMarkers(model, 'genvm-lint', []);
        }
        showToast('GenVM lint passed ✓', 'success');
      } else {
        setGenVMLintStatus('failed');
        const errors = parseLintOutput(data.stdout ?? '', data.stderr ?? '');
        setGenVMLintErrors(errors);
        // Add GenVM markers to Monaco
        if (editorRef.current && monacoRef.current) {
          const model = editorRef.current.getModel();
          if (model) {
            const markers = errors.filter(e => e.line !== null).map(e => ({
              severity: monacoRef.current!.MarkerSeverity.Error,
              startLineNumber: e.line!,
              startColumn: e.column ?? 1,
              endLineNumber: e.line!,
              endColumn: 999,
              message: `[GenVM] ${e.message}`,
              source: 'GenVM Lint',
            }));
            monacoRef.current.editor.setModelMarkers(model, 'genvm-lint', markers);
          }
        }
      }
    } catch (e: any) {
      setGenVMLintStatus('failed');
      setGenVMLintOutput(e.message);
      setGenVMLintErrors([{ line: null, column: null, message: e.message }]);
    }
  }

  async function handleDeploy() {
    if (genVMLintStatus !== 'passed') { showToast('Run GenVM Lint first', 'error'); return; }
    if (!writeClient) { await connect(); return; }
    setDeployStatus('deploying');
    setDeployLogs('Deploying to GenLayer Studionet…\n');
    setBottomTab('deploy');
    setBottomOpen(true);
    try {
      const args = constructorParams.map(p => {
        const v = constructorArgs[p.name] ?? '';
        const t = p.type.toLowerCase();
        if (t === 'bool') return v === 'true';
        if (t.includes('int') || t === 'u256') return Number(v) || 0;
        return v;
      });
      const addr = await deployContract(writeClient, code);
      setDeployedAddress(addr);
      setDeployStatus('deployed');
      setDeployLogs(prev => prev + `\nDeployed successfully.\nAddress: ${addr}`);
      localStorage.setItem(DRAFT_KEY, code); // keep draft on deploy
      showToast('Demo deployed!', 'success');
    } catch (e: any) {
      setDeployStatus('failed');
      setDeployLogs(prev => prev + `\nDeploy failed: ${e.message}`);
    }
  }

  function handleUseInListing() {
    const cleaned = normalizePythonSource(code);
    localStorage.setItem(DRAFT_KEY, cleaned);
    sessionStorage.setItem('pending_source', cleaned);
    router.push('/sell');
  }

  function copyLogs() {
    const content = bottomTab === 'problems' ? (lintResult ? JSON.stringify(lintResult, null, 2) : '')
      : bottomTab === 'lint' ? genVMLintOutput
      : bottomTab === 'deploy' ? deployLogs
      : bottomTab === 'raw' ? genVMLintRaw
      : '';
    navigator.clipboard.writeText(content);
    showToast('Copied to clipboard', 'success');
  }

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const checklist = getChecklist(code, genVMLintStatus === 'passed');
  const hasDraft = code !== TEMPLATES.HelloWorld;
  const problemCount = (lintResult?.errors.length ?? 0) + (lintResult?.warnings.length ?? 0);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="h-screen overflow-hidden flex flex-col" style={{ background: '#1e1e1e', color: '#cccccc', fontFamily: "'Segoe UI', system-ui, sans-serif" }}>

      {/* ── Topbar ── */}
      <div className="shrink-0 flex items-center justify-between px-3 border-b" style={{ height: 36, background: '#323233', borderColor: '#3e3e42' }}>
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm font-bold text-white hover:text-[#cccccc] transition-colors">
            GenMarket<span style={{ color: '#858585' }}>.</span>
          </Link>
          <span style={{ color: '#3e3e42' }}>|</span>
          <span className="text-xs" style={{ color: '#cccccc' }}>{filename}</span>
          {hasDraft && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: '#3e3e42', color: '#858585' }}>Draft</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleGenVMLint}
            disabled={genVMLintStatus === 'running'}
            className="text-xs px-3 py-1 rounded transition-colors disabled:opacity-50"
            style={{ background: '#0e639c', color: '#ffffff' }}
          >
            {genVMLintStatus === 'running' ? 'Linting…' : 'Run Lint'}
          </button>
          <button
            onClick={handleDeploy}
            disabled={genVMLintStatus !== 'passed' || deployStatus === 'deploying' || connecting}
            className="text-xs px-3 py-1 rounded transition-colors disabled:opacity-40"
            style={{ background: genVMLintStatus === 'passed' ? '#16825d' : '#2d3f35', color: '#ffffff' }}
          >
            {deployStatus === 'deploying' ? 'Deploying…' : connecting ? 'Connecting…' : '⬆ Deploy'}
          </button>
          <button
            onClick={handleUseInListing}
            className="text-xs px-3 py-1 rounded"
            style={{ background: '#F7F4EF', color: '#1e1e1e', fontWeight: 600 }}
          >
            Use in listing →
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left sidebar ── */}
        <div className="shrink-0 flex flex-col overflow-y-auto border-r" style={{ width: 220, background: '#252526', borderColor: '#3e3e42' }}>

          {/* Templates */}
          <SidebarSection title="Templates">
            <div className="flex flex-col gap-0.5">
              {Object.keys(TEMPLATES).map(name => (
                <button
                  key={name}
                  onClick={() => loadTemplate(name)}
                  className="text-left text-xs px-2 py-1 rounded transition-colors"
                  style={{
                    color: activeTemplate === name ? '#cccccc' : '#858585',
                    background: activeTemplate === name ? '#37373d' : 'transparent',
                  }}
                  onMouseEnter={e => { if (activeTemplate !== name) (e.target as HTMLElement).style.color = '#cccccc'; }}
                  onMouseLeave={e => { if (activeTemplate !== name) (e.target as HTMLElement).style.color = '#858585'; }}
                >
                  📄 {name}
                </button>
              ))}
            </div>
          </SidebarSection>

          {/* Constructor inputs */}
          {constructorParams.length > 0 && (
            <SidebarSection title="Constructor Inputs">
              <div className="flex flex-col gap-2">
                {constructorParams.map(p => (
                  <div key={p.name} className="flex flex-col gap-0.5">
                    <label className="text-[10px]" style={{ color: '#858585' }}>
                      {p.name}: <span style={{ color: '#4ec9b0' }}>{p.type}</span>
                    </label>
                    <input
                      type={p.type.toLowerCase().includes('int') || p.type === 'u256' ? 'number' : 'text'}
                      value={constructorArgs[p.name] ?? ''}
                      onChange={e => setConstructorArgs(prev => ({ ...prev, [p.name]: e.target.value }))}
                      placeholder={p.type}
                      className="w-full text-xs px-2 py-1 rounded border"
                      style={{ background: '#3c3c3c', border: '1px solid #3e3e42', color: '#cccccc', outline: 'none' }}
                    />
                  </div>
                ))}
              </div>
            </SidebarSection>
          )}

          {/* Checklist */}
          <SidebarSection title="Checklist">
            <div className="flex flex-col gap-1">
              {checklist.map(item => (
                <div key={item.label} className="flex items-center gap-1.5 text-[11px]">
                  <span style={{ color: item.ok ? '#89d185' : '#858585' }}>{item.ok ? '✓' : '○'}</span>
                  <span style={{ color: item.ok ? '#cccccc' : '#858585' }}>{item.label}</span>
                </div>
              ))}
            </div>
          </SidebarSection>

          {/* Actions */}
          <SidebarSection title="Actions">
            <div className="flex flex-col gap-1.5">
              <button
                onClick={handleFormat}
                className="text-left text-xs px-2 py-1.5 rounded w-full transition-colors"
                style={{ background: '#3c3c3c', color: '#cccccc' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#4a4a4a')}
                onMouseLeave={e => (e.currentTarget.style.background = '#3c3c3c')}
              >
                ⟳ Format Code
              </button>
              <button
                onClick={handleGenVMLint}
                disabled={genVMLintStatus === 'running'}
                className="text-left text-xs px-2 py-1.5 rounded w-full transition-colors disabled:opacity-50"
                style={{ background: '#0e639c', color: '#ffffff' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#1177bb')}
                onMouseLeave={e => (e.currentTarget.style.background = '#0e639c')}
              >
                ✓ Run GenVM Lint
              </button>
              <button
                onClick={handleDeploy}
                disabled={genVMLintStatus !== 'passed' || deployStatus === 'deploying' || connecting}
                className="text-left text-xs px-2 py-1.5 rounded w-full transition-colors disabled:opacity-40"
                style={{ background: '#16825d', color: '#ffffff' }}
                onMouseEnter={e => { if (genVMLintStatus === 'passed') e.currentTarget.style.background = '#1a9a6e'; }}
                onMouseLeave={e => { if (genVMLintStatus === 'passed') e.currentTarget.style.background = '#16825d'; }}
              >
                ⬆ Deploy Demo
              </button>
              {genVMLintStatus !== 'passed' && (
                <p className="text-[10px]" style={{ color: '#858585' }}>Run lint first to enable deploy.</p>
              )}
            </div>
          </SidebarSection>

          {/* Workflow hint */}
          <div className="mt-auto px-3 py-3 border-t" style={{ borderColor: '#3e3e42' }}>
            <p className="text-[10px] leading-relaxed" style={{ color: '#858585' }}>
              Edit → Lint → Deploy → Interact
            </p>
          </div>
        </div>

        {/* ── Center panel ── */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* File tabs */}
          <div className="shrink-0 flex items-center border-b" style={{ height: 35, background: '#2d2d2d', borderColor: '#3e3e42' }}>
            <div
              className="flex items-center gap-2 px-4 h-full text-xs border-r border-t-2"
              style={{ borderRightColor: '#3e3e42', borderTopColor: '#0e639c', background: '#1e1e1e', color: '#cccccc' }}
            >
              <span>🐍</span>
              <span>{filename}</span>
              {linting && <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#cca700' }} />}
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-1 px-2">
              {lintResult && (lintResult.errors.length > 0 || lintResult.warnings.length > 0) ? (
                <>
                  {lintResult.errors.length > 0 && (
                    <span className="text-[10px]" style={{ color: '#f48771' }}>✕ {lintResult.errors.length}</span>
                  )}
                  {lintResult.warnings.length > 0 && (
                    <span className="text-[10px] ml-1" style={{ color: '#cca700' }}>⚠ {lintResult.warnings.length}</span>
                  )}
                </>
              ) : lintResult ? (
                <span className="text-[10px]" style={{ color: '#89d185' }}>✓ Clean</span>
              ) : null}
              <span className="text-[10px] ml-2" style={{ color: '#858585' }}>Python 3</span>
            </div>
          </div>

          {/* Monaco editor */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <MonacoEditorComponent
              height="100%"
              language="python"
              theme="vs-dark"
              value={code}
              onChange={handleEditorChange}
              onMount={handleEditorMount}
              options={{
                fontSize: 13,
                lineHeight: 20,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                tabSize: 4,
                insertSpaces: true,
                lineNumbers: 'on',
                glyphMargin: true,
                folding: true,
                renderLineHighlight: 'all',
                scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
                padding: { top: 12 },
              }}
            />
          </div>

          {/* ── Bottom panel ── */}
          <div className="shrink-0 border-t flex flex-col" style={{ height: bottomOpen ? 200 : 30, borderColor: '#3e3e42', background: '#1e1e1e', transition: 'height 0.15s' }}>
            {/* Tab bar */}
            <div className="shrink-0 flex items-center border-b" style={{ height: 30, borderColor: '#3e3e42', background: '#2d2d2d' }}>
              {([
                ['problems', `Problems ${problemCount > 0 ? `(${problemCount})` : ''}`],
                ['lint', `Lint Output ${genVMLintStatus !== 'not_run' ? (genVMLintStatus === 'passed' ? '✓' : genVMLintStatus === 'failed' ? '✕' : '…') : ''}`],
                ['deploy', `Deploy Logs`],
                ['raw', 'Raw Response'],
              ] as [BottomTab, string][]).map(([tab, label]) => (
                <button
                  key={tab}
                  onClick={() => { setBottomTab(tab); setBottomOpen(true); }}
                  className="text-[11px] px-3 h-full border-r transition-colors"
                  style={{
                    borderRightColor: '#3e3e42',
                    borderTop: bottomTab === tab ? '1px solid #0e639c' : '1px solid transparent',
                    background: bottomTab === tab ? '#1e1e1e' : 'transparent',
                    color: bottomTab === tab ? '#cccccc' : '#858585',
                  }}
                >
                  {label}
                </button>
              ))}
              <div className="flex-1" />
              <div className="flex items-center gap-1 px-2">
                <button
                  onClick={copyLogs}
                  className="text-[10px] px-2 py-0.5 rounded"
                  style={{ color: '#858585', background: '#3c3c3c' }}
                >
                  Copy
                </button>
                <button
                  onClick={() => setBottomOpen(v => !v)}
                  className="text-[10px] px-2 py-0.5 rounded"
                  style={{ color: '#858585' }}
                >
                  {bottomOpen ? '▼' : '▲'}
                </button>
              </div>
            </div>

            {/* Tab content */}
            {bottomOpen && (
              <div className="flex-1 overflow-y-auto p-2 text-xs font-mono" style={{ color: '#cccccc' }}>

                {/* Problems tab */}
                {bottomTab === 'problems' && (
                  <div>
                    {!lintResult || (lintResult.errors.length === 0 && lintResult.warnings.length === 0) ? (
                      <p style={{ color: '#858585' }}>No problems detected.</p>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {[...lintResult.errors.map(e => ({ ...e, sev: 'error' })), ...lintResult.warnings.map(w => ({ ...w, sev: 'warning' }))].map((item, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <span style={{ color: item.sev === 'error' ? '#f48771' : '#cca700', minWidth: 8 }}>
                              {item.sev === 'error' ? '✕' : '⚠'}
                            </span>
                            <button
                              onClick={() => jumpToLine(item.line)}
                              className="text-left hover:underline"
                              style={{ color: '#569cd6' }}
                            >
                              L{item.line}:{item.column}
                            </button>
                            <span style={{ color: '#cccccc' }}>{item.message}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Lint Output tab */}
                {bottomTab === 'lint' && (
                  <div>
                    {genVMLintStatus === 'not_run' ? (
                      <p style={{ color: '#858585' }}>Click "Run GenVM Lint" to validate your contract.</p>
                    ) : genVMLintStatus === 'running' ? (
                      <p style={{ color: '#cca700' }}>Running GenVM lint…</p>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <p style={{ color: genVMLintStatus === 'passed' ? '#89d185' : '#f48771' }}>
                          {genVMLintStatus === 'passed' ? '✓ Lint passed' : '✕ Lint failed'}
                        </p>
                        {genVMLintErrors.map((err, i) => (
                          <div key={i} className="flex items-start gap-2">
                            {err.line !== null && (
                              <button onClick={() => jumpToLine(err.line!)} className="hover:underline shrink-0" style={{ color: '#569cd6' }}>
                                L{err.line}
                              </button>
                            )}
                            <div>
                              <p style={{ color: '#f48771' }}>{err.message}</p>
                              {err.hint && <p style={{ color: '#858585' }}>{err.hint}</p>}
                            </div>
                          </div>
                        ))}
                        {genVMLintOutput && (
                          <pre className="whitespace-pre-wrap mt-1" style={{ color: '#858585' }}>{genVMLintOutput}</pre>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Deploy Logs tab */}
                {bottomTab === 'deploy' && (
                  <pre className="whitespace-pre-wrap" style={{ color: deployStatus === 'deployed' ? '#89d185' : deployStatus === 'failed' ? '#f48771' : '#cccccc' }}>
                    {deployLogs || 'No deploy activity yet.'}
                  </pre>
                )}

                {/* Raw Response tab */}
                {bottomTab === 'raw' && (
                  <pre className="whitespace-pre-wrap" style={{ color: '#858585' }}>
                    {genVMLintRaw || 'No raw response yet.'}
                  </pre>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Right sidebar ── */}
        <div className="shrink-0 flex flex-col overflow-y-auto border-l" style={{ width: 210, background: '#252526', borderColor: '#3e3e42' }}>

          {/* Status */}
          <SidebarSection title="Status">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-[11px]">
                <span style={{ color: '#858585' }}>GenVM Lint</span>
                <StatusBadge status={genVMLintStatus} />
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span style={{ color: '#858585' }}>Deploy</span>
                <StatusBadge status={deployStatus} />
              </div>
              {deployedAddress && (
                <div className="flex flex-col gap-0.5 mt-1">
                  <span className="text-[10px]" style={{ color: '#858585' }}>Address</span>
                  <button
                    onClick={() => { navigator.clipboard.writeText(deployedAddress); showToast('Address copied', 'success'); }}
                    className="text-left text-[10px] font-mono break-all hover:underline"
                    style={{ color: '#4fc1ff' }}
                  >
                    {deployedAddress}
                  </button>
                </div>
              )}
            </div>
          </SidebarSection>

          {/* Contract info */}
          <SidebarSection title="Contract">
            <div className="flex flex-col gap-1.5">
              {contractInfo.className ? (
                <div className="text-[11px]">
                  <span style={{ color: '#858585' }}>Class </span>
                  <span style={{ color: '#4ec9b0' }}>{contractInfo.className}</span>
                </div>
              ) : (
                <p className="text-[11px]" style={{ color: '#858585' }}>No contract class found.</p>
              )}
              <div className="text-[11px]">
                <span style={{ color: '#858585' }}>Methods </span>
                <span style={{ color: '#cccccc' }}>{contractInfo.methods.length}</span>
              </div>
              <div className="text-[11px]">
                <span style={{ color: '#858585' }}>State fields </span>
                <span style={{ color: '#cccccc' }}>{contractInfo.fields.length}</span>
              </div>
            </div>
          </SidebarSection>

          {/* Methods */}
          {contractInfo.methods.length > 0 && (
            <SidebarSection title="Methods">
              <div className="flex flex-col gap-1">
                {contractInfo.methods.map((m, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-[11px]">
                    <span style={{ color: m.kind === 'view' ? '#569cd6' : '#dcdcaa' }}>
                      {m.kind === 'view' ? '◉' : '◈'}
                    </span>
                    <span style={{ color: '#cccccc' }}>{m.name}()</span>
                    <span className="ml-auto text-[9px]" style={{ color: '#858585' }}>
                      {m.kind}
                    </span>
                  </div>
                ))}
              </div>
            </SidebarSection>
          )}

          {/* State fields */}
          {contractInfo.fields.length > 0 && (
            <SidebarSection title="State Fields">
              <div className="flex flex-col gap-1">
                {contractInfo.fields.map((f, i) => (
                  <div key={i} className="flex items-center gap-1 text-[11px]">
                    <span style={{ color: '#9cdcfe' }}>{f.name}</span>
                    <span style={{ color: '#858585' }}>:</span>
                    <span style={{ color: '#4ec9b0' }}>{f.type}</span>
                  </div>
                ))}
              </div>
            </SidebarSection>
          )}

          {/* GenVM lint errors (right panel quick list) */}
          {genVMLintErrors.length > 0 && (
            <SidebarSection title="Lint Errors">
              <div className="flex flex-col gap-1.5">
                {genVMLintErrors.slice(0, 5).map((err, i) => (
                  <div key={i} className="flex flex-col gap-0.5">
                    {err.line !== null && (
                      <button
                        onClick={() => jumpToLine(err.line!)}
                        className="text-left text-[10px] font-medium hover:underline"
                        style={{ color: '#569cd6' }}
                      >
                        Go to line {err.line} →
                      </button>
                    )}
                    <p className="text-[10px] leading-tight" style={{ color: '#f48771' }}>{err.message}</p>
                  </div>
                ))}
              </div>
            </SidebarSection>
          )}

          {/* Deployed: link to interact */}
          {deployedAddress && (
            <div className="mt-auto px-3 py-3 border-t" style={{ borderColor: '#3e3e42' }}>
              <Link
                href={`/interact-demo?address=${deployedAddress}`}
                className="block text-xs text-center py-1.5 rounded"
                style={{ background: '#0e639c', color: '#ffffff' }}
              >
                Interact with Demo →
              </Link>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
