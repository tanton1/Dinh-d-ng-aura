import React, { useState } from 'react'
import { Check, ChevronRight, Droplets, Dumbbell, Scale, Utensils } from 'lucide-react'
import type { DailyTask } from '../../types/progressTypes'

interface DailyActionsCardProps {
  onOpenQuickLog?: (type: DailyTask['type']) => void
}

export function DailyActionsCard({ onOpenQuickLog }: DailyActionsCardProps) {
  const [tasks, setTasks] = useState<DailyTask[]>([
    { id: '1', title: 'Ghi cân nặng', subtitle: 'Buổi sáng', type: 'weight', completed: false },
    { id: '2', title: 'Ghi bữa ăn', subtitle: 'Sáng', type: 'meal', completed: true },
    { id: '3', title: 'Uống nước', subtitle: '1.2 / 2.2 lít', type: 'water', completed: false, progress: 55 },
    { id: '4', title: 'Buổi tập', subtitle: 'Thân dưới', type: 'workout', completed: false },
  ])

  const toggleTask = (id: string, type: DailyTask['type'], currentCompleted: boolean) => {
    if (!currentCompleted && onOpenQuickLog) {
      onOpenQuickLog(type)
    }
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t))
    )
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
            color: '#f72567',
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
