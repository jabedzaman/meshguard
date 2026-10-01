// proxy.ts guarantees a session on these routes.
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-screen items-center justify-center p-4">{children}</main>;
}
