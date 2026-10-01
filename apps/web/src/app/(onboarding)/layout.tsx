import { redirect } from "next/navigation";
import { getSession } from "~/lib/session";

export const dynamic = "force-dynamic";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  if (!session) {
    redirect("/sign-in");
  }

  return <main className="flex min-h-screen items-center justify-center p-4">{children}</main>;
}
