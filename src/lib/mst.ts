import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  isAddress,
  parseEther,
  type Address,
  type Hex,
} from 'viem'

/** EVM settings for the MST testnet used by the contracts in this repository. */
export const mstTestnet = defineChain({
  id: 91_562_037,
  name: 'MST Testnet',
  nativeCurrency: { name: 'MST Coin', symbol: 'MSTC', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnetrpc.mstblockchain.com'] } },
  blockExplorers: { default: { name: 'MSTScan', url: 'https://testnet.mstscan.com' } },
  testnet: true,
})

/** Only the functions the browser is allowed to call directly. */
export const carePoolWalletAbi = [
  {
    type: 'function',
    name: 'createPool',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [{ name: 'poolId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'fundPool',
    stateMutability: 'payable',
    inputs: [{ name: 'poolId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'redeemCarePass',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'secret', type: 'bytes32' }],
    outputs: [{ name: 'passId', type: 'uint256' }],
  },
] as const

type InjectedProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
}

declare global {
  interface Window {
    ethereum?: InjectedProvider
  }
}

export class WalletUnavailableError extends Error {
  constructor() {
    super('No compatible wallet was detected. Open this page in BridgeKey or another EVM wallet browser.')
  }
}

function injectedProvider(): InjectedProvider {
  if (!window.ethereum) throw new WalletUnavailableError()
  return window.ethereum
}

export function publicMstClient() {
  return createPublicClient({ chain: mstTestnet, transport: http() })
}

export async function connectMstWallet(): Promise<Address> {
  const provider = injectedProvider()
  const wallet = createWalletClient({ chain: mstTestnet, transport: custom(provider) })
  const [address] = await wallet.requestAddresses()
  if (!address) throw new Error('The wallet did not return an account.')

  const activeChainId = await wallet.getChainId()
  if (activeChainId !== mstTestnet.id) {
    try {
      await wallet.switchChain({ id: mstTestnet.id })
    } catch {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: `0x${mstTestnet.id.toString(16)}`,
            chainName: mstTestnet.name,
            nativeCurrency: mstTestnet.nativeCurrency,
            rpcUrls: mstTestnet.rpcUrls.default.http,
            blockExplorerUrls: [mstTestnet.blockExplorers.default.url],
          },
        ],
      })
      await wallet.switchChain({ id: mstTestnet.id })
    }
  }
  return address
}

function contractAddress(value: string): Address {
  if (!isAddress(value)) throw new Error('The CarePool contract address is missing or invalid.')
  return value
}

async function walletClient() {
  const provider = injectedProvider()
  return createWalletClient({ chain: mstTestnet, transport: custom(provider) })
}

export async function createPoolFromWallet(address: string): Promise<Hex> {
  const wallet = await walletClient()
  const [account] = await wallet.requestAddresses()
  if (!account) throw new Error('Connect a wallet before creating a pool.')
  return wallet.writeContract({
    account,
    address: contractAddress(address),
    abi: carePoolWalletAbi,
    functionName: 'createPool',
  })
}

export async function fundPoolFromWallet(address: string, poolId: bigint, amount: string): Promise<Hex> {
  const wallet = await walletClient()
  const [account] = await wallet.requestAddresses()
  if (!account) throw new Error('Connect a wallet before funding a pool.')
  return wallet.writeContract({
    account,
    address: contractAddress(address),
    abi: carePoolWalletAbi,
    functionName: 'fundPool',
    args: [poolId],
    value: parseEther(amount),
  })
}

export async function redeemCarePassFromWallet(address: string, secret: Hex): Promise<Hex> {
  const wallet = await walletClient()
  const [account] = await wallet.requestAddresses()
  if (!account) throw new Error('Connect a wallet before redeeming a CarePass.')
  return wallet.writeContract({
    account,
    address: contractAddress(address),
    abi: carePoolWalletAbi,
    functionName: 'redeemCarePass',
    args: [secret],
  })
}

/** Converts the patient-facing CarePass token back to the bytes32 accepted by the contract. */
export function decodeCarePassToken(token: string): Hex {
  const [prefix, version, payload] = token.trim().split('|')
  if (prefix !== 'ANEMIASCAN-CAREPASS' || version !== '1' || !payload) {
    throw new Error('Enter a valid ANEMIASCAN-CAREPASS|1| token.')
  }
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
  const bytes = atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4))
  if (bytes.length !== 32) throw new Error('This CarePass token does not contain a 32-byte secret.')
  return (`0x${Array.from(bytes, (byte) => byte.charCodeAt(0).toString(16).padStart(2, '0')).join('')}`) as Hex
}

export function explorerTransactionUrl(hash: string) {
  return `${mstTestnet.blockExplorers.default.url}/tx/${hash}`
}
