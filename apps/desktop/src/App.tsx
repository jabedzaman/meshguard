import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Toaster } from "@meshguard/ui/components/sonner";
import { Tabs, TabsList, TabsTrigger } from "@meshguard/ui/components/tabs";
import { Devices } from "~/components/devices";
import { Settings } from "~/components/settings";
import { SignIn } from "~/components/sign-in";
import { Setup } from "~/components/setup";
import { useAgentState } from "~/lib/agent";

type Tab = "devices" | "settings";

function App() {
  const state = useAgentState();
  const [tab, setTab] = useState<Tab>("devices");

  useEffect(() => {
    // The tray's "Settings…" item.
    const un = listen<Tab>("navigate", (e) => setTab(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, []);

  const status = state?.kind === "running" ? state.status : null;
  const signedIn = !!status && status.state !== "not_enrolled";

  return (
    <div className="flex h-screen flex-col">
      {/* Draggable title bar; leaves room for the macOS window buttons. */}
      <header data-tauri-drag-region className="flex h-12 shrink-0 items-center justify-center pl-20 pr-4">
        {signedIn && (
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList>
              <TabsTrigger value="devices">Devices</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </header>
      <main className="flex min-h-0 flex-1 flex-col px-6 pb-6">
        {!state ? null : state.kind !== "running" ? (
          <Setup state={state} />
        ) : !signedIn ? (
          <SignIn />
        ) : tab === "devices" ? (
          <Devices status={state.status} />
        ) : (
          <Settings signedIn />
        )}
      </main>
      <Toaster position="bottom-center" />
    </div>
  );
}

export default App;
