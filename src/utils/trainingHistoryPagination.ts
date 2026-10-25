import type { TrainingHistoryPage } from '../services/businessReportingService'

/** Retain totals only while appending to the same person and filter range. */
export function mergeTrainingHistoryPage(current: TrainingHistoryPage | null, response: TrainingHistoryPage, append: boolean): TrainingHistoryPage {
  if (!append || !current
    || current.subjectType !== response.subjectType
    || current.subjectId !== response.subjectId
    || current.filters.startDate !== response.filters.startDate
    || current.filters.endDate !== response.filters.endDate
    || current.filters.status !== response.filters.status
    || Boolean(current.filters.allTime) !== Boolean(response.filters.allTime)) return response

  const records = new Map(current.records.map((record) => [record.id, record]))
  response.records.forEach((record) => records.set(record.id, record))
  return { ...response, records: [...records.values()], summary: response.summary ?? current.summary }
}
