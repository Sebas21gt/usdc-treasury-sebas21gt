import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygonAmoy } from 'viem/chains';
import type { BurnResult, MintResult, CctpAttestation } from '@usdc-treasury/shared';
import { CCTP_CONTRACTS } from '../config';

function getClients(rpcUrl: string) {
  const account = privateKeyToAccount((process.env.POLYGON_PRIVATE_KEY ?? '') as Hex);
  const publicClient = createPublicClient({ chain: polygonAmoy, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain: polygonAmoy, transport: http(rpcUrl) });
  return { account, publicClient, walletClient };
}

const TOKEN_MESSENGER_ABI = [{
  name: 'depositForBurn', type: 'function', stateMutability: 'nonpayable',
  inputs: [
    { name: 'amount', type: 'uint256' }, { name: 'destinationDomain', type: 'uint32' },
    { name: 'mintRecipient', type: 'bytes32' }, { name: 'burnToken', type: 'address' },
    { name: 'destinationCaller', type: 'bytes32' }, { name: 'maxFee', type: 'uint256' },
    { name: 'minFinalityThreshold', type: 'uint32' }
  ],
  outputs: []
}] as const;

const MESSAGE_TRANSMITTER_ABI = [{
  name: 'receiveMessage', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'message', type: 'bytes' }, { name: 'attestation', type: 'bytes' }],
  outputs: [{ name: 'success', type: 'bool' }]
}] as const;

const ERC20_ABI = [
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }
] as const;

export async function getPolygonBalance(rpcUrl: string): Promise<number> {
  const { account, publicClient } = getClients(rpcUrl);
  const raw = await publicClient.readContract({
    address: CCTP_CONTRACTS.polygon.usdc as Hex,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });
  return Number(formatUnits(raw, 6));
}

export async function polygonBurn(params: {
  rpcUrl: string;
  destinationDomain: number;
  amountUsdc: number;
  mintRecipient: Hex;
}): Promise<BurnResult> {
  const { rpcUrl, destinationDomain, amountUsdc, mintRecipient } = params;
  const { walletClient, publicClient } = getClients(rpcUrl);
  const amount = parseUnits(String(amountUsdc), 6);

  console.log(`Approving ${amountUsdc} USDC on Polygon...`);
  const approveTxHash = await walletClient.writeContract({
    address: CCTP_CONTRACTS.polygon.usdc as Hex,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [CCTP_CONTRACTS.polygon.tokenMessenger as Hex, amount],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveTxHash });

  console.log(`Burning ${amountUsdc} USDC on Polygon...`);
  const burnTxHash = await walletClient.writeContract({
    address: CCTP_CONTRACTS.polygon.tokenMessenger as Hex,
    abi: TOKEN_MESSENGER_ABI,
    functionName: 'depositForBurn',
    args: [
      amount, destinationDomain, mintRecipient,
      CCTP_CONTRACTS.polygon.usdc as Hex,
      '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex, // any caller
      BigInt(0), 2000
    ],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: burnTxHash });
  const messageSentLog = receipt.logs.find(log => log.topics[0] === '0x8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036');
  const messageHash = messageSentLog?.topics[1] ?? burnTxHash;

  return { txHash: burnTxHash, messageHash, sourceDomain: 7 };
}

export function polygonExplorerUrl(txHash: string): string {
  return `https://amoy.polygonscan.com/tx/${txHash}`;
}
