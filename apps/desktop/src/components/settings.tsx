import {
  AppWindowIcon,
  GlobeIcon,
  LogOutIcon,
  RefreshCwIcon,
  RocketIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UserIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@meshguard/ui/components/button";
import { Input } from "@meshguard/ui/components/input";
import { Label } from "@meshguard/ui/components/label";
import { RadioGroup, RadioGroupItem } from "@meshguard/ui/components/radio-group";
import { Separator } from "@meshguard/ui/components/separator";
import { Switch } from "@meshguard/ui/components/switch";
import { PageHeader } from "~/components/page-header";
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
  const service = (action: () => Promise<void>) => () =>
    action().catch((e) => errorMessage(e) !== "cancelled" && toast.error(errorMessage(e)));

  return (
    <div className="flex flex-col gap-8 pb-8">
      <PageHeader title="Settings" description="How MeshGuard behaves on this computer." />

      <Section icon={AppWindowIcon} title="Appearance" description="Where MeshGuard lives on your desktop.">
        <RadioGroup
          value={settings.display}
          onValueChange={(v) => save({ display: v as DisplayMode })}
          className="divide-border divide-y"
        >
          {displayModes.map((m) => (
            <Label key={m.value} className="flex cursor-pointer items-center gap-3 py-3 font-normal first:pt-0 last:pb-0">
              <RadioGroupItem value={m.value} />
              <span className="grid gap-0.5">
                <span className="font-medium">{m.label}</span>
                <span className="text-muted-foreground text-xs">{m.hint}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
      </Section>

      <Separator />

      <Section icon={RocketIcon} title="Startup">
        <div className="divide-border divide-y">
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
        </div>
      </Section>

      <Separator />

      <Section icon={GlobeIcon} title="Control plane" description="Used when signing in. Applies to the next sign-in.">
        <Input
          defaultValue={settings.server}
          onBlur={(e) => e.target.value !== settings.server && save({ server: e.target.value.trim() })}
          spellCheck={false}
          className="font-mono"
        />
      </Section>

      <Separator />

      {signedIn && (
        <>
          <Section icon={UserIcon} title="Account">
            <ActionRow
              label="Sign out"
              hint="Removes this device from the network."
              action="Sign out"
              icon={LogOutIcon}
              onClick={service(() => agent.logout())}
            />
          </Section>

          <Separator />
        </>
      )}

      <Section icon={ShieldCheckIcon} title="Service" description="The background service that manages your connection.">
        <div className="divide-border divide-y">
          <ActionRow
            label="Reinstall service"
            hint="Restarts it. Use this if the app can't reach it."
            action="Reinstall"
            icon={RefreshCwIcon}
            onClick={service(() => agent.install())}
          />
          <ActionRow
            label="Uninstall service"
            hint="Stops and removes it. Your binaries and state are kept."
            action="Uninstall"
            icon={Trash2Icon}
            destructive
            onClick={service(() => agent.uninstall())}
          />
        </div>
      </Section>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof RocketIcon;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-4 md:grid-cols-[14rem_1fr] md:gap-8">
      <div className="grid content-start">
        <h2 className="flex h-9 items-center gap-2 text-sm font-medium">
          <Icon className="text-muted-foreground size-4" />
          {title}
        </h2>
        {description && <p className="text-muted-foreground -mt-1 text-xs">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function ActionRow({
  label,
  hint,
  action,
  icon: Icon,
  destructive,
  onClick,
}: {
  label: string;
  hint: string;
  action: string;
  icon: typeof RocketIcon;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <span className="grid gap-0.5">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground text-xs">{hint}</span>
      </span>
      <Button variant="ghost" className={destructive ? "text-destructive hover:text-destructive" : undefined} onClick={onClick}>
        <Icon />
        {action}
      </Button>
    </div>
  );
}

function Row({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Label className="flex items-center justify-between gap-4 py-3 font-normal first:pt-0 last:pb-0">
      <span className="grid gap-0.5">
        <span className="font-medium">{label}</span>
        {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </Label>
  );
}
