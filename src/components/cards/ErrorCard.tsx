import { AlertOctagon } from "lucide-react";

export function ErrorCard({ message }: { message: string }) {
  return (
    <div className="glass p-4 flex items-start gap-3 border border-[color:var(--destructive)]/40">
      <AlertOctagon className="h-5 w-5 text-[color:var(--destructive)] shrink-0 mt-0.5" />
      <div className="text-sm text-foreground/90">{message}</div>
    </div>
  );
}
