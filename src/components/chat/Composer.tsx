import { ArrowUp, Mic, MicOff } from "lucide-react";
import { useRef, useEffect, useState, useCallback } from "react";

export function Composer({
  value, onChange, onSend, disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);
  const baseRef = useRef<string>("");
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => { ref.current?.focus(); }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [value]);

  // Global listener: copy chips & cards dispatch this event to populate input
  useEffect(() => {
    function onFill(e: Event) {
      const v = (e as CustomEvent<string>).detail;
      if (typeof v === "string") {
        onChange(v);
        requestAnimationFrame(() => ref.current?.focus());
      }
    }
    window.addEventListener("ghost:fill-input", onFill);
    return () => window.removeEventListener("ghost:fill-input", onFill);
  }, [onChange]);

  useEffect(() => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setSupported(false); return; }
  }, []);

  const stopListening = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch {}
    setListening(false);
  }, []);

  const startListening = useCallback(() => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setSupported(false); return; }
    try {
      const rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = navigator.language || "en-US";
      baseRef.current = value ? value.replace(/\s+$/, "") + " " : "";
      rec.onresult = (e: any) => {
        let interim = "";
        let finalTxt = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalTxt += r[0].transcript;
          else interim += r[0].transcript;
        }
        if (finalTxt) baseRef.current += finalTxt + " ";
        onChange((baseRef.current + interim).replace(/\s+/g, " ").trimStart());
      };
      rec.onerror = () => setListening(false);
      rec.onend = () => setListening(false);
      recognitionRef.current = rec;
      rec.start();
      setListening(true);
      requestAnimationFrame(() => ref.current?.focus());
    } catch {
      setListening(false);
    }
  }, [onChange, value]);

  useEffect(() => () => { try { recognitionRef.current?.abort(); } catch {} }, []);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && value.trim()) {
        if (listening) stopListening();
        onSend();
      }
    }
  }

  return (
    <div className="px-3 sm:px-6 pb-4 pt-2">
      <div className="max-w-3xl mx-auto">
        <div className="glass flex items-end gap-2 p-2 pl-4 transition active:scale-[0.99]">
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={listening ? "Listening…" : "Ask GHOST AI — paste a mint, $TICKER, tx hash, or query…"}
            rows={1}
            className="flex-1 resize-none bg-transparent outline-none text-sm py-2.5 placeholder:text-muted-foreground max-h-40"
          />
          <button
            type="button"
            onClick={listening ? stopListening : startListening}
            disabled={!supported}
            title={supported ? (listening ? "Stop listening" : "Voice input") : "Voice input not supported in this browser"}
            aria-label={listening ? "Stop voice input" : "Start voice input"}
            className={`btn-ghost !p-2.5 !rounded-xl shrink-0 active:scale-95 relative ${listening ? "mic-listening text-cyan-400" : ""}`}
          >
            {listening ? <MicOff className="h-4 w-4 relative z-10" /> : <Mic className="h-4 w-4" />}
          </button>
          <button
            onClick={() => { if (listening) stopListening(); onSend(); }}
            disabled={disabled || !value.trim()}
            className="btn-primary !p-2.5 !rounded-xl shrink-0 active:scale-95"
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
