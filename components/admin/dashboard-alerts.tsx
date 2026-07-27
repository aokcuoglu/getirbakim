import { CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  AdminCard,
  AdminCardContent,
  AdminCardDescription,
  AdminCardHeader,
  AdminCardTitle
} from '@/components/admin/admin-card'
import { Badge } from '@/components/ui/badge'

interface DashboardAlert {
  id: string
  label: string
  value: number
  severity: 'high' | 'medium' | 'low'
}

interface DashboardAlertsProps {
  alerts: DashboardAlert[]
}

const severityBadgeVariant: Record<
  DashboardAlert['severity'],
  'destructive' | 'secondary' | 'outline'
> = {
  high: 'destructive',
  medium: 'secondary',
  low: 'outline'
}

const severityLabel: Record<DashboardAlert['severity'], string> = {
  high: 'Yüksek',
  medium: 'Orta',
  low: 'Düşük'
}

export function DashboardAlerts({ alerts }: DashboardAlertsProps) {
  const activeAlerts = alerts.filter((alert) => alert.value > 0)
  const hasIssues = activeAlerts.length > 0

  return (
    <AdminCard className="h-full">
      <AdminCardHeader>
        <AdminCardTitle>Operasyon Uyarıları</AdminCardTitle>
        <AdminCardDescription>
          Sistem sağlığı ve dikkat gerektiren alanlar
        </AdminCardDescription>
      </AdminCardHeader>
      <AdminCardContent className="space-y-3">
        {!hasIssues ? (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <CheckCircle2 className="mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">Tüm sistemler normal</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Şu an müdahale gerektiren bir uyarı yok
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {activeAlerts.map((alert) => (
              <li
                key={alert.id}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2'
                )}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{alert.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {alert.value.toLocaleString('tr-TR')} kayıt
                  </p>
                </div>
                <Badge variant={severityBadgeVariant[alert.severity]}>
                  {severityLabel[alert.severity]}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </AdminCardContent>
    </AdminCard>
  )
}
