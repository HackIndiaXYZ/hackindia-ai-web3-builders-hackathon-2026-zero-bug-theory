import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  BadgeCheck,
  Check,
  Copy,
  ExternalLink,
  Landmark,
  LoaderCircle,
  Network,
  Plus,
  ShieldCheck,
  Stethoscope,
  Wallet,
} from 'lucide-react'
import type { Hex } from 'viem'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { getBlockchainHealth, getScreeningProof, type BlockchainHealth, type ScreeningProof } from '@/src/lib/api'
import {
  connectMstWallet,
  createPoolFromWallet,
  decodeCarePassToken,
  explorerTransactionUrl,
  fundPoolFromWallet,
  mstTestnet,
  redeemCarePassFromWallet,
} from '@/src/lib/mst'
import type { ScanAnalysis } from '@/src/lib/types'

type Workspace = 'proof' | 'sponsor' | 'clinic'

interface BlockchainScreenProps {
  analysis: ScanAnalysis | null
  onBack: () => void
}

function shortHash(value: string | null | undefined, edge = 7) {
  if (!value) return 'Not available'
  if (value.length <= edge * 2 + 3) return value
  return `${value.slice(0, edge)}…${value.slice(-edge)}`
}

function HealthPill({ health }: { health: BlockchainHealth | null }) {
  if (!health) return <Badge variant="outline">Checking network</Badge>
  const healthy = health.chainIdMatch && health.status === 'ok'
  return (
    <Badge variant={healthy ? 'safe' : 'moderate'}>
      <span className={cn('mr-1.5 size-1.5 rounded-full', healthy ? 'bg-safe' : 'bg-moderate')} />
      {healthy ? 'MST Testnet connected' : 'Network needs attention'}
    </Badge>
  )
}

function HashRow({ label, value, href }: { label: string; value: string | null | undefined; href?: string | null }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    if (!value || !navigator.clipboard) return
    await navigator.clipboard.writeText(value)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="flex items-center justify-between gap-3 border-t border-border/60 py-3 first:border-t-0 first:pt-0 last:pb-0">
      <span className="shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center gap-1.5">
        <code className="truncate rounded-md bg-muted px-2 py-1 font-mono text-[11px] text-foreground" title={value ?? undefined}>
          {shortHash(value)}
        </code>
        {value ? (
          <button type="button" onClick={() => void copy()} aria-label={`Copy ${label}`} className="ring-focus rounded-md p-1 text-muted-foreground hover:text-foreground">
            {copied ? <Check className="size-3.5 text-safe" /> : <Copy className="size-3.5" />}
          </button>
        ) : null}
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" aria-label={`Open ${label} in explorer`} className="ring-focus rounded-md p-1 text-primary hover:text-primary/80">
            <ExternalLink className="size-3.5" />
          </a>
        ) : null}
      </div>
    </div>
  )
}

function TxResult({ hash, label }: { hash: Hex | null; label: string }) {
  if (!hash) return null
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/8 p-3">
      <span className="flex items-center gap-2 text-sm font-medium text-foreground"><Check className="size-4 text-primary" />{label}</span>
      <a className="text-sm font-semibold text-primary hover:underline" href={explorerTransactionUrl(hash)} target="_blank" rel="noreferrer">View transaction <ExternalLink className="inline size-3.5" /></a>
    </div>
  )
}

export function BlockchainScreen({ analysis, onBack }: BlockchainScreenProps) {
  const [workspace, setWorkspace] = useState<Workspace>('proof')
  const [health, setHealth] = useState<BlockchainHealth | null>(null)
  const [healthError, setHealthError] = useState('')
  const [wallet, setWallet] = useState('')
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    void getBlockchainHealth().then(setHealth).catch((error: unknown) => setHealthError(error instanceof Error ? error.message : 'Blockchain status is unavailable.'))
  }, [])

  const connect = async () => {
    setConnecting(true)
    try {
      setWallet(await connectMstWallet())
    } catch (error) {
      setHealthError(error instanceof Error ? error.message : 'Wallet connection failed.')
    } finally {
      setConnecting(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="home-hero relative isolate overflow-hidden border-b border-border/70">
        <div aria-hidden="true" className="animate-aurora pointer-events-none absolute inset-0 opacity-50" />
        <div aria-hidden="true" className="home-hero-grid pointer-events-none absolute inset-0" />
        <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 pt-8 pb-10 lg:px-10 lg:pt-10 lg:pb-14">
          <button type="button" onClick={onBack} className="ring-focus -ml-2 flex w-fit items-center gap-1.5 rounded-full px-2 py-1 text-sm font-medium text-white/75 hover:text-white">
            <ArrowLeft className="size-4" /> Back
          </button>
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div className="max-w-2xl">
              <p className="mb-3 flex items-center gap-2 text-2xs font-semibold tracking-[0.18em] text-primary uppercase"><Network className="size-3.5" /> Proof & care</p>
              <h1 className="display text-display-sm text-white sm:text-display">A private result. A verifiable proof.</h1>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/70 sm:text-base">Your image and identity stay off-chain. MST stores only a cryptographic commitment and the rules that protect care funding.</p>
            </div>
            <HealthPill health={health} />
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-7 lg:px-10 lg:py-10">
        <div className="flex overflow-x-auto rounded-2xl border border-border bg-card p-1" role="tablist" aria-label="Blockchain workspace">
          {([
            ['proof', 'Proof', ShieldCheck],
            ['sponsor', 'Sponsor pool', Landmark],
            ['clinic', 'Clinic redemption', Stethoscope],
          ] as const).map(([id, label, Icon]) => (
            <button key={id} type="button" role="tab" aria-selected={workspace === id} onClick={() => setWorkspace(id)} className={cn('ring-focus flex min-w-max flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors', workspace === id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>

        {healthError ? <p role="status" className="rounded-xl border border-moderate/25 bg-moderate/10 px-4 py-3 text-sm text-foreground">{healthError}</p> : null}

        {workspace === 'proof' ? <ProofWorkspace analysis={analysis} health={health} /> : null}
        {workspace === 'sponsor' ? <SponsorWorkspace health={health} wallet={wallet} connecting={connecting} onConnect={() => void connect()} /> : null}
        {workspace === 'clinic' ? <ClinicWorkspace health={health} wallet={wallet} connecting={connecting} onConnect={() => void connect()} /> : null}
      </div>
    </div>
  )
}

function ProofWorkspace({ analysis, health }: { analysis: ScanAnalysis | null; health: BlockchainHealth | null }) {
  const [query, setQuery] = useState('')
  const [proof, setProof] = useState<ScreeningProof | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const current = proof ?? (analysis?.scanIdHash ? {
    scanIdHash: analysis.scanIdHash,
    commitment: analysis.commitment ?? '',
    modelHash: analysis.modelHash ?? '',
    registeredOnChain: analysis.registeredOnChain ?? false,
    chainTxHash: analysis.chainTxHash ?? null,
    chainTxStatus: analysis.chainTxStatus ?? null,
    explorerUrl: analysis.explorerUrl ?? null,
  } : null)

  const lookup = async () => {
    setLoading(true); setError('')
    try { setProof(await getScreeningProof(query)) } catch (err) { setError(err instanceof Error ? err.message : 'Proof lookup failed.') } finally { setLoading(false) }
  }

  return <div className="grid gap-5 lg:grid-cols-[1.25fr_.75fr]">
    <Card className="border-primary/20">
      <CardHeader>
        <div className="flex items-start justify-between gap-4"><div><CardTitle className="flex items-center gap-2"><ShieldCheck className="size-5 text-primary" /> Screening proof</CardTitle><CardDescription>Compare a result’s commitment with its immutable on-chain registration.</CardDescription></div>{current?.registeredOnChain ? <Badge variant="safe"><BadgeCheck className="mr-1 size-3.5" /> Verified</Badge> : <Badge variant="outline">Not anchored yet</Badge>}</div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {current ? <div className="rounded-xl border border-border bg-muted/30 p-4"><HashRow label="Scan ID" value={current.scanIdHash} /><HashRow label="Commitment" value={current.commitment} /><HashRow label="Model hash" value={current.modelHash} /><HashRow label="Transaction" value={current.chainTxHash} href={current.explorerUrl} /></div> : <div className="rounded-xl border border-dashed border-border bg-muted/25 p-5 text-sm leading-relaxed text-muted-foreground">Complete a screening, or look up a scan ID below. A proof contains hashes only — never your photo, name, or medical record.</div>}
        {current?.chainTxStatus ? <p className="text-xs text-muted-foreground">Registration status: <span className="font-semibold text-foreground">{current.chainTxStatus}</span></p> : null}
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>Verify another proof</CardTitle><CardDescription>Paste a scan ID to retrieve its status from the AnemiaScan registry.</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <label className="text-xs font-medium text-foreground" htmlFor="scan-proof">Scan ID hash</label>
        <input id="scan-proof" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="0x…" className="ring-focus h-11 rounded-xl border border-border bg-background px-3 font-mono text-xs outline-none" />
        <Button onClick={() => void lookup()} disabled={!query.trim() || loading} className="h-11 rounded-xl">{loading ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} Verify proof</Button>
        {error ? <p role="alert" className="text-xs leading-relaxed text-destructive">{error}</p> : null}
        <div className="mt-2 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">Network: <span className="font-medium text-foreground">{health?.network ?? mstTestnet.name}</span><br />The registry confirms that a commitment has not been altered; it does not diagnose a medical condition.</div>
      </CardContent>
    </Card>
  </div>
}

function SponsorWorkspace({ health, wallet, connecting, onConnect }: { health: BlockchainHealth | null; wallet: string; connecting: boolean; onConnect: () => void }) {
  const [poolId, setPoolId] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState<'create' | 'fund' | null>(null)
  const [tx, setTx] = useState<Hex | null>(null)
  const [error, setError] = useState('')
  const address = health?.carePoolAddress ?? ''
  const walletLabel = useMemo(() => wallet ? shortHash(wallet, 6) : 'Connect wallet', [wallet])

  const create = async () => { setBusy('create'); setError(''); try { setTx(await createPoolFromWallet(address)) } catch (err) { setError(err instanceof Error ? err.message : 'Pool creation failed.') } finally { setBusy(null) } }
  const fund = async () => { setBusy('fund'); setError(''); try { if (!/^\d+$/.test(poolId) || BigInt(poolId) < 1n) throw new Error('Enter a valid on-chain pool ID.'); if (!Number(amount) || Number(amount) <= 0) throw new Error('Enter a positive MSTC amount.'); setTx(await fundPoolFromWallet(address, BigInt(poolId), amount)) } catch (err) { setError(err instanceof Error ? err.message : 'Funding failed.') } finally { setBusy(null) } }

  return <div className="grid gap-5 lg:grid-cols-[1.05fr_.95fr]">
    <Card className="border-primary/20"><CardHeader><CardTitle className="flex items-center gap-2"><Landmark className="size-5 text-primary" /> Sponsor a care pool</CardTitle><CardDescription>Your wallet creates the pool and funds it directly. The backend cannot spend or withdraw your funds.</CardDescription></CardHeader><CardContent className="flex flex-col gap-4">
      <WalletStatus wallet={wallet} label={walletLabel} connecting={connecting} onConnect={onConnect} />
      <Button size="lg" onClick={() => void create()} disabled={!wallet || !address || busy !== null} className="h-12 rounded-xl">{busy === 'create' ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />} Create pool from this wallet</Button>
      {!address ? <p className="text-xs text-moderate">The backend has not published a CarePool address yet. Deploy contracts and configure the backend first.</p> : null}
      <TxResult hash={tx} label="Wallet transaction submitted" />
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Fund an existing pool</CardTitle><CardDescription>Pool IDs are public on MSTScan. Fund only a pool you recognise.</CardDescription></CardHeader><CardContent className="flex flex-col gap-3">
      <label className="text-xs font-medium" htmlFor="pool-id">On-chain pool ID</label><input id="pool-id" inputMode="numeric" value={poolId} onChange={(e) => setPoolId(e.target.value)} placeholder="e.g. 1" className="ring-focus h-11 rounded-xl border border-border bg-background px-3 text-sm outline-none" />
      <label className="text-xs font-medium" htmlFor="pool-amount">Amount (MSTC)</label><input id="pool-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 5" className="ring-focus h-11 rounded-xl border border-border bg-background px-3 text-sm outline-none" />
      <Button variant="outline" onClick={() => void fund()} disabled={!wallet || !address || busy !== null} className="h-11 rounded-xl">{busy === 'fund' ? <LoaderCircle className="size-4 animate-spin" /> : <Landmark className="size-4" />} Fund pool</Button>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </CardContent></Card>
  </div>
}

function ClinicWorkspace({ health, wallet, connecting, onConnect }: { health: BlockchainHealth | null; wallet: string; connecting: boolean; onConnect: () => void }) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [tx, setTx] = useState<Hex | null>(null)
  const [error, setError] = useState('')
  const address = health?.carePoolAddress ?? ''
  const redeem = async () => { setBusy(true); setError(''); try { setTx(await redeemCarePassFromWallet(address, decodeCarePassToken(token))) } catch (err) { setError(err instanceof Error ? err.message : 'Redemption failed.') } finally { setBusy(false) } }

  return <div className="grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
    <Card className="border-primary/20"><CardHeader><CardTitle className="flex items-center gap-2"><Stethoscope className="size-5 text-primary" /> Authorized clinic</CardTitle><CardDescription>Redemption is signed by your clinic wallet. Funds are credited by the contract, not by the backend.</CardDescription></CardHeader><CardContent><WalletStatus wallet={wallet} label={wallet ? shortHash(wallet, 6) : 'Connect clinic wallet'} connecting={connecting} onConnect={onConnect} /><p className="mt-4 text-xs leading-relaxed text-muted-foreground">Your wallet must already be authorised on the CarePool contract. This screen never sends a CarePass token to the backend.</p></CardContent></Card>
    <Card><CardHeader><CardTitle>Redeem a CarePass</CardTitle><CardDescription>Paste the one-time token supplied by the patient. Confirm the service before submitting it.</CardDescription></CardHeader><CardContent className="flex flex-col gap-3"><label htmlFor="care-pass" className="text-xs font-medium">CarePass token</label><textarea id="care-pass" rows={4} value={token} onChange={(e) => setToken(e.target.value)} placeholder="ANEMIASCAN-CAREPASS|1|…" className="ring-focus resize-y rounded-xl border border-border bg-background p-3 font-mono text-xs outline-none" /><Button size="lg" onClick={() => void redeem()} disabled={!wallet || !address || !token.trim() || busy} className="h-12 rounded-xl">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Stethoscope className="size-4" />} Redeem with clinic wallet</Button>{error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}<TxResult hash={tx} label="Redemption submitted" /></CardContent></Card>
  </div>
}

function WalletStatus({ wallet, label, connecting, onConnect }: { wallet: string; label: string; connecting: boolean; onConnect: () => void }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 p-3"><div className="flex min-w-0 items-center gap-2"><span className={cn('grid size-8 place-items-center rounded-full', wallet ? 'bg-safe/15 text-safe' : 'bg-muted text-muted-foreground')}><Wallet className="size-4" /></span><div className="min-w-0"><p className="text-xs text-muted-foreground">{wallet ? 'Connected wallet' : 'Wallet required'}</p><p className="truncate font-mono text-sm font-medium text-foreground">{label}</p></div></div>{wallet ? <Badge variant="safe">Connected</Badge> : <Button variant="outline" size="sm" onClick={onConnect} disabled={connecting} className="rounded-lg">{connecting ? <LoaderCircle className="size-3.5 animate-spin" /> : <Wallet className="size-3.5" />} Connect</Button>}</div>
}
