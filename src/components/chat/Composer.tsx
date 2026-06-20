import { ArrowUp } from "lucide-react";
import { useRef, useEffect } from "react";

export function Composer({
  value, onChange, onSend, disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [value]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && value.trim()) onSend();
    }
  }

  return (
    <div className="px-3 sm:px-6 pb-4 pt-2">
      <div className="max-w-3xl mx-auto">
        <div className="glass flex items-end gap-2 p-2 pl-4">
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask about a token, paste a tx hash, or request a chart…"
            rows={1}
            className="flex-1 resize-none bg-transparent outline-none text-sm py-2.5 placeholder:text-muted-foreground max-h-40"
          />
          <button
            onClick={onSend}
            disabled={disabled || !value.trim()}
            className="btn-primary !p-2.5 !rounded-xl shrink-0"
            aria-label="Send"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
        <div className="text-[10px] text-center text-muted-foreground mt-2">
          GHOST AI may produce inaccurate information. Always verify on-chain data.
        </div>
      </div>
    </div>
  );
}
