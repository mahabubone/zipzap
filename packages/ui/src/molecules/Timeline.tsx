export interface TimelineEvent {
  readonly at: string;
  readonly label: string;
  readonly detail?: string;
}

export function Timeline({ events }: { readonly events: ReadonlyArray<TimelineEvent> }) {
  return (
    <ol className="relative flex flex-col gap-4 border-l border-slate-200 pl-6">
      {events.map((e, i) => (
        <li key={i} className="relative">
          <span className="absolute -left-[31px] top-1 size-2.5 rounded-full bg-brand-500" />
          <p className="text-sm font-medium text-slate-800">{e.label}</p>
          {e.detail ? <p className="text-xs text-slate-500">{e.detail}</p> : null}
          <p className="mt-0.5 text-xs text-slate-400">{e.at}</p>
        </li>
      ))}
    </ol>
  );
}
