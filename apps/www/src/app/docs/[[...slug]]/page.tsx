import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsPager } from "~/components/docs/pager";
import { DocsToc } from "~/components/docs/toc";
import { source } from "~/lib/source";
import { getMDXComponents } from "~/mdx-components";

export function generateStaticParams() {
  return source.getPages().map((page) => ({ slug: page.slugs }));
}

export async function generateMetadata({ params }: PageProps<"/docs/[[...slug]]">): Promise<Metadata> {
  const page = source.getPage((await params).slug);
  if (!page) return {};
  return { title: page.title, description: page.description };
}

export default async function DocsPage({ params }: PageProps<"/docs/[[...slug]]">) {
  const page = source.getPage((await params).slug);
  if (!page) notFound();

  const { default: Content } = await page.load();

  return (
    <div className="grid grid-cols-1 gap-10 xl:grid-cols-[minmax(0,1fr)_220px]">
      <article className="min-w-0 max-w-3xl">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">{page.title}</h1>
          {page.description ? (
            <p className="mt-2 text-lg text-muted-foreground">{page.description}</p>
          ) : null}
        </header>
        <div className="prose prose-neutral dark:prose-invert max-w-none prose-headings:scroll-mt-24 prose-headings:font-semibold prose-pre:bg-muted prose-pre:text-foreground prose-code:before:content-none prose-code:after:content-none">
          <Content components={getMDXComponents()} />
        </div>
        <DocsPager url={page.url} />
      </article>
      <DocsToc items={page.toc} />
    </div>
  );
}
