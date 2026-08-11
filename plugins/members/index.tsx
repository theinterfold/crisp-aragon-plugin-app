import { NotFound } from "@/components/not-found";
import { useUrl } from "@/hooks/useUrl";
import Delegation from "./pages/index";

export default function PluginPage() {
  const { hash } = useUrl();

  if (!hash || hash === "#/") return <Delegation />;
  // Back-compat with old `#/delegates/<address>` links — just show the delegation page.
  if (hash.startsWith("#/delegates")) return <Delegation />;

  return <NotFound />;
}
