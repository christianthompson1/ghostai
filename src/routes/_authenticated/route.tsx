import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { API } from "@/lib/api";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    // Mirror the authenticated identity into the Ghost AI backend (fire & forget).
    void API.syncUser({ web3authId: data.user.id, provider: "supabase" });
    return { user: data.user };
  },
  component: () => <Outlet />,
});
