# usdc-treasury-sebas21gt

Multi-chain USDC treasury engine running on testnet across **Stellar**, **Solana**, and **Polygon**, rebalanced with [CCTP v2](https://developers.circle.com/cctp) (Circle's native burn-and-mint, Standard transfer only — no third-party bridges).

## Stack

Next.js 16 (App Router), React 19, TypeScript 5, Tailwind 4, `@pollar/core`/`@pollar/react` (Stellar treasury wallet), `@stellar/stellar-sdk`, `viem` (Polygon), `@solana/web3.js` + Circle's CCTP Anchor programs (Solana).

## Setup

```bash
npm install
```

### Environment variables

Copy `.env.example` to `.env` **at the repo root** and fill in — it's the only env file in the repo. `apps/web`'s `dev` script loads it explicitly via [`dotenv-cli`](https://github.com/entropitor/dotenv-cli) (`dotenv -e ../../.env -- next dev`), since Next.js only auto-loads env files from its own app directory by default.

This only matters for local development. In production (e.g. Vercel), there is no `.env` file at all — it's gitignored and never reaches the deployment. Set the same variables directly in your hosting provider's environment variable settings (Vercel: Project → Settings → Environment Variables, or `vercel env add`); they get injected into `process.env` at build/runtime with no file involved. `build` and `start` are plain `next build`/`next start` on purpose, so they behave identically locally and in prod.

| Variable | Used for |
|---|---|
| `POLYGON_RPC_URL` | Polygon Amoy RPC endpoint |
| `POLYGON_PRIVATE_KEY` | Treasury's Polygon EVM key (burns/mints via viem). **Server-only** — never prefix this with `NEXT_PUBLIC_`. |
| `SOLANA_RPC_URL` | Solana devnet RPC endpoint |
| `SOLANA_PRIVATE_KEY` | Treasury's Solana keypair, base58-encoded (burns/mints via `@solana/web3.js`). Server-only. |
| `TREASURY_STELLAR_ADDRESS` | Public G-address of the Pollar treasury wallet. Not a secret; needed by headless processes (e.g. `scripts/monitor.ts`) that have no browser session to ask. |
| `NEXT_PUBLIC_POLLAR_API_KEY` | Pollar publishable key (`pub_testnet_...`) — this one *is* meant to be public, it identifies your Pollar app in the browser. |

Polygon and Solana keys are plain hot wallets (testnet only, per the assignment's scope). The Stellar treasury wallet is different: it's a **Pollar custodial wallet**, connected from the browser (`pollar.openLoginModal()`), and every Stellar transaction is signed with `pollar.signAndSubmitTx(xdr)` — the engine never holds a Stellar private key.

### Faucets

- Polygon Amoy USDC + gas (POL): [faucet.circle.com](https://faucet.circle.com) and [faucet.polygon.technology](https://faucet.polygon.technology/) (select Amoy).
- Solana devnet USDC + gas (SOL): [faucet.circle.com](https://faucet.circle.com) and `solana airdrop` / any public devnet faucet.
- Stellar testnet USDC + gas (XLM): [faucet.circle.com](https://faucet.circle.com) and [Friendbot](https://friendbot.stellar.org).

### Pollar Auth Policy (required for the Stellar leg)

Pollar's custodial wallet only signs auth entries for contracts you've explicitly allowlisted. In the [Pollar dashboard](https://dashboard.pollar.xyz) → **Treasury → Auth Policy**, allowlist these three Soroban contracts with **any function**:

- `TokenMessengerMinter` — `CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP`
- `MessageTransmitter` — `CBJ6MTCKKZG73PMDZCJMSFRD7DQEMI4FKDH7CGDSV4W6FHCRBCQAVVJY`
- `CctpForwarder` — `CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ`

Without this, `signAndSubmitTx` rejects the CCTP invocation because the target contract isn't on the wallet's allowlist. Once allowlisted, `signAndSubmitTx` signs the CCTP XDR (built with `@stellar/stellar-sdk`) as-is — no workaround needed on the app side.

## Level configuration

Per-network minimum/target/maximum levels live in `packages/engine/src/config.ts` (`TREASURY_CONFIG`), expressed in whole USDC. Edit that file to change the ranges the engine rebalances against.

## Running the spike (Polygon Amoy ↔ Solana devnet)

```bash
npm run spike:evm-solana
```

Reproducible script: [`scripts/spike-evm-solana.ts`](./scripts/spike-evm-solana.ts). It burns 1 USDC on Polygon Amoy, polls Circle's Iris v2 attestation API, and mints on Solana devnet, printing balances and tx hashes at each step.

## Running manual mode (frontend)

```bash
npm run dev
```

Open `http://localhost:3000`, connect the Pollar wallet, and use the "Manual Rebalance" form to trigger a one-off move (source, destination, amount) between any two of the three networks.

## Running the inventory monitor

```bash
npm run monitor
```

Standalone engine process ([`scripts/monitor.ts`](./scripts/monitor.ts)) that reads all three networks' balances every 30s and reports each one's status against its configured min/target/max range. This is separate from the frontend's own balance polling (which is only for the dashboard's display) — it's the read side that automatic mode's rebalance logic will consume.

Every completed manual transfer is recorded to `data/history.json` (timestamp, source, destination, amount, burn/mint hashes, mode) and shown in the "Movement History" table on the dashboard, with links to each hash's explorer.

Automatic mode (threshold-triggered rebalancing loop) is still in progress.

## CCTP v2 Contract Addresses (Testnet)

All addresses are sourced from the official [Circle Developer Documentation](https://developers.circle.com/cctp/references/contract-addresses).

| Network | Domain | Contract | Address |
|---|---|---|---|
| Polygon Amoy | 7 | TokenMessengerV2 | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| Polygon Amoy | 7 | MessageTransmitterV2 | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |
| Solana devnet | 5 | TokenMessengerMinterV2 | `CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe` |
| Solana devnet | 5 | MessageTransmitterV2 | `CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC` |
| Stellar testnet | 27 | TokenMessengerMinter | `CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP` |
| Stellar testnet | 27 | MessageTransmitter | `CBJ6MTCKKZG73PMDZCJMSFRD7DQEMI4FKDH7CGDSV4W6FHCRBCQAVVJY` |
| Stellar testnet | 27 | CctpForwarder | `CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ` |

## Spike results

Both required end-to-end CCTP v2 transfers have been validated on testnet.

### 1. Polygon Amoy → Solana devnet

Run via [`scripts/spike-evm-solana.ts`](./scripts/spike-evm-solana.ts) (`npm run spike:evm-solana`).

- Burn (Polygon Amoy): [`0x58eac64bda8a94e005a8088b7c3d159a944132234dee59f71f1140d23ca65517`](https://amoy.polygonscan.com/tx/0x58eac64bda8a94e005a8088b7c3d159a944132234dee59f71f1140d23ca65517)
- Mint (Solana devnet): [`3c6VDhTnGWFiSD9WM8RDy2rKj2kKyR9Ja4EaDkGppgCvksCjLJLvZjcZfor8bgDgbsAjc8kf1wwuKFUVXX7B5Z14`](https://explorer.solana.com/tx/3c6VDhTnGWFiSD9WM8RDy2rKj2kKyR9Ja4EaDkGppgCvksCjLJLvZjcZfor8bgDgbsAjc8kf1wwuKFUVXX7B5Z14?cluster=devnet)

### 2. Stellar ↔ Polygon Amoy (both directions)

Run manually from the frontend (`npm run dev`), connecting the Pollar wallet and using the Manual Rebalance form.

**Stellar → Polygon** (burn signed with Pollar's `signAndSubmitTx`, mint on Polygon):
- Approve (Stellar): [`91a9286e1ad14ef4112490ad66bcdbde629b718aabf53a9c6e507d22fc071c9a`](https://stellar.expert/explorer/testnet/tx/91a9286e1ad14ef4112490ad66bcdbde629b718aabf53a9c6e507d22fc071c9a)
- Burn (Stellar): [`63372283c038c38cd1c8cf6141562774a8c5ed68958d446bc598cb564c95abfe`](https://stellar.expert/explorer/testnet/tx/63372283c038c38cd1c8cf6141562774a8c5ed68958d446bc598cb564c95abfe)
- Mint (Polygon Amoy): [`0xefc49b84c24dfc1437b3ec113328c78a38bd791662bebf87a72e1545a3cc00b1`](https://amoy.polygonscan.com/tx/0xefc49b84c24dfc1437b3ec113328c78a38bd791662bebf87a72e1545a3cc00b1)

**Polygon → Stellar** (burn with hook data, mint into the Pollar account via `CctpForwarder`):
- Burn (Polygon Amoy): [`0xa3aab8d8a41e8eba8e6ea8fa2dc4b3d6dfc529155103e89682679a58f76960f5`](https://amoy.polygonscan.com/tx/0xa3aab8d8a41e8eba8e6ea8fa2dc4b3d6dfc529155103e89682679a58f76960f5)
- Mint (Stellar, via `CctpForwarder`): [`71157ba6f6b8a542a70547e3898eacb5098442448ddcf563e88afcd8693f62ff`](https://stellar.expert/explorer/testnet/tx/71157ba6f6b8a542a70547e3898eacb5098442448ddcf563e88afcd8693f62ff)

**On `signAndSubmitTx` and the CCTP XDR:** once the three CCTP contracts were allowlisted in Pollar's Auth Policy (see above), `signAndSubmitTx` signed the CCTP invocation XDRs (built directly with `@stellar/stellar-sdk`'s `Contract.call(...)`) without any modification — no workaround was needed beyond the allowlist itself.
