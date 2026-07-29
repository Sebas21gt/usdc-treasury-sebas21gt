import { createPublicClient, createWalletClient, http, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygonAmoy } from 'viem/chains';
import { CCTP_CONTRACTS } from '../config';

// TokenMessengerV2 (CCTP v2) does not expose the v1-style 4-arg
// depositForBurn(amount, destinationDomain, mintRecipient, burnToken);
// calling it reverts with an invalid selector. Only these two exist.
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
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" }
    ],
    outputs: [{ type: "uint64" }]
  }
] as const;

// CCTP v2 Standard finality (fee-less). Values below 2000 signal Fast
// Transfer, which requires a non-zero maxFee and is out of scope here.
const STANDARD_FINALITY_THRESHOLD = 2000;
const ZERO_BYTES32 = `0x${'0'.repeat(64)}` as const;

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
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" }
    ],
    outputs: [{ type: "uint256" }]
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
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
  console.log("burnOnPolygon PARAMS:", {
    ...params,
    privateKeyHex: "***HIDDEN***"
  });
  
  const { publicClient, walletClient, account } = getPolygonClients(params.privateKeyHex, params.rpcUrl);

  // 1. Check Allowance
  const allowance = await publicClient.readContract({
    address: CCTP_CONTRACTS.polygon.usdc as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account.address, CCTP_CONTRACTS.polygon.tokenMessenger as `0x${string}`]
  });

  if (allowance < params.amountSubunits) {
    const approveHash = await walletClient.writeContract({
      address: CCTP_CONTRACTS.polygon.usdc as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [
        CCTP_CONTRACTS.polygon.tokenMessenger as `0x${string}`,
        BigInt("115792089237316195423570985008687907853269984665640564039457584007913129639935") // Max uint256
      ],
      account
    });
    
    await publicClient.waitForTransactionReceipt({ hash: approveHash, confirmations: 2 });
    
    // Poll until the RPC node syncs the state
    let updatedAllowance = allowance;
    let attempts = 0;
    while (updatedAllowance < params.amountSubunits && attempts < 20) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      updatedAllowance = await publicClient.readContract({
        address: CCTP_CONTRACTS.polygon.usdc as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [account.address, CCTP_CONTRACTS.polygon.tokenMessenger as `0x${string}`]
      });
      attempts++;
    }
    
    if (updatedAllowance < params.amountSubunits) {
      throw new Error("RPC node failed to sync allowance state. Please try again.");
    }
  }

  // 2. Deposit For Burn
  const destinationCaller = (params.destinationCallerBytes32 as `0x${string}`) ?? ZERO_BYTES32;
  let hash: `0x${string}`;
  if (params.hookData) {
    hash = await walletClient.sendTransaction({
      to: CCTP_CONTRACTS.polygon.tokenMessenger as `0x${string}`,
      data: encodeFunctionData({
        abi: TOKEN_MESSENGER_ABI,
        functionName: "depositForBurnWithHook",
        args: [
          params.amountSubunits,
          params.destinationDomain,
          params.mintRecipientBytes32 as `0x${string}`,
          CCTP_CONTRACTS.polygon.usdc as `0x${string}`,
          destinationCaller,
          BigInt(0),
          STANDARD_FINALITY_THRESHOLD,
          params.hookData as `0x${string}`
        ]
      }),
      gas: 500000n,
      account
    });
  } else {
    hash = await walletClient.sendTransaction({
      to: CCTP_CONTRACTS.polygon.tokenMessenger as `0x${string}`,
      data: encodeFunctionData({
        abi: TOKEN_MESSENGER_ABI,
        functionName: "depositForBurn",
        args: [
          params.amountSubunits,
          params.destinationDomain,
          params.mintRecipientBytes32 as `0x${string}`,
          CCTP_CONTRACTS.polygon.usdc as `0x${string}`,
          destinationCaller,
          BigInt(0),
          STANDARD_FINALITY_THRESHOLD
        ]
      }),
      gas: 500000n,
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

  const hash = await walletClient.sendTransaction({
    to: CCTP_CONTRACTS.polygon.messageTransmitter as `0x${string}`,
    data: encodeFunctionData({
      abi: MESSAGE_TRANSMITTER_ABI,
      functionName: 'receiveMessage',
      args: [
        params.messageHex.startsWith('0x') ? params.messageHex as `0x${string}` : `0x${params.messageHex}`,
        params.attestationHex.startsWith('0x') ? params.attestationHex as `0x${string}` : `0x${params.attestationHex}`
      ]
    }),
    account
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { hash, blockNumber: receipt.blockNumber.toString() };
}

// Plain ERC20 transfer - no CCTP involved. Used by the "simulated P2P
// payment" demo feature (treasury crediting P2 on Polygon), not by the
// actual rebalance engine.
export async function payUsdcOnPolygon(params: {
  amountSubunits: bigint;
  toAddress: string;
  privateKeyHex: string;
  rpcUrl?: string;
}) {
  const { publicClient, walletClient, account } = getPolygonClients(params.privateKeyHex, params.rpcUrl);

  const hash = await walletClient.writeContract({
    address: CCTP_CONTRACTS.polygon.usdc as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [params.toAddress as `0x${string}`, params.amountSubunits],
    account,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { hash, blockNumber: receipt.blockNumber.toString() };
}
