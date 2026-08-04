import { ArrowUp, Mic, X, Volume2, VolumeX } from "lucide-react";
import { useRef, useEffect, useState, useCallback, memo } from "react";

function ComposerBase({
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
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [levels, setLevels] = useState<number[]>(() => Array(28).fill(0.12));

  const audioRef = useRef<{ ctx: AudioContext; stream: MediaStream; raf: number } | null>(null);

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
    if (!SR) setSupported(false);
  }, []);

  // ── Live waveform from the microphone ──────────────────────────────────────
  const stopMeter = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    cancelAnimationFrame(a.raf);
    a.stream.getTracks().forEach((t) => t.stop());
    void a.ctx.close().catch(() => {});
    audioRef.current = null;
    setLevels(Array(28).fill(0.12));
  }, []);

  const startMeter = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(buf);
        const bars: number[] = [];
        const step = Math.floor(buf.length / 28) || 1;
        for (let i = 0; i < 28; i++) {
          const v = buf[i * step] / 255;
          bars.push(Math.max(0.12, Math.min(1, v * 1.6)));
        }
        setLevels(bars);
        const a = audioRef.current;
        if (a) a.raf = requestAnimationFrame(tick);
      };
      audioRef.current = { ctx, stream, raf: requestAnimationFrame(tick) };
    } catch {
      /* mic denied — waveform stays idle, transcription still attempts */
    }
  }, []);

  const stopListening = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch {}
    setListening(false);
    stopMeter();
  }, [stopMeter]);

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
      rec.onerror = () => { setListening(false); stopMeter(); };
      rec.onend = () => { setListening(false); stopMeter(); };
      recognitionRef.current = rec;
      rec.start();
      setListening(true);
      void startMeter();
    } catch {
      setListening(false);
    }
  }, [onChange, value, startMeter, stopMeter]);

  useEffect(() => () => { try { recognitionRef.current?.abort(); } catch {} stopMeter(); }, [stopMeter]);

  // ── Voice-to-voice: speak assistant replies while the modal is open ────────
  useEffect(() => {
    if (!voiceOpen || muted) return;
    function onReply(e: Event) {
      const text = (e as CustomEvent<string>).detail;
      if (!text || typeof window.speechSynthesis === "undefined") return;
      const u = new SpeechSynthesisUtterance(text.slice(0, 600));
      u.lang = navigator.language || "en-US";
      u.rate = 1.02;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    }
    window.addEventListener("ghost:assistant-reply", onReply);
    return () => {
      window.removeEventListener("ghost:assistant-reply", onReply);
      try { window.speechSynthesis?.cancel(); } catch {}
    };
  }, [voiceOpen, muted]);

  function openVoice() {
    setVoiceOpen(true);
    if (!listening) startListening();
  }
  function closeVoice() {
    stopListening();
    try { window.speechSynthesis?.cancel(); } catch {}
    setVoiceOpen(false);
    requestAnimationFrame(() => ref.current?.focus());
  }

  function submit() {
    if (disabled || !value.trim()) return;
    if (listening) stopListening();
    onSend();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
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
            onClick={openVoice}
            disabled={!supported}
            title={supported ? "Voice conversation" : "Voice input not supported in this browser"}
            aria-label="Open voice conversation"
            className={`btn-ghost !p-2.5 !rounded-xl shrink-0 active:scale-95 relative ${listening ? "mic-listening text-cyan-400" : ""}`}
          >
            <Mic className="h-4 w-4 relative z-10" />
          </button>
          <button
            onClick={submit}
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

      {voiceOpen ? (
        <div className="fixed inset-0 z-[80] grid place-items-center p-4 animate-fade-in">
          <button className="absolute inset-0 bg-black/35 backdrop-blur-md" aria-label="Close voice mode" onClick={closeVoice} />
          <div className="relative glass-strong rounded-3xl p-6 w-full max-w-md flex flex-col items-center gap-5">
            <div className="w-full flex items-center justify-between">
              <span className="font-semibold">Voice conversation</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setMuted((m) => !m)} className="btn-ghost !px-2" aria-label={muted ? "Unmute replies" : "Mute replies"}>
                  {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </button>
                <button onClick={closeVoice} className="btn-ghost !px-2" aria-label="Close"><X className="h-4 w-4" /></button>
              </div>
            </div>

            <div className="voice-orb grid place-items-center h-40 w-40 rounded-full">
              <div className="flex items-end gap-[3px] h-16">
                {levels.map((l, i) => (
                  <span
                    key={i}
                    className="w-[3px] rounded-full bg-[color:var(--sky)]"
                    style={{ height: `${Math.round(l * 100)}%`, opacity: 0.45 + l * 0.55 }}
                  />
                ))}
              </div>
            </div>

            <p className="text-sm text-center text-muted-foreground min-h-[2.5rem] break-words">
              {value || (listening ? "Listening…" : "Tap the mic to start speaking")}
            </p>

            <div className="flex items-center gap-2 w-full">
              <button
                onClick={listening ? stopListening : startListening}
                className={`btn-glass flex-1 justify-center ${listening ? "text-cyan-500" : ""}`}
              >
                <Mic className="h-4 w-4" /> {listening ? "Stop" : "Speak"}
              </button>
              <button
                onClick={() => { submit(); }}
                disabled={disabled || !value.trim()}
                className="btn-primary flex-1 justify-center disabled:opacity-50"
              >
                <ArrowUp className="h-4 w-4" /> Send
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export const Composer = memo(ComposerBase);
