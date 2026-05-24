'use client'

import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter } from '../lib/navigation'
import { ChevronDown, Globe } from 'lucide-react'
import { useTransition } from 'react'

interface LanguageSwitcherProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}

export default function LanguageSwitcher({
  isOpen,
  onOpenChange
}: LanguageSwitcherProps) {
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()

  const onSelectChange = (nextLocale: string) => {
    startTransition(() => {
      // @ts-ignore -- pathname might be roughly typed but it's valid for next-intl router
      router.replace(pathname, { locale: nextLocale })
      onOpenChange(false)
    })
  }

  return (
    <div className="relative">
      <button
        onClick={() => onOpenChange(!isOpen)}
        className="flex items-center gap-1.5 p-2 hover:bg-muted rounded-lg group transition-colors text-muted-foreground"
        aria-label="Change language"
      >
        <Globe size={18} strokeWidth={1.5} />
        <span className="text-sm font-medium uppercase">{locale}</span>
        <ChevronDown
          size={14}
          className={`text-muted-foreground transition-transform ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-24 bg-background rounded-xl shadow-xl border border-border py-1 z-50 animate-in fade-in zoom-in-95 duration-200">
          {['tr', 'en'].map((cur) => (
            <button
              key={cur}
              disabled={isPending}
              onClick={() => onSelectChange(cur)}
              className={`w-full text-left px-4 py-2 text-sm hover:bg-muted flex items-center gap-2 justify-between
                        ${
                          locale === cur
                            ? 'text-primary font-semibold bg-accent'
                            : 'text-foreground'
                        }
                    `}
            >
              <span className="uppercase">{cur}</span>
              {locale === cur && (
                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
