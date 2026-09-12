import { useCallback, useState } from 'react'
import { SiteHeader } from '@/src/components/site-header'
import { HomeScreen } from '@/src/screens/home-screen'
import { ScanScreen } from '@/src/screens/scan-screen'
import { ProcessingScreen } from '@/src/screens/processing-screen'
import { ResultScreen } from '@/src/screens/result-screen'
import { InsightsScreen } from '@/src/screens/insights-screen'
import { InconclusiveScreen } from '@/src/screens/inconclusive-screen'
import type { ScanAnalysis, ScreenId } from '@/src/lib/types'

const IMMERSIVE_SCREENS: ScreenId[] = ['scan', 'processing']

export default function App() {
  const [screen, setScreen] = useState<ScreenId>('home')
  const [analysis, setAnalysis] = useState<ScanAnalysis | null>(null)

  const handleCaptured = useCallback((result: ScanAnalysis) => {
    setAnalysis(result)
    setScreen('processing')
  }, [])

  const handleProcessingDone = useCallback(() => {
    setScreen((_) => (analysis?.tooDark ? 'inconclusive' : 'result'))
  }, [analysis])

  const goHome = useCallback(() => setScreen('home'), [])
  const showHeader = !IMMERSIVE_SCREENS.includes(screen)

  return (
    <div className="flex min-h-dvh w-full flex-col bg-background">
      {showHeader && <SiteHeader onHome={goHome} />}

      <main className="flex flex-1 flex-col">
        {screen === 'home' && <HomeScreen onStart={() => setScreen('scan')} />}

        {screen === 'scan' && (
          <ScanScreen onCapture={handleCaptured} onExit={goHome} />
        )}

        {screen === 'processing' && analysis && (
          <ProcessingScreen imageDataUrl={analysis.imageDataUrl} onDone={handleProcessingDone} />
        )}

        {screen === 'result' && analysis && (
          <ResultScreen
            analysis={analysis}
            onViewInsights={() => setScreen('insights')}
            onScanAgain={() => setScreen('scan')}
          />
        )}

        {screen === 'insights' && analysis && (
          <InsightsScreen analysis={analysis} onBack={() => setScreen('result')} />
        )}

        {screen === 'inconclusive' && (
          <InconclusiveScreen onRetake={() => setScreen('scan')} onExit={goHome} />
        )}
      </main>
    </div>
  )
}
