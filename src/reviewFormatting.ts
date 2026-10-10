export type SummaryPoint = { title: string; detail: string }

export type NextTimeContent = { steps: string[]; examples: string[] }

function normalizedText(value: string) {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase()
}

function uniqueTexts(values: unknown[]) {
  const seen = new Set<string>()
  return values.flatMap((value) => {
    if (typeof value !== 'string' || !value.trim()) return []
    const text = value.trim()
    const key = normalizedText(text)
    if (seen.has(key)) return []
    seen.add(key)
    return [text]
  })
}

export function getNextTimeContent(items: unknown, legacySuggestion: unknown): NextTimeContent {
  const validItems = Array.isArray(items) ? items.filter((item) => item && typeof item === 'object') : []
  const steps = uniqueTexts(validItems.map((item: any) => item.next_step))
  const examples = uniqueTexts(validItems.map((item: any) => item.example))

  if (typeof legacySuggestion === 'string' && legacySuggestion.trim()) {
    const legacyKey = normalizedText(legacySuggestion)
    const stepKeys = steps.map(normalizedText)
    const isExistingAlias = stepKeys.includes(legacyKey)
      || (steps.length > 1 && legacyKey === normalizedText(steps.join(' ')))
    if (!isExistingAlias) {
      steps.push(legacySuggestion.trim())
    }
  }

  return { steps, examples }
}

export function removeRepeatedFeedback(feedback: string, nextTimeTexts: string[]) {
  const nextTimeKeys = new Set(nextTimeTexts.map(normalizedText))
  if (nextTimeKeys.has(normalizedText(feedback))) return ''

  return feedback
    .split(/\n\s*\n/)
    .filter((paragraph) => paragraph.trim() && !nextTimeKeys.has(normalizedText(paragraph)))
    .join('\n\n')
    .trim()
}

export function combineIssueAndEvidence(issue: string, evidence: string) {
  const cleanIssue = issue.trim()
  const cleanEvidence = evidence.trim()
  if (!cleanIssue) return cleanEvidence
  if (!cleanEvidence) return cleanIssue
  const normalizedIssue = normalizedText(cleanIssue)
  const normalizedEvidence = normalizedText(cleanEvidence)
  if (normalizedIssue === normalizedEvidence) return cleanIssue
  // Old records sometimes already put a complete evidence sentence in the issue.
  // Only suppress substantial contained text, avoiding accidental matches on short words.
  if (normalizedEvidence.length >= 12 && normalizedIssue.includes(normalizedEvidence)) return cleanIssue
  return `${cleanIssue}：${cleanEvidence}`
}

export function getSummaryPoints(points: unknown, legacySummary: unknown): SummaryPoint[] {
  if (Array.isArray(points)) {
    const normalized = points.flatMap((point) => {
      if (typeof point === 'string' && point.trim()) return [{ title: '', detail: point.trim() }]
      if (!point || typeof point !== 'object') return []
      const detail = typeof (point as any).detail === 'string'
        ? (point as any).detail.trim()
        : typeof (point as any).summary === 'string' ? (point as any).summary.trim() : ''
      if (!detail) return []
      const title = typeof (point as any).title === 'string' ? (point as any).title.trim() : ''
      return [{ title, detail }]
    })
    if (normalized.length) return normalized.slice(0, 4)
  }

  return typeof legacySummary === 'string' && legacySummary.trim()
    ? [{ title: '', detail: legacySummary.trim() }]
    : []
}
