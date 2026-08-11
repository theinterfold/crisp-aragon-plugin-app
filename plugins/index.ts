import { PUB_CRISP_VOTING_PLUGIN_ADDRESS } from "@/constants";
import { IconType } from "@aragon/ods";

type PluginItem = {
  /** The URL fragment after /plugins */
  id: string;
  /** The name of the folder within `/plugins` */
  folderName: string;
  /** Title on menu */
  title: string;
  icon?: IconType;
  pluginAddress: string;
};

export const plugins: PluginItem[] = [
  {
    id: "crisp-token-voting",
    folderName: "crispVoting",
    title: "Proposals",
    icon: IconType.BLOCKCHAIN_BLOCKCHAIN,
    pluginAddress: PUB_CRISP_VOTING_PLUGIN_ADDRESS,
  },
  {
    id: "delegation",
    folderName: "members",
    title: "Delegation",
    icon: IconType.APP_MEMBERS,
    // Delegation acts on the voting token, not on the plugin, but the menu entry needs an
    // address: reuse the plugin's so the nav item resolves.
    pluginAddress: PUB_CRISP_VOTING_PLUGIN_ADDRESS,
  },
];
