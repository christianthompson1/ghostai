import { createFileRoute } from "@tanstack/react-router";
import { ChatConsole } from "@/components/chat/ChatConsole";

export const Route = createFileRoute("/_authenticated/")({
  component: ChatConsole,
  head: () => ({
    meta: [
      { title: "GHOST AI Terminal — Solana Market & Security Chat" },
      {
        name: "description",
        content:
          "Chat with GHOST AI to audit Solana tokens, decode transactions, and track live market pulse in one conversational terminal.",
      },
      { property: "og:title", content: "GHOST AI Terminal — Solana Market & Security Chat" },
      {
        property: "og:description",
        content: "Audit Solana tokens, decode transactions, and track live markets from one chat terminal.",
      },
      { property: "og:url", content: "https://ghostprotocol1.lovable.app/" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "https://ghostprotocol1.lovable.app/" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "GHOST AI",
          applicationCategory: "FinanceApplication",
          operatingSystem: "Web",
          url: "https://ghostprotocol1.lovable.app/",
          description:
            "Conversational Solana terminal for token audits, transaction decoding, and live market intelligence.",
        }),
      },
    ],
  }),
});
