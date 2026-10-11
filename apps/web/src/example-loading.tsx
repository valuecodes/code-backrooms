/** Shown by either page while the example's files are on their way. */
const ExampleLoading = ({ name }: { readonly name: string | null }) => (
  <div className="flex h-dvh w-screen items-center justify-center bg-black font-mono text-xs text-amber-100/70">
    <p>loading {name ?? "world"}…</p>
  </div>
);

export { ExampleLoading };
