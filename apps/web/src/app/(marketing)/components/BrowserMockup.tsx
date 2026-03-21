import Image from "next/image";

interface BrowserMockupProps {
  src: string;
  alt: string;
  className?: string;
  priority?: boolean;
}

export function BrowserMockup({ src, alt, className, priority }: BrowserMockupProps) {
  return (
    <div className={cn("overflow-hidden rounded-xl border bg-card shadow-2xl", className)}>
      {/* Browser chrome */}
      <div className="flex h-9 items-center gap-2 border-b bg-muted/50 px-4">
        <div className="flex gap-1.5">
          <div className="size-3 rounded-full bg-red-400/80" />
          <div className="size-3 rounded-full bg-yellow-400/80" />
          <div className="size-3 rounded-full bg-green-400/80" />
        </div>
        <div className="mx-auto flex h-5 w-48 items-center justify-center rounded-md bg-background/50 text-[10px] text-muted-foreground">
          resolveai.app
        </div>
      </div>
      {/* Screenshot */}
      <Image
        src={src}
        alt={alt}
        width={1400}
        height={900}
        className="w-full"
        priority={priority}
      />
    </div>
  );
}

function cn(...classes: (string | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
