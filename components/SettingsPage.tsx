"use client";

import {
  AppWindow,
  ArrowLeftRight,
  ArrowUpDown,
  Cable,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Crosshair,
  Globe,
  Hand,
  Keyboard,
  Mouse,
  MousePointer2,
  Move3d,
  PanelLeft,
  PanelTop,
  PanelRight,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Smartphone,
  Unplug,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ConnectionFields, Slider } from "@/components/fields";
import { quickIcons } from "@/components/quickIcons";
import { defaultQuick, quickGroups, quickMeta, type QuickGroup, type QuickId } from "@/lib/quick";

const groupIcons: Record<QuickGroup, LucideIcon> = {
  Keys: Keyboard,
  Pointer: MousePointer2,
  Windows: AppWindow,
  Browser: Globe,
};

function Heading({ icon: Icon, children }: { icon: LucideIcon; children: string }) {
  return (
    <h2 className="sp-title">
      <Icon aria-hidden="true" />
      {children}
    </h2>
  );
}

/** Screen and viewport numbers, for tracking down layout gaps in a Home Screen app. */
function DisplayInfo() {
  const [rows, setRows] = useState<string[]>([]);

  useEffect(() => {
    const read = () => {
      const probe = document.createElement("div");
      probe.style.cssText = "position:fixed;visibility:hidden;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom) 0";
      document.body.appendChild(probe);
      const style = getComputedStyle(probe);
      const top = style.paddingTop;
      const bottom = style.paddingBottom;
      probe.remove();
      const app = document.querySelector(".remote")?.getBoundingClientRect();
      const visual = window.visualViewport;
      const standalone =
        (navigator as Navigator & { standalone?: boolean }).standalone === true ||
        window.matchMedia("(display-mode: standalone)").matches;
      setRows([
        `Home Screen app: ${standalone ? "yes" : "no"}`,
        `Window: ${window.innerWidth} × ${window.innerHeight}`,
        `Visual viewport: ${Math.round(visual?.width ?? 0)} × ${Math.round(visual?.height ?? 0)}`,
        `Screen: ${window.screen.width} × ${window.screen.height}`,
        `Safe area top / bottom: ${top} / ${bottom}`,
        `App bottom edge: ${Math.round(app?.bottom ?? 0)}`,
      ]);
    };
    const timer = window.setTimeout(read, 0);
    window.addEventListener("resize", read);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", read);
    };
  }, []);

  return (
    <ul className="display-info">
      {rows.map((row) => (
        <li key={row}>{row}</li>
      ))}
    </ul>
  );
}

export type SettingsPageProps = {
  state: "open" | "closed";
  onClose: () => void;
  agentUrl: string;
  token: string;
  onUrl: (value: string) => void;
  onToken: (value: string) => void;
  onReconnect: () => void;
  onDisconnect: () => void;
  sens: number;
  onSens: (value: number) => void;
  scrollSens: number;
  onScrollSens: (value: number) => void;
  gyroSens: number;
  onGyroSens: (value: number) => void;
  onCalibrate: () => void;
  onTremor: () => void;
  onResetGyro: () => void;
  quick: QuickId[];
  onQuick: (ids: QuickId[]) => void;
  leftHanded: boolean;
  onLeftHanded: (value: boolean) => void;
  allTabs: boolean;
  onAllTabs: (value: boolean) => void;
};

export function SettingsPage(props: SettingsPageProps) {
  const { quick, onQuick } = props;

  function toggle(id: QuickId) {
    onQuick(quick.includes(id) ? quick.filter((item) => item !== id) : [...quick, id]);
  }

  function move(index: number, by: number) {
    const target = index + by;
    if (target < 0 || target >= quick.length) return;
    const next = [...quick];
    [next[index], next[target]] = [next[target], next[index]];
    onQuick(next);
  }

  return (
    <section className="settings-page" data-state={props.state} aria-label="Settings">
      <header className="sp-head">
        <button type="button" className="icon-button" aria-label="Back to controls" onClick={props.onClose}>
          <ChevronLeft />
        </button>
        <h1>Settings</h1>
      </header>

      <div className="sp-body" data-scroll>
        <section className="sp-card">
          <Heading icon={Cable}>Connection</Heading>
          <ConnectionFields agentUrl={props.agentUrl} token={props.token} onUrl={props.onUrl} onToken={props.onToken} />
          <div className="sheet-actions">
            <button type="button" className="primary" onClick={props.onReconnect}><RefreshCw aria-hidden="true" />Reconnect</button>
            <button type="button" onClick={props.onDisconnect}><Unplug aria-hidden="true" />Disconnect</button>
          </div>
        </section>

        <section className="sp-card">
          <Heading icon={Mouse}>Pointer and scroll</Heading>
          <Slider icon={MousePointer2} label="Pointer speed" value={props.sens} min={0.4} max={4} step={0.1} onChange={props.onSens} />
          <Slider icon={ArrowUpDown} label="Scroll speed" value={props.scrollSens} min={0.5} max={8} step={0.1} onChange={props.onScrollSens} />
          <p className="fine">Pinch zooms the active app.</p>
        </section>

        <section className="sp-card">
          <Heading icon={Move3d}>Gyro pointer</Heading>
          <Slider icon={SlidersHorizontal} label="Range" value={props.gyroSens} min={0.3} max={3} step={0.1} onChange={props.onGyroSens} />
          <div className="sheet-actions">
            <button type="button" className="primary" onClick={props.onCalibrate}><Crosshair aria-hidden="true" />Calibrate</button>
            <button type="button" onClick={props.onResetGyro}><RotateCcw aria-hidden="true" />Reset</button>
          </div>
          <button type="button" onClick={props.onTremor}><Hand aria-hidden="true" />Measure hand tremor</button>
        </section>

        <section className="sp-card">
          <Heading icon={ArrowLeftRight}>Handedness</Heading>
          <div className="seg hand-seg" role="group" aria-label="Which hand you use">
            <button type="button" data-on={props.leftHanded ? "false" : "true"} aria-pressed={!props.leftHanded} onClick={() => props.onLeftHanded(false)}>
              <PanelRight aria-hidden="true" />
              Right-handed
            </button>
            <button type="button" data-on={props.leftHanded ? "true" : "false"} aria-pressed={props.leftHanded} onClick={() => props.onLeftHanded(true)}>
              <PanelLeft aria-hidden="true" />
              Left-handed
            </button>
          </div>
          <p className="fine">Moves the quick buttons, dock and tabs to the left.</p>
        </section>

        <section className="sp-card">
          <Heading icon={PanelTop}>Web tabs</Heading>
          <button type="button" data-on={props.allTabs ? "true" : "false"} aria-pressed={props.allTabs} onClick={() => props.onAllTabs(!props.allTabs)}>
            <Globe aria-hidden="true" />
            Always show web tabs
          </button>
          <p className="fine">Keep tabs showing for every open browser.</p>
        </section>

        <section className="sp-card">
          <Heading icon={Zap}>Quick buttons</Heading>
          <p className="fine">Shown at the trackpad edge. Swipe to see more.</p>

          {quick.length ? (
            <ol className="qe-list">
              {quick.map((id, index) => {
                const Icon = quickIcons[id];
                return (
                  <li key={id} className="qe-row">
                    <span className="qe-icon"><Icon /></span>
                    <span className="qe-label">{quickMeta[id].label}</span>
                    <button type="button" className="icon-button" aria-label={`Move ${quickMeta[id].label} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                      <ChevronUp />
                    </button>
                    <button type="button" className="icon-button" aria-label={`Move ${quickMeta[id].label} down`} disabled={index === quick.length - 1} onClick={() => move(index, 1)}>
                      <ChevronDown />
                    </button>
                    <button type="button" className="icon-button" aria-label={`Remove ${quickMeta[id].label}`} onClick={() => toggle(id)}>
                      <X />
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="fine">No quick buttons. Add some below.</p>
          )}

          {quickGroups.map((group) => {
            const GroupIcon = groupIcons[group];
            return (
            <div key={group} className="qe-group">
              <h3>
                <GroupIcon aria-hidden="true" />
                {group}
              </h3>
              <div className="qe-grid">
                {(Object.keys(quickMeta) as QuickId[])
                  .filter((id) => quickMeta[id].group === group)
                  .map((id) => {
                    const Icon = quickIcons[id];
                    const on = quick.includes(id);
                    return (
                      <button key={id} type="button" className="qe-tile" data-on={on ? "true" : "false"} aria-pressed={on} onClick={() => toggle(id)}>
                        <Icon />
                        <span>{quickMeta[id].label}</span>
                      </button>
                    );
                  })}
              </div>
            </div>
            );
          })}

          <button type="button" onClick={() => onQuick(defaultQuick)}><RotateCcw aria-hidden="true" />Reset to defaults</button>
        </section>

        <section className="sp-card">
          <Heading icon={Smartphone}>Display</Heading>
          <DisplayInfo />
        </section>
      </div>
    </section>
  );
}
