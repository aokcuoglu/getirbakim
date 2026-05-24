import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AdminLoadingStateProps {
  label?: string
  className?: string
  minHeight?: string
}

export function AdminLoadingState({
  label = 'Yükleniyor...',
  className,
  minHeight = 'min-h-[40vh]'
}: AdminLoadingStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 text-muted-foreground',
        minHeight,
        className
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      <p className="text-sm">{label}</p>
    </div>
  )
}
