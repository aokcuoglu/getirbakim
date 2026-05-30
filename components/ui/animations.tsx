'use client'

import * as React from 'react'
import {
  motion,
  AnimatePresence,
  type HTMLMotionProps
} from 'framer-motion'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

// ────────────────────────────────────────────────────────────
// AnimatedButton
// ────────────────────────────────────────────────────────────

interface AnimatedButtonProps extends React.ComponentProps<typeof Button> {
  hoverScale?: number
  tapScale?: number
}

export function AnimatedButton({
  hoverScale = 1.02,
  tapScale = 0.96,
  className,
  style,
  children,
  ...props
}: AnimatedButtonProps) {
  if (props.asChild) {
    return (
      <Button className={className} style={style} {...props}>
        {children}
      </Button>
    )
  }

  return (
    <motion.div
      style={{ display: 'inline-flex', ...style }}
      whileHover={{ scale: hoverScale }}
      whileTap={{ scale: tapScale }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className={cn(className)}
    >
      <Button {...props}>{children}</Button>
    </motion.div>
  )
}

// ────────────────────────────────────────────────────────────
// AnimatedContainer
// ────────────────────────────────────────────────────────────

interface AnimatedContainerProps extends HTMLMotionProps<'div'> {
  direction?: 'up' | 'down' | 'left' | 'right' | 'none'
  delay?: number
  animateOnView?: boolean
}

export function AnimatedContainer({
  direction = 'up',
  delay = 0,
  animateOnView: _animateOnView,
  children,
  className,
  ...props
}: AnimatedContainerProps) {
  const directionMap: Record<string, { x?: number; y?: number }> = {
    up: { y: 16 },
    down: { y: -16 },
    left: { x: 16 },
    right: { x: -16 },
    none: {}
  }

  const offset = directionMap[direction] || directionMap.up

  return (
    <motion.div
      initial={{ opacity: 0, ...offset }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.25, 0.1, 0.25, 1] }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  )
}

// ────────────────────────────────────────────────────────────
// StaggerContainer + StaggerItem
// ────────────────────────────────────────────────────────────

interface StaggerContainerProps extends HTMLMotionProps<'div'> {
  staggerDelay?: number
  initialDelay?: number
}

export function StaggerContainer({
  staggerDelay = 0.05,
  initialDelay = 0.05,
  children,
  className,
  ...props
}: StaggerContainerProps) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0 },
        visible: {
          opacity: 1,
          transition: {
            staggerChildren: staggerDelay,
            delayChildren: initialDelay
          }
        }
      }}
      initial="hidden"
      animate="visible"
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  )
}

interface StaggerItemProps extends HTMLMotionProps<'div'> {
  direction?: 'up' | 'down' | 'left' | 'right'
}

export function StaggerItem({
  direction = 'up',
  children,
  className,
  ...props
}: StaggerItemProps) {
  const offset =
    direction === 'up'
      ? { y: 12 }
      : direction === 'down'
        ? { y: -12 }
        : direction === 'left'
          ? { x: 12 }
          : { x: -12 }

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, ...offset },
        visible: {
          opacity: 1,
          x: 0,
          y: 0,
          transition: { duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }
        }
      }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  )
}

// ────────────────────────────────────────────────────────────
// ExpandCollapse
// ────────────────────────────────────────────────────────────

interface ExpandCollapseProps {
  isOpen: boolean
  duration?: number
  children: React.ReactNode
  className?: string
}

export function ExpandCollapse({
  isOpen,
  duration = 0.25,
  children,
  className
}: ExpandCollapseProps) {
  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration, ease: [0.25, 0.1, 0.25, 1] }}
          className={cn('overflow-hidden', className)}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ────────────────────────────────────────────────────────────
// ScaleIn
// ────────────────────────────────────────────────────────────

interface ScaleInProps {
  children: React.ReactNode
  className?: string
  delay?: number
}

export function ScaleIn({ children, className, delay = 0 }: ScaleInProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25, delay, ease: [0.25, 0.1, 0.25, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// ────────────────────────────────────────────────────────────
// FadeIn
// ────────────────────────────────────────────────────────────

interface FadeInProps extends HTMLMotionProps<'div'> {
  delay?: number
}

export function FadeIn({ children, className, delay = 0, ...props }: FadeInProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, delay, ease: 'easeOut' }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  )
}

// ────────────────────────────────────────────────────────────
// ScrollReveal
// ────────────────────────────────────────────────────────────

interface ScrollRevealProps {
  children: React.ReactNode
  className?: string
  direction?: 'up' | 'down' | 'left' | 'right'
  delay?: number
  threshold?: number
  once?: boolean
}

export function ScrollReveal({
  children,
  className,
  direction = 'up',
  delay = 0,
  threshold = 0.15,
  once = true
}: ScrollRevealProps) {
  const directionMap: Record<string, { x?: number; y?: number }> = {
    up: { y: 24 },
    down: { y: -24 },
    left: { x: 24 },
    right: { x: -24 }
  }

  const offset = directionMap[direction] || directionMap.up

  return (
    <motion.div
      initial={{ opacity: 0, ...offset }}
      whileInView={{ opacity: 1, x: 0, y: 0 }}
      viewport={{ once, margin: '-40px 0px', amount: threshold }}
      transition={{ duration: 0.5, delay, ease: [0.25, 0.1, 0.25, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// ────────────────────────────────────────────────────────────
// RotatingChevron
// ────────────────────────────────────────────────────────────

interface RotatingChevronProps {
  isExpanded: boolean
  className?: string
}

export function RotatingChevron({ isExpanded, className }: RotatingChevronProps) {
  return (
    <motion.svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      animate={{ rotate: isExpanded ? 180 : 0 }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
      className={className}
    >
      <path d="m6 9 6 6 6-6" />
    </motion.svg>
  )
}
