// Numbers every `###` heading inside, e.g. <Steps>### Install ... ### Join</Steps>.
export function Steps({ children }: { children: React.ReactNode }) {
  return (
    <div className="ml-3 border-l pl-6 [counter-reset:step] [&>h3]:[counter-increment:step] [&>h3]:before:-ml-[2.6rem] [&>h3]:before:mr-3 [&>h3]:before:inline-flex [&>h3]:before:size-7 [&>h3]:before:items-center [&>h3]:before:justify-center [&>h3]:before:rounded-full [&>h3]:before:border [&>h3]:before:bg-background [&>h3]:before:text-sm [&>h3]:before:content-[counter(step)]">
      {children}
    </div>
  );
}
