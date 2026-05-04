'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Bot, MessageSquare, Send, X } from 'lucide-react'
import { GlassCard } from './Glass'
import { useShop } from '@/components/ShopProvider'
import { CustomerRequestDialog } from '@/components/customer-requests/CustomerRequestDialog'
import { getMechanicAdvice } from '../services/geminiService'

interface Message {
  id: string
  sender: 'user' | 'bot'
  text: string
}

function buildBotGreeting(vehicleLabel: string | null) {
  return `Systems online. I can assist with part compatibility for ${vehicleLabel || 'your vehicle'}.`
}

export default function ChatAssistant() {
  const t = useTranslations('CustomerRequests.chat')
  const pathname = usePathname()
  const { selectedVehicle } = useShop()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const isAdminRoute = /^\/(?:[a-z]{2}\/)?admin(?:\/|$)/.test(pathname)

  const vehicleLabel = selectedVehicle
    ? [
        selectedVehicle.year,
        selectedVehicle.make,
        selectedVehicle.model,
        selectedVehicle.engine
      ]
        .filter(Boolean)
        .join(' ')
    : null

  useEffect(() => {
    setMessages([
      {
        id: '1',
        sender: 'bot',
        text: buildBotGreeting(vehicleLabel)
      }
    ])
  }, [vehicleLabel])

  useEffect(() => {
    if (!isChatOpen) return
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [isChatOpen, messages])

  if (isAdminRoute) {
    return null
  }

  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    const userMsg: Message = {
      id: Date.now().toString(),
      sender: 'user',
      text: input.trim()
    }

    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setIsLoading(true)

    const responseText = await getMechanicAdvice(input, vehicleLabel)

    setMessages((prev) => [
      ...prev,
      {
        id: `${Date.now()}-bot`,
        sender: 'bot',
        text: responseText
      }
    ])
    setIsLoading(false)
  }

  return (
    <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-40">
      {isChatOpen && (
        <GlassCard className="mb-3 flex h-[min(70vh,480px)] w-[min(92vw,340px)] flex-col border border-slate-200 bg-white shadow-2xl animate-in slide-in-from-bottom-5 fade-in duration-200">
          <div className="flex items-center justify-between border-b border-slate-100 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-white">
                <Bot size={18} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  {t('aiTitle')}
                </h3>
                <span className="flex items-center gap-1 font-mono text-[10px] text-slate-500">
                  ● ACTIVE
                </span>
              </div>
            </div>
            <button
              onClick={() => setIsChatOpen(false)}
              className="text-slate-400 hover:text-slate-900"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto bg-slate-50/50 p-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-4 py-2.5 text-sm ${
                    msg.sender === 'user'
                      ? 'bg-slate-900 text-white'
                      : 'border border-slate-200 bg-white text-slate-700 shadow-sm'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="flex gap-1 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 delay-100" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 delay-200" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="flex gap-2 border-t border-slate-100 bg-white p-3">
            <input
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void handleSend()
                }
              }}
              placeholder={t('aiPlaceholder')}
              className="flex-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm transition-all focus:border-slate-400 focus:bg-white focus:outline-none"
            />
            <button
              onClick={() => void handleSend()}
              disabled={isLoading}
              className="rounded-md border border-slate-200 bg-white p-2 text-slate-900 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              <Send size={18} />
            </button>
          </div>
        </GlassCard>
      )}

      {(isMenuOpen || isChatOpen) && (
        <div className="mb-3 flex w-[min(92vw,340px)] flex-col items-stretch gap-2">
          <button
            onClick={() => {
              setIsMenuOpen(false)
              setIsChatOpen(true)
            }}
            className="w-full rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-lg transition-colors hover:bg-slate-50"
          >
            {t('aiSupport')}
          </button>

          <CustomerRequestDialog
            requestType="MISSING_PRODUCT"
            source="MISSING_PRODUCT_MODAL"
            trigger={
              <button
                onClick={() => setIsMenuOpen(false)}
                className="w-full rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-900 shadow-lg transition-colors hover:bg-emerald-100"
              >
                {t('missingProduct')}
              </button>
            }
          />
        </div>
      )}

      <button
        onClick={() => {
          if (isChatOpen) {
            setIsChatOpen(false)
            return
          }

          setIsMenuOpen((prev) => !prev)
        }}
        className={`flex h-12 w-12 items-center justify-center rounded-xl text-white shadow-lg transition-all duration-300 ${
          isChatOpen || isMenuOpen
            ? 'bg-slate-700 rotate-90'
            : 'bg-slate-900 hover:bg-slate-800'
        }`}
      >
        {isChatOpen || isMenuOpen ? <X size={20} /> : <MessageSquare size={20} />}
      </button>
    </div>
  )
}
