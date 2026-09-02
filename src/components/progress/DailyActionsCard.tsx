import React, { useState } from 'react'
import { Check, ChevronRight, Droplets, Dumbbell, Scale, Utensils } from 'lucide-react'
import type { DailyTask } from '../../types/progressTypes'

interface DailyActionsCardProps {
  onOpenQuickLog?: (type: DailyTask['type']) => void
  todayMealCount?: number
  todayWaterMl?: number
  waterTargetMl?: number
  todayWeightLogged?: boolean
  todayWorkoutLogged?: boolean
}

export function DailyActionsCard({
  onOpenQuickLog,
  todayMealCount,
  todayWaterMl,
  waterTargetMl = 0,
  todayWeightLogged,
  todayWorkoutLogged,
}: DailyActionsCardProps) {
  const actualWaterMl = todayWaterMl ?? 0
  const waterPct = waterTargetMl > 0 ? Math.min(100, Math.round((actualWaterMl / waterTargetMl) * 100)) : 0
  const isWaterDone = waterTargetMl > 0 && actualWaterMl >= waterTargetMl
  const isMealDone = typeof todayMealCount === 'number' ? todayMealCount > 0 : false
  const isWeightDone = typeof todayWeightLogged === 'boolean' ? todayWeightLogged : false
  const isWorkoutDone = typeof todayWorkoutLogged === 'boolean' ? todayWorkoutLogged : false

  const [manualCompleted, setManualCompleted] = useState<Record<string, boolean>>({})

  const isTaskCompleted = (id: string, type: DailyTask['type']) => {
    if (manualCompleted[id] !== undefined) return manualCompleted[id]
    switch (type) {
      case 'weight': return isWeightDone
      case 'meal': return isMealDone
      case 'water': return isWaterDone
      case 'workout': return isWorkoutDone
      default: return false
    }
  }

  const tasks: DailyTask[] = [
    {
      id: '1',
      title: 'Ghi cân nặng',
      subtitle: isWeightDone ? 'Đã ghi hôm nay' : 'Chưa ghi nhận',
      type: 'weight',
      completed: isTaskCompleted('1', 'weight')
    },
    {
      id: '2',
      title: 'Ghi bữa ăn',
      subtitle: todayMealCount !== undefined ? `${todayMealCount} bữa đã ghi` : 'Chưa ghi nhận',
      type: 'meal',
      completed: isTaskCompleted('2', 'meal')
    },
    {
      id: '3',
      title: 'Uống nước',
      subtitle: waterTargetMl > 0
        ? `${(actualWaterMl / 1000).toFixed(1)} / ${(waterTargetMl / 1000).toFixed(1)} lít`
        : 'Chưa thiết lập mục tiêu nước',
      type: 'water',
      completed: isTaskCompleted('3', 'water'),
      progress: waterPct
    },
    {
      id: '4',
      title: 'Buổi tập',
      subtitle: isWorkoutDone ? 'Đã hoàn thành' : 'Chưa ghi nhận',
      type: 'workout',
      completed: isTaskCompleted('4', 'workout')
    },
  ]

  const toggleTask = (id: string, type: DailyTask['type'], currentCompleted: boolean) => {
    if (!currentCompleted && onOpenQuickLog) {
      onOpenQuickLog(type)
    }
    setManualCompleted((prev) => ({ ...prev, [id]: !currentCompleted }))
  }

  const getIcon = (type: DailyTask['type']) => {
    switch (type) {
      case 'weight':
        return <Scale size={18} />
      case 'meal':
        return <Utensils size={18} />
      case 'water':
        return <Droplets size={18} />
      case 'workout':
        return <Dumbbell size={18} />
      default:
        return <Scale size={18} />
    }
  }

  const getIconClass = (type: DailyTask['type']) => {
    switch (type) {
      case 'weight':
        return 'pink'
      case 'meal':
        return 'orange'
      case 'water':
        return 'blue'
      case 'workout':
        return 'purple'
      default:
        return 'pink'
    }
  }

  return (
    <div className="pg-card">
      <div className="pg-actions-header">
        <h2>Hôm nay bạn cần làm gì?</h2>
        <button
          type="button"
          style={{
            background: 'none',
            border: 'none',
            color: '#ec4899',
            fontWeight: 700,
            fontSize: 13,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 2,
          }}
        >
          <span>Xem tất cả</span>
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="pg-actions-scroll">
        {tasks.map((task) => (
          <div
            key={task.id}
            className={`pg-action-card ${task.completed ? 'done' : ''}`}
            onClick={() => toggleTask(task.id, task.type, task.completed)}
          >
            <div className="pg-action-card-top">
              <div className={`pg-action-icon ${getIconClass(task.type)}`}>
                {getIcon(task.type)}
              </div>
              <div className="pg-action-check">
                {task.completed && <Check size={14} strokeWidth={3} />}
              </div>
            </div>

            <div>
              <p className="pg-action-title">{task.title}</p>
              <p className="pg-action-sub">{task.subtitle}</p>
            </div>

            {task.type === 'water' && typeof task.progress === 'number' && (
              <div style={{ width: '100%', height: 4, background: '#dbeafe', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${task.progress}%`, height: '100%', background: '#2563eb' }} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
