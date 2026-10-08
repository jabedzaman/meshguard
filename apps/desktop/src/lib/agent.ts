import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

export type Peer = {
  name: string;
  dnsName: string;
  meshIpv4: string;
  meshIpv6: string;
  endpoint?: string;
  viaRelay?: boolean;
  lastHandshake?: string;
};

/** The agent's GET /v1/status (internal/ipc.Status), the parts the app shows. */
export type Status = {
  version: string;
  state: "not_enrolled" | "down" | "enrolled" | "connected";
  problem?: string;
  device?: { id: string; name: string; meshIpv4: string; meshIpv6: string };
  network?: { id: string; name: string };
  server?: string;
  relay?: { url: string; connected: boolean };
  publicEndpoint?: string;
  peers?: Peer[];
};

export type AgentState =
  | { kind: "not_installed" }
  | { kind: "not_running" }
  | { kind: "denied"; message: string }
  | { kind: "running"; status: Status };

export type DisplayMode = "tray_and_window" | "tray_only" | "window_only";

export type Settings = {
  display: DisplayMode;
  launchAtLogin: boolean;
  startHidden: boolean;
  closeToTray: boolean;
  server: string;
  socket: string;
};

export type PendingLogin = { userCode: string; verificationUrl: string; expiresIn: number };

export const agent = {
  setConnected: (connected: boolean) => invoke<void>("set_connected", { connected }),
  logout: (force = false) => invoke<void>("logout", { force }),
  joinWithToken: (token: string) => invoke<void>("join_with_token", { token }),
  loginStart: () => invoke<PendingLogin>("login_start"),
  loginCancel: () => invoke<void>("login_cancel"),
  install: () => invoke<void>("install_agent"),
  uninstall: () => invoke<void>("uninstall_agent"),
  quit: () => invoke<void>("quit"),
};

export function errorMessage(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : "something went wrong";
}

export function useAgentState(): AgentState | null {
  const [state, setState] = useState<AgentState | null>(null);
  useEffect(() => {
    let live = true;
    invoke<AgentState>("agent_state").then((s) => live && setState((cur) => cur ?? s));
    const un = listen<AgentState>("agent-state", (e) => setState(e.payload));
    return () => {
      live = false;
      un.then((f) => f());
    };
  }, []);
  return state;
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    invoke<Settings>("get_settings").then(setSettings);
  }, []);
  const update = async (patch: Partial<Settings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      setSettings(await invoke<Settings>("set_settings", { settings: next }));
    } catch (e) {
      setSettings(settings);
      throw e;
    }
  };
  return { settings, update };
}
