'use client';

import { useState, useEffect } from 'react';
import { getContractABI, callContractMethod, ABI, ABIMethod } from '../lib/genlayer';

interface Props {
  contractAddress: string;
}

function InputField({
  param,
  value,
  onChange,
}: {
  param: { name: string; type: string };
  value: string;
  onChange: (v: string) => void;
}) {
  const type = param.type.toLowerCase();

  if (type === 'bool') {
    return (
      <label className="flex items-center gap-2 text-sm text-neutral-700">
        <input
          type="checkbox"
          checked={value === 'true'}
          onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
          className="rounded"
        />
        {param.name}
      </label>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
        {param.name}
        <span className="ml-1 font-normal normal-case text-neutral-400">({param.type})</span>
      </label>
      <input
        type={type.includes('int') ? 'number' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={param.type}
        className="border border-neutral-200 rounded-lg px-3 py-2 text-sm font-mono text-neutral-900 bg-white focus:outline-none focus:border-neutral-900 transition-colors"
      />
    </div>
  );
}

export default function ContractPlayground({ contractAddress }: Props) {
  const [abi, setAbi] = useState<ABI | null>(null);
  const [loadingAbi, setLoadingAbi] = useState(true);
  const [abiError, setAbiError] = useState<string | null>(null);

  const [selectedMethod, setSelectedMethod] = useState<ABIMethod | null>(null);
  const [argValues, setArgValues] = useState<Record<string, string>>({});
  const [calling, setCalling] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [callError, setCallError] = useState<string | null>(null);

  useEffect(() => {
    setLoadingAbi(true);
    setAbiError(null);
    getContractABI(contractAddress)
      .then((response) => {
        const methods = Array.isArray(response)
          ? response
          : Array.isArray((response as any)?.abi)
            ? (response as any).abi
            : Array.isArray((response as any)?.methods)
              ? (response as any).methods
              : Array.isArray((response as any)?.schema)
                ? (response as any).schema
                : [];

        setAbi(methods as ABI);

        const firstReadonly = methods.find((m: ABIMethod) => m.readonly);

        if (firstReadonly) {
          setSelectedMethod(firstReadonly);
          setArgValues({});
        } else {
          setSelectedMethod(null);
        }
      })
      .catch((e) => setAbiError(e.message))
      .finally(() => setLoadingAbi(false));
  }, [contractAddress]);

  function selectMethod(method: ABIMethod) {
    setSelectedMethod(method);
    setArgValues({});
    setResult(null);
    setCallError(null);
  }

  async function handleCall() {
    if (!selectedMethod) return;
    setCalling(true);
    setResult(null);
    setCallError(null);
    try {
      const methodInputs = Array.isArray(selectedMethod.inputs) ? selectedMethod.inputs : [];

      const args = methodInputs.map((p) => {
        const raw = argValues[p.name] ?? '';
        const t = p.type.toLowerCase();
        if (t === 'bool') return raw === 'true';
        if (t.includes('int')) return Number(raw);
        return raw;
      });
      const output = await callContractMethod(contractAddress, selectedMethod.name, args);
      setResult(output);
    } catch (e: any) {
      setCallError(e.message);
    } finally {
      setCalling(false);
    }
  }

  if (loadingAbi) {
    return (
      <div className="border border-neutral-200 rounded-2xl p-6 animate-pulse">
        <div className="h-4 bg-neutral-100 rounded w-1/3 mb-3" />
        <div className="h-8 bg-neutral-100 rounded w-full" />
      </div>
    );
  }

  if (abiError) {
    return (
      <div className="border border-red-200 bg-red-50 rounded-2xl p-6 text-sm text-red-700">
        Failed to load contract ABI: {abiError}
      </div>
    );
  }

  const safeAbi = Array.isArray(abi) ? abi : [];

  if (safeAbi.length === 0) {
    return (
      <div className="border border-neutral-200 rounded-2xl p-6 text-sm text-neutral-500">
        No public methods found for this contract.
      </div>
    );
  }

  const readMethods = safeAbi.filter((m) => m.readonly);

  return (
    <div className="border border-neutral-200 rounded-2xl overflow-hidden">
      {/* Method selector */}
      <div className="flex flex-wrap gap-2 p-4 border-b border-neutral-100 bg-neutral-50">
        {readMethods.map((m) => (
          <button
            key={m.name}
            onClick={() => selectMethod(m)}
            className={`text-xs font-mono px-3 py-1.5 rounded-full border transition-colors ${
              selectedMethod?.name === m.name
                ? 'bg-neutral-900 text-[#F7F4EF] border-neutral-900'
                : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-400'
            }`}
          >
            {m.name}
          </button>
        ))}
      </div>

      {/* Inputs + call */}
      {selectedMethod && (
        <div className="p-5 flex flex-col gap-4">
          {(Array.isArray(selectedMethod.inputs) ? selectedMethod.inputs : []).length > 0 && (
            <div className="flex flex-col gap-3">
              {(Array.isArray(selectedMethod.inputs) ? selectedMethod.inputs : []).map((p) => (
                <InputField
                  key={p.name}
                  param={p}
                  value={argValues[p.name] ?? ''}
                  onChange={(v) => setArgValues((prev) => ({ ...prev, [p.name]: v }))}
                />
              ))}
            </div>
          )}

          <button
            onClick={handleCall}
            disabled={calling}
            className="bg-neutral-900 text-[#F7F4EF] text-sm font-medium py-2.5 rounded-xl hover:bg-neutral-700 transition-colors disabled:opacity-50"
          >
            {calling ? 'Calling…' : `Call ${selectedMethod.name}()`}
          </button>

          {callError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">
              {callError}
            </p>
          )}

          {result !== null && (
            <pre className="text-xs font-mono bg-neutral-50 border border-neutral-200 rounded-xl p-4 overflow-x-auto whitespace-pre-wrap break-all text-neutral-800">
              {JSON.stringify(result, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
