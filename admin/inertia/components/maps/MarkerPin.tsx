import { IconMapPinFilled } from '@tabler/icons-react'

interface MarkerPinProps {
  color?: string
  active?: boolean
}

export default function MarkerPin({
  color = 'var(--color-desert-orange)',
  active = false,
}: MarkerPinProps) {
  return (
    <div className="cursor-pointer" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' }}>
      <IconMapPinFilled size={active ? 36 : 32} style={{ color }} />
    </div>
  )
}
