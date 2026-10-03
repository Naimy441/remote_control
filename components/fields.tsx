"use client";

import { KeyRound, Laptop, type LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";

export function ConnectionFields({
  agentUrl,
  token,
  onUrl,
  onToken,
}: {
  agentUrl: string;
  token: string;
  onUrl: (value: string) => void;
  onToken: (value: string) => void;
}) {
  return (
    <div className="fields">
      <label>
        <span className="label-icon"><Laptop aria-hidden="true" />Mac agent</span>
        <input
          value={agentUrl}
          onChange={(event) => onUrl(event.target.value)}
          placeholder="ws://100.x.x.x:8787"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="url"
        />
      </label>
      <label>
        <span className="label-icon"><KeyRound aria-hidden="true" />Token</span>
        <input
          value={token}
          onChange={(event) => onToken(event.target.value.toUpperCase())}
          placeholder="ABCD-EFGH"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
        />
      </label>
    </div>
  );
}

export function Slider({
  icon: Icon,
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  icon?: LucideIcon;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="slider">
      <span className="label-icon">{Icon ? <Icon aria-hidden="true" /> : null}{label}</span>
      <strong>{value.toFixed(1)}</strong>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--v": `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
