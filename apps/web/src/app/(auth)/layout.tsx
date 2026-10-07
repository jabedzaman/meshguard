import { Logo } from "~/components/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-4">
      <Logo />
      {children}
    </main>
  );
}
