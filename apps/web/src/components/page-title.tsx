export function PageTitle({ children }: { children: string }) {
  return (
    <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
      {children}
    </h1>
  );
}
