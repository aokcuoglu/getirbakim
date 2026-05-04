'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bell, CheckCheck, Loader2 } from 'lucide-react'
import { useLocale } from 'next-intl'
import { toast } from 'sonner'
import { useShop } from '@/components/ShopProvider'
import type { NotificationRecord } from '@/lib/notifications/types'

type NotificationsResponse = {
  notifications: NotificationRecord[]
  unreadCount: number
  nextCursor: string | null
}

interface NotificationBellProps {
  buttonClassName?: string
  panelClassName?: string
  iconClassName?: string
  showLabel?: boolean
}

export function NotificationBell({
  buttonClassName,
  panelClassName,
  iconClassName,
  showLabel = false
}: NotificationBellProps) {
  const locale = useLocale()
  const { user } = useShop()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const [isMobileViewport, setIsMobileViewport] = useState(false)
  const [mobilePanelTop, setMobilePanelTop] = useState(72)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [items, setItems] = useState<NotificationRecord[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | null>(null)

  const texts = useMemo(() => {
    if (locale === 'tr') {
      return {
        title: 'Bildirimler',
        guestHint: 'Bildirim merkezini kullanmak için giriş yapın.',
        empty: 'Henüz bildiriminiz yok.',
        markAll: 'Tümünü okundu yap',
        loadMore: 'Daha fazla',
        notifications: 'Bildirimler'
      }
    }

    return {
      title: 'Notifications',
      guestHint: 'Please sign in to use notification center.',
      empty: 'No notifications yet.',
      markAll: 'Mark all as read',
      loadMore: 'Load more',
      notifications: 'Notifications'
    }
  }, [locale])

  const fetchNotifications = useCallback(
    async (cursor?: string | null) => {
      if (!user?.id) {
        setItems([])
        setUnreadCount(0)
        setNextCursor(null)
        return
      }

      const url = cursor
        ? `/api/notifications?cursor=${encodeURIComponent(cursor)}&limit=20`
        : '/api/notifications?limit=20'

      const response = await fetch(url, {
        method: 'GET',
        cache: 'no-store'
      })
      const json = (await response.json().catch(() => null)) as NotificationsResponse | null
      if (!response.ok || !json) {
        throw new Error('NOTIFICATIONS_FETCH_FAILED')
      }

      setUnreadCount(json.unreadCount)
      setNextCursor(json.nextCursor)
      setItems((prev) => (cursor ? [...prev, ...json.notifications] : json.notifications))
    },
    [user?.id]
  )

  const refreshNotifications = useCallback(async () => {
    setIsLoading(true)
    try {
      await fetchNotifications(null)
    } catch {
      // ignore silent refresh failures
    } finally {
      setIsLoading(false)
    }
  }, [fetchNotifications])

  useEffect(() => {
    if (!user?.id) {
      setItems([])
      setUnreadCount(0)
      setNextCursor(null)
      return
    }

    void refreshNotifications()

    const interval = window.setInterval(() => {
      void refreshNotifications()
    }, 60_000)

    const onFocus = () => {
      void refreshNotifications()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refreshNotifications()
      }
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refreshNotifications, user?.id])

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    const sync = () => setIsMobileViewport(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (!open || !isMobileViewport) return
    const buttonRect = buttonRef.current?.getBoundingClientRect()
    if (!buttonRect) return
    setMobilePanelTop(Math.max(56, Math.round(buttonRect.bottom + 8)))
  }, [open, isMobileViewport])

  useEffect(() => {
    if (!open) return

    const onClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', onClickOutside)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
    }
  }, [open])

  const onOpenToggle = () => {
    if (!user?.id) {
      toast.info(texts.guestHint)
      return
    }

    setOpen((prev) => {
      const next = !prev
      if (!prev && next) {
        void refreshNotifications()
      }
      return next
    })
  }

  const markRead = async (id: string) => {
    if (!user?.id) return

    const response = await fetch('/api/notifications/mark-read', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ids: [id] })
    })

    if (!response.ok) return

    setItems((prev) =>
      prev.map((item) =>
        item.id === id && !item.readAt
          ? { ...item, readAt: new Date().toISOString() }
          : item
      )
    )
    setUnreadCount((prev) => Math.max(0, prev - 1))
  }

  const markAllRead = async () => {
    if (!user?.id || unreadCount <= 0) return

    const response = await fetch('/api/notifications/mark-all-read', {
      method: 'POST'
    })

    if (!response.ok) return

    const now = new Date().toISOString()
    setItems((prev) => prev.map((item) => ({ ...item, readAt: item.readAt || now })))
    setUnreadCount(0)
  }

  const loadMore = async () => {
    if (!nextCursor || isLoadingMore) return

    setIsLoadingMore(true)
    try {
      await fetchNotifications(nextCursor)
    } catch {
      // ignore
    } finally {
      setIsLoadingMore(false)
    }
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={onOpenToggle}
        ref={buttonRef}
        className={
          buttonClassName ||
          'flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded-lg group transition-colors'
        }
      >
        <div
          className={
            iconClassName ||
            'w-8 h-8 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-500 group-hover:text-sky-600 transition-colors relative'
          }
        >
          <Bell size={18} strokeWidth={1.5} />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 h-5 min-w-5 px-1 bg-sky-600 text-white text-[10px] font-bold flex items-center justify-center rounded-full border-2 border-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>
        {showLabel && (
          <div className="hidden lg:flex flex-col items-start">
            <span className="text-[11px] text-slate-400 font-medium leading-none mb-0.5">
              {texts.notifications}
            </span>
            <span className="text-[13px] font-semibold text-slate-700 leading-none">
              {texts.title}
            </span>
          </div>
        )}
      </button>

      {open &&
        (isMobileViewport ? (
          <>
            <button
              type="button"
              className="fixed inset-0 z-[140] bg-black/20"
              onClick={() => setOpen(false)}
              aria-label="Bildirim panelini kapat"
            />
            <div
              className="fixed left-2 right-2 z-[141] bg-white rounded-xl shadow-xl border border-slate-100 animate-in fade-in zoom-in-95 duration-200"
              style={{ top: mobilePanelTop }}
            >
              <NotificationPanelContent
                texts={texts}
                isLoading={isLoading}
                items={items}
                unreadCount={unreadCount}
                locale={locale}
                nextCursor={nextCursor}
                isLoadingMore={isLoadingMore}
                onMarkAllRead={markAllRead}
                onMarkRead={markRead}
                onLoadMore={loadMore}
                mobile
              />
            </div>
          </>
        ) : (
          <div
            className={
              panelClassName ||
              'absolute top-full right-0 mt-2 w-[360px] max-w-[92vw] bg-white rounded-xl shadow-xl border border-slate-100 z-[120] animate-in fade-in zoom-in-95 duration-200'
            }
          >
            <NotificationPanelContent
              texts={texts}
              isLoading={isLoading}
              items={items}
              unreadCount={unreadCount}
              locale={locale}
              nextCursor={nextCursor}
              isLoadingMore={isLoadingMore}
              onMarkAllRead={markAllRead}
              onMarkRead={markRead}
              onLoadMore={loadMore}
            />
          </div>
        ))}
    </div>
  )
}

function NotificationPanelContent({
  texts,
  isLoading,
  items,
  unreadCount,
  locale,
  nextCursor,
  isLoadingMore,
  onMarkAllRead,
  onMarkRead,
  onLoadMore,
  mobile = false
}: {
  texts: {
    title: string
    guestHint: string
    empty: string
    markAll: string
    loadMore: string
    notifications: string
  }
  isLoading: boolean
  items: NotificationRecord[]
  unreadCount: number
  locale: string
  nextCursor: string | null
  isLoadingMore: boolean
  onMarkAllRead: () => Promise<void>
  onMarkRead: (id: string) => Promise<void>
  onLoadMore: () => Promise<void>
  mobile?: boolean
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-3 border-b border-slate-100">
        <h3 className="text-sm font-bold text-slate-900 truncate">{texts.title}</h3>
        <button
          onClick={() => void onMarkAllRead()}
          className="inline-flex items-center gap-1 text-[11px] sm:text-xs text-slate-600 hover:text-slate-900 disabled:opacity-50 shrink-0"
          disabled={unreadCount <= 0}
        >
          <CheckCheck size={14} />
          {texts.markAll}
        </button>
      </div>

      <div className={mobile ? 'max-h-[min(65vh,460px)] overflow-y-auto' : 'max-h-[420px] overflow-y-auto'}>
        {isLoading ? (
          <div className="px-4 py-6 text-sm text-slate-500 flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            Loading...
          </div>
        ) : items.length === 0 ? (
          <div className="px-4 py-8 text-sm text-slate-500 text-center">{texts.empty}</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((item) => (
              <li
                key={item.id}
                className={`px-3 sm:px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors ${
                  item.readAt ? 'bg-white' : 'bg-sky-50/40'
                }`}
                onClick={() => {
                  if (!item.readAt) {
                    void onMarkRead(item.id)
                  }
                }}
              >
                <div className="flex items-start gap-2">
                  <span
                    className={`mt-1 h-2 w-2 rounded-full shrink-0 ${
                      item.readAt ? 'bg-slate-300' : 'bg-sky-500'
                    }`}
                  />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-slate-900 leading-snug">
                      {item.title}
                    </p>
                    <p className="text-xs text-slate-600 mt-1 leading-snug">{item.message}</p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      {new Date(item.createdAt).toLocaleString(
                        locale === 'tr' ? 'tr-TR' : 'en-US'
                      )}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {nextCursor && (
        <div className="px-4 py-3 border-t border-slate-100">
          <button
            onClick={() => void onLoadMore()}
            className="w-full h-9 text-sm rounded-md border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-50"
            disabled={isLoadingMore}
          >
            {isLoadingMore ? '...' : texts.loadMore}
          </button>
        </div>
      )}
    </>
  )
}
