import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Toaster } from "@meshguard/ui/components/sonner";
import { SidebarInset, SidebarProvider } from "@meshguard/ui/components/sidebar";
import { AppSidebar, type Page } from "~/components/app-sidebar";
import { Devices } from "~/components/devices";
import { Logo } from "~/components/logo";
import { Overview } from "~/components/overview";
import { Settings } from "~/components/settings";
import { SignIn } from "~/components/sign-in";
import { Setup } from "~/components/setup";
import { useAgentState, type Status } from "~/lib/agent";

/** The title bar: a quiet label centered between the window edges; the rest is for dragging. */
function TitleBar({ status }: { status: Status }) {
  return (
    <header
      data-tauri-drag-region
      className="pointer-events-auto fixed inset-x-0 top-0 z-20 flex h-[30px] items-center justify-center"
    >
      <p className="text-muted-foreground pointer-events-none text-xs font-medium tracking-wide">
        {status.network?.name}
      </p>
    </header>
  );
}

function App() {
  const state = useAgentState();
  const [page, setPage] = useState<Page>("overview");

  useEffect(() => {
    // The tray's "Settings…" item.
    const un = listen<Page>("navigate", (e) => setPage(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, []);

  const status = state?.kind === "running" ? state.status : null;
  const signedIn = !!status && status.state !== "not_enrolled";

  return (
    <>
      {signedIn ? (
        <SidebarProvider>
          <TitleBar status={status} />
          <AppSidebar status={status} page={page} onNavigate={setPage} />
          <SidebarInset className="glass bg-card m-0! mt-9! mr-4! mb-4! h-[calc(100svh-3.25rem)] min-h-0 overflow-hidden">
            <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
              <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col">
                {page === "overview" ? (
                  <Overview status={status} />
                ) : page === "devices" ? (
                  <Devices status={status} />
                ) : (
                  <Settings signedIn />
                )}
              </div>
            </main>
          </SidebarInset>
        </SidebarProvider>
      ) : (
        <div className="flex h-screen flex-col">
          <header data-tauri-drag-region className="h-12 shrink-0" />
          <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 px-6 pb-6">
            {state && <Logo />}
            {!state ? null : state.kind !== "running" ? <Setup state={state} /> : <SignIn />}
          </main>
        </div>
      )}
      <Toaster position="bottom-center" />
    </>
  );
}

export default App;
