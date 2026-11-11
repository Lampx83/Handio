import type { PageReport, PageStep } from "@neu/agent-core";

export interface ModelConn {
  baseUrl: string;
  model: string;
  key?: string;
  keyHeader?: string;
  authHeaders: (() => Promise<Record<string, string> | null>) | null;
}
export function connectModel(o?: { retry?: string }): Promise<ModelConn>;
export function electronBin(root: string): string;

export interface ProbeStep {
  label?: string;
  note?: string;
  wait?: number;
  value?: string;
  eval?: string;
  fill?: { placeholder?: string; label?: string; selector?: string };
  click?: { text?: string; selector?: string };
}
export interface ProbeResult {
  error?: string;
  loaded?: boolean;
  errors?: string[];
  failedRequests?: string[];
  blank?: boolean;
  overlay?: string;
  title?: string;
  text?: string;
  buttons?: string[];
  steps?: { label: string; ok: boolean; note?: string; errors: string[]; dialogs?: string[] }[];
}
export function runProbe(cfg: { url: string; steps?: ProbeStep[]; stopOnFail?: boolean; settleMs?: number; root?: string }, where: { root: string; tmpDir: string }): Promise<ProbeResult>;
export function toProbeSteps(steps?: PageStep[]): ProbeStep[];
export function probeCheckPage(url: string, o: { waitMs: number; steps?: PageStep[]; root: string }, where: { root: string; tmpDir: string }): Promise<PageReport>;
