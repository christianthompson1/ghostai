import ReactMarkdown from "react-markdown";
import { TokenIntelCard } from "@/components/cards/TokenIntelCard";
import { PriceChartCard } from "@/components/cards/PriceChartCard";
import { TxDecodeCard } from "@/components/cards/TxDecodeCard";
import { MarketPulseCard } from "@/components/cards/MarketPulseCard";
import { ErrorCard } from "@/components/cards/ErrorCard";

export function MessagePart({ part }: { part: any }) {
  switch (part.type) {
    case "text":
      return (
        <div className="prose-chat text-sm">
          <ReactMarkdown>{part.text}</ReactMarkdown>
        </div>
      );
    case "token_intel": return <TokenIntelCard data={part} />;
    case "price_chart": return <PriceChartCard data={part} />;
    case "tx_decode": return <TxDecodeCard data={part} />;
    case "market_pulse": return <MarketPulseCard data={part} />;
    case "error": return <ErrorCard message={part.message} />;
    default: return null;
  }
}
