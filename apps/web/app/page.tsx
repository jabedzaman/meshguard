import { Button } from "@mesh/ui/components/button";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">Mesh</h1>
      <Button>Sign in</Button>
    </main>
  );
}
