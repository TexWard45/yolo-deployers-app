export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="dot-grid relative flex min-h-screen items-center justify-center overflow-hidden">
      {/* Soft gradient orbs */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute left-1/4 top-1/3 h-[300px] w-[300px] rounded-full bg-accent/5 blur-[100px]" />
      </div>
      <div className="relative z-10">{children}</div>
    </div>
  );
}
