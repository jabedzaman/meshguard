import { Logo } from "~/components/logo";

// proxy.ts guarantees a session on these routes.
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-4">
      <Logo />
      {children}
    </main>
  );
}
