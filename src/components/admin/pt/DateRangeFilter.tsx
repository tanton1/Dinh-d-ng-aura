import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, ChevronDown } from 'lucide-react'
import '../../../styles-date-range-filter.css'

export type DateRangePreset =
  | 'Tất cả'
  | 'Hôm nay'
  | 'Ngày mai'
  | 'Hôm qua'
  | 'Tuần này'
  | 'Tuần sau'
  | 'Tháng này'
  | 'Tháng trước'
  | 'Tùy chỉnh'

interface Props {
  onFilter: (start: Date, end: Date) => void
  excludeFuture?: boolean
  compact?: boolean
  initialRange?: DateRangePreset
}

interface MenuPosition {
  top: number
  left: number
  width: number
  maxHeight: number
}

const pastOptions: DateRangePreset[] = ['Tất cả', 'Hôm nay', 'Hôm qua', 'Tuần này', 'Tháng này', 'Tháng trước']
const allOptions: DateRangePreset[] = ['Tất cả', 'Hôm nay', 'Ngày mai', 'Hôm qua', 'Tuần này', 'Tuần sau', 'Tháng này', 'Tháng trước']

export default function DateRangeFilter({ onFilter, excludeFuture = false, compact = false, initialRange = 'Tất cả' }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [range, setRange] = useState<DateRangePreset>(initialRange)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const onFilterRef = useRef(onFilter)
  const menuId = useId()

  useEffect(() => { onFilterRef.current = onFilter }, [onFilter])

  const applyFilter = useCallback((preset: DateRangePreset, start?: Date, end?: Date) => {
    let first = start || new Date()
    let last = end || new Date()
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)

    switch (preset) {
      case 'Tất cả':
        first = new Date(0)
        last = new Date(8640000000000000)
        break
      case 'Hôm nay':
        first = startOfToday
        last = endOfToday
        break
      case 'Ngày mai':
        first = new Date(startOfToday)
        first.setDate(first.getDate() + 1)
        last = new Date(endOfToday)
        last.setDate(last.getDate() + 1)
        break
      case 'Hôm qua':
        first = new Date(startOfToday)
        first.setDate(first.getDate() - 1)
        last = new Date(endOfToday)
        last.setDate(last.getDate() - 1)
        break
      case 'Tuần này': {
        const day = now.getDay()
        const monday = now.getDate() - day + (day === 0 ? -6 : 1)
        first = new Date(now.getFullYear(), now.getMonth(), monday, 0, 0, 0, 0)
        last = new Date(first)
        last.setDate(last.getDate() + 6)
        last.setHours(23, 59, 59, 999)
        break
      }
      case 'Tuần sau': {
        const day = now.getDay()
        const monday = now.getDate() - day + (day === 0 ? -6 : 1) + 7
        first = new Date(now.getFullYear(), now.getMonth(), monday, 0, 0, 0, 0)
        last = new Date(first)
        last.setDate(last.getDate() + 6)
        last.setHours(23, 59, 59, 999)
        break
      }
      case 'Tháng này':
        first = new Date(now.getFullYear(), now.getMonth(), 1)
        last = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
        break
      case 'Tháng trước':
        first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
        last = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
        break
      case 'Tùy chỉnh':
        break
    }
    onFilterRef.current(first, last)
  }, [])

  useEffect(() => { applyFilter(initialRange) }, [applyFilter, initialRange])

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const width = Math.min(compact ? 230 : 256, viewportWidth - 16)
    const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8))
    const spaceBelow = viewportHeight - rect.bottom - 8
    const spaceAbove = rect.top - 8
    const openAbove = spaceBelow < 300 && spaceAbove > spaceBelow
    const availableHeight = Math.max(160, (openAbove ? spaceAbove : spaceBelow) - 8)
    const maxHeight = Math.min(390, availableHeight)
    const top = openAbove
      ? Math.max(8, rect.top - maxHeight - 8)
      : Math.min(viewportHeight - maxHeight - 8, rect.bottom + 8)
    setMenuPosition({ top, left, width, maxHeight })
  }, [compact])

  useLayoutEffect(() => {
    if (!isOpen) return undefined
    updateMenuPosition()
    const frame = window.requestAnimationFrame(updateMenuPosition)
    const handleViewportChange = () => updateMenuPosition()
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [isOpen, updateMenuPosition])

  useEffect(() => {
    if (!isOpen) return undefined
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setIsOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const choosePreset = (preset: DateRangePreset) => {
    setRange(preset)
    applyFilter(preset)
    setIsOpen(false)
  }

  const applyCustomRange = () => {
    let first = new Date()
    if (customStart) {
      const [year, month, day] = customStart.split('-').map(Number)
      first = new Date(year, month - 1, day, 0, 0, 0, 0)
    }
    let last = new Date()
    if (customEnd) {
      const [year, month, day] = customEnd.split('-').map(Number)
      last = new Date(year, month - 1, day, 23, 59, 59, 999)
    }
    if (first > last) return
    setRange('Tùy chỉnh')
    applyFilter('Tùy chỉnh', first, last)
    setIsOpen(false)
  }

  const menu = isOpen && menuPosition && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={menuRef}
        id={menuId}
        className={`date-range-filter__menu date-range-filter__portal-menu ${compact ? 'date-range-filter__portal-menu--compact' : ''}`}
        role="dialog"
        aria-label="Chọn khoảng thời gian"
        style={{ top: menuPosition.top, left: menuPosition.left, width: menuPosition.width, maxHeight: menuPosition.maxHeight }}
      >
        <div className="date-range-filter__presets" role="listbox" aria-label="Khoảng thời gian nhanh">
          {(excludeFuture ? pastOptions : allOptions).map((preset) => (
            <button key={preset} type="button" role="option" aria-selected={range === preset} className={range === preset ? 'is-active' : ''} onClick={() => choosePreset(preset)}>
              {preset}
            </button>
          ))}
        </div>
        <div className="date-range-filter__custom">
          <label><span>Từ ngày</span><input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label>
          <label><span>Đến ngày</span><input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label>
          <button type="button" disabled={!customStart || !customEnd || customStart > customEnd} onClick={applyCustomRange}>Áp dụng</button>
        </div>
      </div>,
      document.body,
    )
    : null

  return (
    <div ref={rootRef} className={`date-range-filter ${compact ? 'date-range-filter--compact' : ''}`}>
      <button ref={triggerRef} type="button" onClick={() => setIsOpen((current) => !current)} aria-expanded={isOpen} aria-controls={menuId} className="date-range-filter__trigger">
        <span className="date-range-filter__trigger-label"><Calendar aria-hidden="true" /><span>{range}</span></span>
        <ChevronDown aria-hidden="true" className={isOpen ? 'is-open' : ''} />
      </button>
      {menu}
    </div>
  )
}
