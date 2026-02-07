import { VISUAL_CONFIG } from '../lib/config'

interface BackButtonProps {
  onClick: () => void
}

export function BackButton({ onClick }: BackButtonProps) {
  return (
    <button
      onClick={onClick}
      style={{
        position: 'fixed',
        top: '20px',
        left: '20px',
        zIndex: 100,
        background: VISUAL_CONFIG.tooltipBackground,
        border: `1px solid ${VISUAL_CONFIG.tooltipBorder}`,
        borderRadius: '8px',
        padding: '8px 16px',
        cursor: 'pointer',
        fontSize: '14px',
        color: VISUAL_CONFIG.textPrimary,
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)',
        transition: 'background 0.15s ease'
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.background = '#f5f5f5'
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.background = VISUAL_CONFIG.tooltipBackground
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M19 12H5M12 19l-7-7 7-7" />
      </svg>
      Back
    </button>
  )
}
