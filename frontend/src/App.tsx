import { useState, useEffect } from 'react'
import { SocialGraph } from './components/SocialGraph'
import { GraphData } from './types/graph'
import { VISUAL_CONFIG } from './lib/config'

export function App() {
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Load graph data from static JSON file.
    // Prefer real data (`social-graph.json`), but fall back to a committed example
    // (`social-graph.example.json`) so the repo works out-of-the-box.
    const load = async () => {
      try {
        const primary = await fetch('/data/social-graph.json')
        if (primary.ok) {
          const data = (await primary.json()) as GraphData
          setGraphData(data)
          setError(null)
          setLoading(false)
          return
        }

        const fallback = await fetch('/data/social-graph.example.json')
        if (!fallback.ok) {
          throw new Error(`Failed to load graph data: ${primary.status}/${fallback.status}`)
        }
        const data = (await fallback.json()) as GraphData
        setGraphData(data)
        setError(null)
        setLoading(false)
      } catch (err: any) {
        setError(err?.message || String(err))
        setLoading(false)
      }
    }

    load()
  }, [])

  if (loading) {
    return (
      <div
        style={{
          width: '100vw',
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: VISUAL_CONFIG.background,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              fontSize: '18px',
              color: VISUAL_CONFIG.textPrimary,
              marginBottom: '8px'
            }}
          >
            Loading Social Graph...
          </div>
          <div style={{ fontSize: '14px', color: VISUAL_CONFIG.textSecondary }}>
            Preparing visualization
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div
        style={{
          width: '100vw',
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: VISUAL_CONFIG.background,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        }}
      >
        <div style={{ textAlign: 'center', maxWidth: '400px', padding: '20px' }}>
          <div
            style={{
              fontSize: '18px',
              color: '#ef4444',
              marginBottom: '12px'
            }}
          >
            Failed to load graph
          </div>
          <div
            style={{
              fontSize: '14px',
              color: VISUAL_CONFIG.textSecondary,
              marginBottom: '16px'
            }}
          >
            {error}
          </div>
          <div
            style={{
              fontSize: '13px',
              color: VISUAL_CONFIG.textSecondary,
              background: '#f5f5f5',
              padding: '12px',
              borderRadius: '8px',
              textAlign: 'left'
            }}
          >
            <strong>To generate graph data:</strong>
            <br />
            <code style={{ fontSize: '12px' }}>
              python scripts/generate_mock_data.py\npython -m src.cli fetch --days 30
            </code>
          </div>
        </div>
      </div>
    )
  }

  if (!graphData) {
    return null
  }

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      }}
    >
      <SocialGraph
        data={graphData}
        onBack={() => {
          // Could navigate back to a dashboard or close the view
          window.history.back()
        }}
      />
    </div>
  )
}

