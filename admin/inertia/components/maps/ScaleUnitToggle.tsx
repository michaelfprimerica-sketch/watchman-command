type ScaleUnit = 'imperial' | 'metric'

type ScaleUnitToggleProps = {
  scaleUnit: ScaleUnit
  onChange: (unit: ScaleUnit) => void
  onMouseEnter?: () => void
}

export default function ScaleUnitToggle({
  scaleUnit,
  onChange,
  onMouseEnter,
}: ScaleUnitToggleProps) {
  return (
    <div className="absolute bottom-[30px] left-[10px] z-[2]" onMouseEnter={onMouseEnter}>
      <div className="inline-flex overflow-hidden rounded text-[11px] font-semibold leading-none shadow-[0_0_0_2px_rgba(0,0,0,0.1)]">
        <button
          type="button"
          onClick={() => onChange('metric')}
          className="border-0 px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-desert-green focus-visible:ring-offset-2 focus-visible:ring-offset-surface-primary"
          style={{
            background:
              scaleUnit === 'metric' ? 'var(--color-desert-green)' : 'var(--color-surface-primary)',
            color: scaleUnit === 'metric' ? 'white' : 'var(--color-text-secondary)',
          }}
        >
          Metric
        </button>

        <button
          type="button"
          onClick={() => onChange('imperial')}
          className="border-0 px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-desert-green focus-visible:ring-offset-2 focus-visible:ring-offset-surface-primary"
          style={{
            background:
              scaleUnit === 'imperial'
                ? 'var(--color-desert-green)'
                : 'var(--color-surface-primary)',
            color: scaleUnit === 'imperial' ? 'white' : 'var(--color-text-secondary)',
          }}
        >
          Imperial
        </button>
      </div>
    </div>
  )
}
