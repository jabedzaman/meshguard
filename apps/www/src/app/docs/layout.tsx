import { DocsHeader } from "~/components/docs/header";
import { DocsSidebar } from "~/components/docs/sidebar";
import { source } from "~/lib/source";

export default function DocsLayout({ children }: LayoutProps<"/docs">) {
  const tree = source.getTree();

  return (
    <div className="min-h-screen">
      <DocsHeader />
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-4 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:px-8">
        <DocsSidebar tree={tree} />
        <main className="min-w-0 py-10 lg:py-14">{children}</main>
      </div>
    </div>
  );
}
