import { createPublicClient, createWalletClient, http, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygonAmoy } from 'viem/chains';
import { CCTP_CONTRACTS } from '../config';

const TOKEN_MESSENGER_ABI = [
  {
    type: "function",
    name: "depositForBurnWithHook",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
      { name: "hookData", type: "bytes" }
    ],
    outputs: [{ type: "uint64" }]
  },
  {
    type: "function",
    name: "depositForBurn",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" }
    ],
    outputs: [{ type: "uint64" }]
  }
] as const;

const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: [{ type: "bool" }]
  }
] as const;

const MESSAGE_TRANSMITTER_ABI = [
  {
    type: "function",
    name: "receiveMessage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "message", type: "bytes" },
      { name: "signature", type: "bytes" }
    ],
    outputs: [{ type: "bool", name: "success" }]
  }
] as const;

export function getPolygonClients(privateKeyHex: string, rpcUrl: string = "https://polygon-amoy.drpc.org") {
  const account = privateKeyToAccount(privateKeyHex.startsWith('0x') ? privateKeyHex as `0x${string}` : `0x${privateKeyHex}`);
  const publicClient = createPublicClient({
    chain: polygonAmoy,
    transport: http(rpcUrl)
  });
  const walletClient = createWalletClient({
    account,
    chain: polygonAmoy,
    transport: http(rpcUrl)
  });
  return { publicClient, walletClient, account };
}

export async function burnOnPolygon(params: {
  amountSubunits: bigint;
  destinationDomain: number;
  mintRecipientBytes32: string;
  destinationCallerBytes32?: string;
  hookData?: string;
  privateKeyHex: string;
  rpcUrl?: string;
}) {
  const { publicClient, walletClient, account } = getPolygonClients(params.privateKeyHex, params.rpcUrl);

  // 1. Approve TokenMessenger to spend USDC
  const approveHash = await walletClient.writeContract({
    address: CCTP_CONTRACTS.polygon.usdc as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [
      CCTP_CONTRACTS.polygon.tokenMessenger as `0x${string}`,
      params.amountSubunits
    ],
    account
  });
  
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  // 2. Deposit For Burn
  let hash: `0x${string}`;
  if (params.hookData && params.destinationCallerBytes32) {
    hash = await walletClient.writeContract({
      address: CCTP_CONTRACTS.polygon.tokenMessenger as `0x${string}`,
      abi: TOKEN_MESSENGER_ABI,
      functionName: "depositForBurnWithHook",
      args: [
        params.amountSubunits,
        params.destinationDomain,
        params.mintRecipientBytes32 as `0x${string}`,
        CCTP_CONTRACTS.polygon.usdc as `0x${string}`,
        params.destinationCallerBytes32 as `0x${string}`,
        BigInt(0),
        0,
        params.hookData as `0x${string}`
      ],
      account
    });
  } else {
    hash = await walletClient.writeContract({
      address: CCTP_CONTRACTS.polygon.tokenMessenger as `0x${string}`,
      abi: TOKEN_MESSENGER_ABI,
      functionName: "depositForBurn",
      args: [
        params.amountSubunits,
        params.destinationDomain,
        params.mintRecipientBytes32 as `0x${string}`,
        CCTP_CONTRACTS.polygon.usdc as `0x${string}`
      ],
      account
    });
  }

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { hash, blockNumber: receipt.blockNumber.toString() };
}

export async function mintOnPolygon(params: {
  messageHex: string;
  attestationHex: string;
  privateKeyHex: string;
  rpcUrl?: string;
}) {
  const { publicClient, walletClient, account } = getPolygonClients(params.privateKeyHex, params.rpcUrl);

  const request = await publicClient.simulateContract({
    address: CCTP_CONTRACTS.polygon.messageTransmitter as `0x${string}`,
    abi: MESSAGE_TRANSMITTER_ABI,
    functionName: 'receiveMessage',
    args: [
      params.messageHex.startsWith('0x') ? params.messageHex as `0x${string}` : `0x${params.messageHex}`,
      params.attestationHex.startsWith('0x') ? params.attestationHex as `0x${string}` : `0x${params.attestationHex}`
    ],
    account
  });

  const hash = await walletClient.writeContract(request.request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { hash, blockNumber: receipt.blockNumber.toString() };
}
