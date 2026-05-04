'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, Info, Wrench, Clock } from 'lucide-react'

interface CategoryInfoProps {
  categoryName: string
}

interface FAQItem {
  question: string
  answer: string
  icon: React.ReactNode
}

export function CategoryInfo({ categoryName }: CategoryInfoProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  const faqs: FAQItem[] = [
    {
      question: `What are ${categoryName.toLowerCase()}?`,
      answer: `${categoryName} are essential components in your vehicle's systems. They help remove contaminants and impurities, ensuring clean operation and protecting vital engine components from damage. Regular replacement is key to maintaining optimal performance.`,
      icon: <Info size={20} className="text-blue-600" />
    },
    {
      question: `How often should you change ${categoryName.toLowerCase()}?`,
      answer: `The replacement interval depends on your vehicle type, driving conditions, and manufacturer recommendations. Generally, filters should be replaced every 15,000-30,000 km or during regular service intervals. Check your owner's manual for specific guidance.`,
      icon: <Clock size={20} className="text-blue-600" />
    },
    {
      question: `How to choose the right ${categoryName
        .toLowerCase()
        .replace('s', '')}?`,
      answer: `To choose the right filter, you need to know your vehicle's make, model, year, and engine type. Use our vehicle selector above to find compatible filters. Always choose quality brands that meet or exceed OEM specifications for best performance.`,
      icon: <Wrench size={20} className="text-blue-600" />
    }
  ]

  const toggleFAQ = (index: number) => {
    setOpenIndex(openIndex === index ? null : index)
  }

  return (
    <div className="bg-gradient-to-b from-slate-50 to-white py-12 mt-12 border-t border-slate-200">
      <div className="max-w-4xl mx-auto px-4">
        <h2 className="text-2xl font-bold text-slate-900 mb-8 text-center">
          Everything you need to know about {categoryName}
        </h2>

        {/* FAQ Accordion */}
        <div className="space-y-3">
          {faqs.map((faq, index) => (
            <div
              key={index}
              className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm"
            >
              <button
                onClick={() => toggleFAQ(index)}
                className="w-full flex items-center gap-4 p-5 text-left hover:bg-slate-50 transition-colors"
              >
                <div className="shrink-0 w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                  {faq.icon}
                </div>
                <span className="flex-1 font-semibold text-slate-900">
                  {faq.question}
                </span>
                <div className="shrink-0 text-slate-400">
                  {openIndex === index ? (
                    <ChevronUp size={20} />
                  ) : (
                    <ChevronDown size={20} />
                  )}
                </div>
              </button>

              {openIndex === index && (
                <div className="px-5 pb-5 pl-[76px]">
                  <p className="text-slate-600 leading-relaxed">{faq.answer}</p>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Additional Info */}
        <div className="mt-10 p-6 bg-blue-50 rounded-xl border border-blue-100">
          <h3 className="font-semibold text-slate-900 mb-3">
            Why buy {categoryName.toLowerCase()} from us?
          </h3>
          <ul className="space-y-2 text-slate-700">
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-blue-600 rounded-full"></span>
              Wide selection of top brands at competitive prices
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-blue-600 rounded-full"></span>
              Fast worldwide shipping with DHL Express
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-blue-600 rounded-full"></span>
              OEM quality products with manufacturer warranty
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-blue-600 rounded-full"></span>
              Expert customer support to help you find the right parts
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}
