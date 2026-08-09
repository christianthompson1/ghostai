import { createFileRoute } from "@tanstack/react-router";
import { ChatConsole } from "@/components/chat/ChatConsole";

export const Route = createFileRoute("/_authenticated/")({
  component: ChatConsole,
});
