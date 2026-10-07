import { BookOpen, Network } from "lucide-react";
import Link from "next/link";
import { Button } from "@meshguard/ui/components/button";

const GITHUB_URL = "https://github.com/jabedzaman/meshguard";

const features = [
  ["Private mesh", "WireGuard tunnels between all your devices, no open ports"],
  ["Hole punching", "direct peer-to-peer connections, with a relay as fallback"],
  ["Private DNS", "reach devices by name under your network's own domain"],
  ["Remote dev environments", "SSH into any machine on the mesh as if it were local"],
  ["Scriptable CLI", "one `meshguard` command talks to the local agent"],
  ["Lightweight agent", "a single Go binary running as a launchd or systemd service"],
  ["Open source", "free and self-hostable"],
] as const;

function GithubMark() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.69 5.4-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

export default function Home() {
  return (
    <>
      <header className="mx-auto flex h-14 w-full max-w-5xl items-center justify-end gap-5 px-6 text-sm text-muted-foreground">
        <Link href="/docs" className="hover:text-foreground">
          Docs
        </Link>
        <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="hover:text-foreground">
          GitHub
        </a>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 pt-20 pb-24 sm:pt-28">
        <div className="flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Network className="size-6" />
          </span>
          <span className="text-2xl font-semibold tracking-tight">MeshGuard</span>
        </div>

        <h1 className="mt-16 text-lg font-medium sm:mt-20">Private networking for your own machines</h1>
        <p className="mt-4 text-muted-foreground leading-relaxed">
          Free and open source mesh networking built on WireGuard. Connect laptops, servers and homelab boxes into
          one private network, reach them by name, and work on remote dev environments as if they were next to you.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href="/docs/getting-started/installation">
              <BookOpen />
              Get started
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">
              <GithubMark />
              View on GitHub
            </a>
          </Button>
        </div>

        <h2 className="mt-14 text-xs text-muted-foreground">Features</h2>
        <ul className="mt-4 space-y-3 text-sm sm:text-[15px]">
          {features.map(([name, description]) => (
            <li key={name} className="flex gap-3">
              <span className="text-muted-foreground">-</span>
              <span>
                <strong className="font-semibold">{name}</strong>
                <span className="text-muted-foreground">: {description}</span>
              </span>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
