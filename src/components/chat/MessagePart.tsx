import { TokenIntelCard } from "@/components/cards/TokenIntelCard";
import { PriceChartCard } from "@/components/cards/PriceChartCard";
import { TxDecodeCard } from "@/components/cards/TxDecodeCard";
import { MarketPulseCard } from "@/components/cards/MarketPulseCard";
import { ErrorCard } from "@/components/cards/ErrorCard";
import { PumpFunListCard } from "@/components/cards/PumpFunListCard";
import { TaggedText } from "@/components/chat/TaggedText";

export function MessagePart({ part, messageId, partIndex }: { part: any; messageId?: string; partIndex?: number }) {
  switch (part.type) {
    case "text": return <TaggedText text={part.text} />;
    case "token_intel": return <TokenIntelCard data={part} />;
    case "price_chart": return <PriceChartCard data={part} messageId={messageId} partIndex={partIndex} />;
    case "tx_decode": return <TxDecodeCard data={part} />;
    case "market_pulse": return <MarketPulseCard data={part} />;
    case "pumpfun_list": return <PumpFunListCard data={part} />;
    case "error": return <ErrorCard message={part.message} />;
    default: return null;
  }
}
