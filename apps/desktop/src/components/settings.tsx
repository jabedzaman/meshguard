import { toast } from "sonner";
import { Button } from "@meshguard/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@meshguard/ui/components/card";
import { Input } from "@meshguard/ui/components/input";
import { Label } from "@meshguard/ui/components/label";
import { RadioGroup, RadioGroupItem } from "@meshguard/ui/components/radio-group";
import { Switch } from "@meshguard/ui/components/switch";
import { agent, errorMessage, useSettings, type DisplayMode } from "~/lib/agent";

const displayModes: { value: DisplayMode; label: string; hint: string }[] = [
  { value: "tray_and_window", label: "Menu bar and window", hint: "A tray icon, plus a normal app window." },
  { value: "tray_only", label: "Menu bar only", hint: "No Dock icon. Open the window from the tray." },
  { value: "window_only", label: "Window only", hint: "No tray icon." },
];

export function Settings({ signedIn }: { signedIn: boolean }) {
  const { settings, update } = useSettings();
  if (!settings) return null;

  const save = (patch: Parameters<typeof update>[0]) => update(patch).catch((e) => toast.error(errorMessage(e)));

  return (
    <div className="flex flex-col gap-4 overflow-y-auto pb-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Appearance</CardTitle>
          <CardDescription>Where MeshGuard lives on your desktop.</CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup value={settings.display} onValueChange={(v) => save({ display: v as DisplayMode })}>
            {displayModes.map((m) => (
              <Label key={m.value} className="flex items-start gap-3 font-normal">
                <RadioGroupItem value={m.value} className="mt-0.5" />
                <span>
                  <span className="block font-medium">{m.label}</span>
                  <span className="text-muted-foreground text-xs">{m.hint}</span>
                </span>
              </Label>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Startup</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Row label="Launch at login" checked={settings.launchAtLogin} onChange={(v) => save({ launchAtLogin: v })} />
          <Row
            label="Start hidden"
            hint="At login, stay in the tray instead of opening the window."
            checked={settings.startHidden}
            onChange={(v) => save({ startHidden: v })}
          />
          <Row
            label="Keep running when the window is closed"
            checked={settings.closeToTray}
            onChange={(v) => save({ closeToTray: v })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Control plane</CardTitle>
          <CardDescription>Used when signing in. Applies to the next sign-in.</CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            defaultValue={settings.server}
            onBlur={(e) => e.target.value !== settings.server && save({ server: e.target.value.trim() })}
            spellCheck={false}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Account and service</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {signedIn && (
            <Button variant="outline" onClick={() => agent.logout().catch((e) => toast.error(errorMessage(e)))}>
              Sign out
            </Button>
          )}
          <Button variant="outline" onClick={() => agent.install().catch((e) => errorMessage(e) !== "cancelled" && toast.error(errorMessage(e)))}>
            Reinstall service
          </Button>
          <Button variant="outline" onClick={() => agent.uninstall().catch((e) => errorMessage(e) !== "cancelled" && toast.error(errorMessage(e)))}>
            Uninstall service
          </Button>
          <Button variant="ghost" onClick={() => agent.quit()}>
            Quit MeshGuard
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Label className="flex items-center justify-between gap-4 font-normal">
      <span>
        <span className="block font-medium">{label}</span>
        {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </Label>
  );
}
