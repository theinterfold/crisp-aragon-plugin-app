# CRISP Aragon Plugin Frontend

> This project is built on top of Aragon's Governance App Template https://github.com/aragon/gov-app-template - credits to Aragon for the original codebase!

## Overview

This project is a frontend to demo a governance plugin built using [Aragon OSx](https://www.aragon.org/osx) and CRISP.

The CRISP on Aragon plugin provides private and coercion resistent voting to DAO using the Aragon OSx stack.

### Proposal section

This section displays all the proposals which need to be ratified by the community of token holders. Proposals allow anyone with a certain token balance to vote, and all votes are always kept private.

The committee will tally the votes when a proposal ends and report the result back to the smart contracts which will then allow proposals to be executed if they pass.

## Getting Started with the UI

Before you start, make sure you have Bun installed on your machine. If not, hop over to [Bun's official documentation](https://bun.sh/) for installation instructions.

The plugin itself can be deployed from the following repository:

- `https://github.com/gnosisguild/crisp-aragon-plugin`

Please head there for instructions on how to setup and deploy the plugin smart contracts.

Once you're done with the steps above, clone this repository to your local machine:

```bash
git clone https://github.com/gnosisguild/crisp-aragon-plugin-app.git
cd crisp-aragon-plugin-app
```

To get the development server running, simply execute:

```bash
bun install
bun dev
```

Make sure you have configured the necessary environment variables:

```bash
# PUBLIC ENV VARS

# General
NEXT_PUBLIC_DAO_ADDRESS=0xd9A924bF3FaE756417b9B9DCC94C24681534b8F7
NEXT_PUBLIC_TOKEN_ADDRESS=0x9A3218197C77F54BB2510FBBcc7Da3A4D2bE0DeE
NEXT_PUBLIC_ENCLAVE_FEE_TOKEN_ADDRESS=0x8a72996faa56747354a0D9fE817974857055Bd77
# Plugin addresses
NEXT_PUBLIC_CRISP_VOTING_PLUGIN_ADDRESS=0x89ECeD004714779C7b6B3bD72634D2B7A132E1C0

NEXT_PUBLIC_SECONDS_PER_BLOCK=12

# The block number where the plugin was deployed (used to speed up event queries)
NEXT_PUBLIC_PLUGIN_DEPLOYMENT_BLOCK=0

# CRISP server
NEXT_PUBLIC_CRISP_SERVER_URL="http://127.0.0.1:4000"

# Network and services
NEXT_PUBLIC_CHAIN_NAME=sepolia
NEXT_PUBLIC_WEB3_ENDPOINT=https://eth-sepolia.g.alchemy.com/v2/

NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID="YOUR WALLET CONNECT PROJECT ID"

NEXT_PUBLIC_IPFS_ENDPOINTS="https://domain1/api,https://domain2/api/v0"
NEXT_PUBLIC_PINATA_JWT="..."
```

- `NEXT_PUBLIC_DAO_ADDRESS` - The address of the DAO where the CRISP Voting plugin is installed.
- `NEXT_PUBLIC_TOKEN_ADDRESS` - The address of the ERC20 token used for voting power in the DAO.
- `NEXT_PUBLIC_ENCLAVE_FEE_TOKEN_ADDRESS` - The address of the ERC20 token used to pay fees to the committee.
- `NEXT_PUBLIC_CRISP_VOTING_PLUGIN_ADDRESS` - The address of the CRISP Voting plugin contract.
- `NEXT_PUBLIC_SECONDS_PER_BLOCK` - Average number of seconds per block for the specified network. (Ethereum and Sepolia have 12 seconds)
- `NEXT_PUBLIC_PLUGIN_DEPLOYMENT_BLOCK` - The block number where the CRISP Voting plugin was deployed. This helps speed up event queries.
- `NEXT_PUBLIC_CRISP_SERVER_URL` - The URL of the CRISP server to manage CRISP data such as round details, encryption public key and more.
- `NEXT_PUBLIC_CHAIN_NAME` - The name of the Ethereum network you are using (e.g., mainnet, sepolia, goerli).
- `NEXT_PUBLIC_WEB3_ENDPOINT` - An Ethereum node endpoint for the specified network. You can use services like [Alchemy](https://www.alchemy.com/) or [Infura](https://infura.io/) to get a free endpoint. This helps speed up the loading of blockchain data such as proposal details.
- `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` can be obtained by signing up at [WalletConnect](https://walletconnect.com/) and creating a new project.
- `NEXT_PUBLIC_IPFS_ENDPOINTS` and `NEXT_PUBLIC_PINATA_JWT` are needed to ensure we can save proposal details on IPFS

## License 📜

The Governance App Template is released under the AGPL v3 License.
