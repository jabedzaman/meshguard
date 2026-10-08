import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@meshguard/ui/components/button";
import { Input } from "@meshguard/ui/components/input";
import { Label } from "@meshguard/ui/components/label";
import { agent, errorMessage, type PendingLogin } from "~/lib/agent";

export function SignIn() {
  const [pending, setPending] = useState<PendingLogin | null>(null);
  const [starting, setStarting] = useState(false);
  const [token, setToken] = useState("");
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    // Success changes the agent's state, which swaps this screen out.
    const un = listen<string | null>("login-finished", (e) => {
      setPending(null);
      if (e.payload && e.payload !== "cancelled") toast.error(e.payload);
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  async function start() {
    setStarting(true);
    try {
      setPending(await agent.loginStart());
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setStarting(false);
    }
  }

  async function cancel() {
    await agent.loginCancel();
    setPending(null);
  }

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setJoining(true);
    try {
      await agent.joinWithToken(token.trim());
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6">
      <div className="text-center">
        <h1 className="text-xl font-semibold">Sign in to MeshGuard</h1>
        <p className="text-muted-foreground mt-1 text-sm">Approve this device for a network in your browser.</p>
      </div>

      {pending ? (
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-muted-foreground text-sm">Check that the code matches</p>
          <p className="font-mono text-3xl font-semibold tracking-widest">{pending.userCode}</p>
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" /> Waiting for approval…
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => openUrl(pending.verificationUrl)}>
              Open browser again
            </Button>
            <Button variant="ghost" size="sm" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button onClick={start} disabled={starting}>
          {starting && <Loader2 className="animate-spin" />}
          Sign in with browser
        </Button>
      )}

      <form onSubmit={join} className="flex flex-col gap-2 border-t pt-6">
        <Label htmlFor="token">Or join with an enrollment token</Label>
        <div className="flex gap-2">
          <Input
            id="token"
            placeholder="meshguard_enr_…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <Button type="submit" variant="secondary" disabled={!token.trim() || joining}>
            {joining && <Loader2 className="animate-spin" />}
            Join
          </Button>
        </div>
      </form>
    </div>
  );
}
