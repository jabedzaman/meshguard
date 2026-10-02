import { Button } from "@meshguard/ui/components/button";

function App() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">MeshGuard</h1>
      <p className="text-muted-foreground text-sm">Agent not connected</p>
      <Button>Connect</Button>
    </main>
  );
}

export default App;
