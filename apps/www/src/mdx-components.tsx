import type { MDXComponents } from "mdx/types";
import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";
import { Callout } from "~/components/mdx/callout";
import { Steps } from "~/components/mdx/steps";

function MdxLink({ href = "", ...props }: ComponentPropsWithoutRef<"a">) {
  if (href.startsWith("/")) return <Link href={href} {...props} />;
  if (href.startsWith("http")) return <a href={href} target="_blank" rel="noreferrer" {...props} />;
  return <a href={href} {...props} />;
}

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    a: MdxLink,
    table: (props) => (
      <div className="overflow-x-auto">
        <table {...props} />
      </div>
    ),
    Callout,
    Steps,
    ...components,
  };
}

export function useMDXComponents(components?: MDXComponents): MDXComponents {
  return getMDXComponents(components);
}
