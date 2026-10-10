import { useState, type KeyboardEvent, type ReactNode, useEffect, useRef } from 'react'
import { Link, Route, Routes, useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { combineIssueAndEvidence, getNextTimeContent, getSummaryPoints, removeRepeatedFeedback } from './reviewFormatting'
import { scrollContainerToBottom } from './coachScroll'
import './App.css'

const interviews = [
  { role: 'AI Product Manager', round: 'Round 1', company: 'Northstar AI', date: 'Sep 28, 2026' },
  { role: 'Software Engineer', round: 'Technical Interview', company: 'Linear', date: 'Sep 22, 2026' },
  { role: 'AI Product Manager', round: 'Case Interview', company: 'Fable', date: 'Sep 16, 2026' },
]

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const }
  if (name === 'menu') return <svg {...common}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
  if (name === 'plus') return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>
  if (name === 'folder') return <svg {...common}><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H10l2 2h7.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" /></svg>
  if (name === 'chevron') return <svg {...common}><path d="m9 18 6-6-6-6" /></svg>
  if (name === 'upload') return <svg {...common}><path d="M12 16V4m-4 4 4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
  if (name === 'spark') return <svg {...common}><path d="m12 3 1.4 5.6L19 10l-5.6 1.4L12 17l-1.4-5.6L5 10l5.6-1.4L12 3ZM19 16l.6 2.4L22 19l-2.4.6L19 22l-.6-2.4L16 19l2.4-.6L19 16Z" /></svg>
  return <svg {...common}><circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>
}

function Shell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const navigate = useNavigate()
  return <div className="app-shell">
    {sidebarOpen && <><button className="sidebar-scrim" aria-label="Close menu" onClick={() => setSidebarOpen(false)} /><aside className="sidebar">
      <button className="new-interview" onClick={() => navigate('/upload')}><Icon name="plus" /> <span>Start New</span><span className="shortcut">⌘ K</span></button>
      <div className="side-label">FOLDERS</div>
      <nav className="folder-list" aria-label="Interview folders">
        {['All Interviews', 'AI Product Manager', 'Software Engineer', 'Other positions'].map((folder, i) => <button key={folder} className={`folder-item ${i === 0 ? 'selected' : ''}`}><Icon name="folder" size={16}/><span>{folder}</span>{i === 0 && <span className="folder-count">3</span>}</button>)}
      </nav>
      <div className="history-heading"><span className="side-label">RECENT</span><button aria-label="More interview history">···</button></div>
      <div className="history-list">{interviews.map((item, i) => <button className="history-item" key={`${item.company}-${i}`} onClick={() => navigate('/interview/demo')}>
        <span className="history-role">{item.role}</span><span className="history-meta">{item.round} · {item.company}</span><span className="history-date">{item.date}</span>
      </button>)}</div>
      <div className="sidebar-foot"><span className="avatar-small">JD</span><div><strong>Jordan Davis</strong><small>Personal workspace</small></div><span className="more">···</span></div>
    </aside></>}
    <header className="topbar"><div className="topbar-left"><button className="icon-button menu-button" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}><Icon name="menu" size={20}/></button><Link to="/" className="brand"><span className="brand-mark"><Icon name="spark" size={17}/></span><span>interview<span className="brand-light">coach</span></span></Link></div><button className="profile-button"><span className="avatar">JD</span><span>My Profile</span><span className="profile-caret">⌄</span></button></header>
    <main className="main-area">{children}</main>
  </div>
}

function Home() {
  const navigate = useNavigate()
  return <div className="home-view"><div className="home-center"><div className="home-icon"><Icon name="upload" size={23}/></div><h1>Your interview workspace</h1><p>Upload a recording to get thoughtful, actionable coaching.</p><button className="primary-button" onClick={() => navigate('/upload')}><Icon name="plus" size={17}/> Upload Interview</button><span className="home-hint">Audio or video recording · MP3, WAV, MP4</span></div><div className="home-footer"><span><span className="status-dot"/> Your recordings stay yours</span><span>Private workspace</span></div></div>
}

function Upload() {
  const navigate = useNavigate()

  const [file, setFile] = useState<File | null>(null)
  const [role, setRole] = useState('')
  const [round, setRound] = useState('')
  const [company, setCompany] = useState('')
  const [jd, setJd] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!file || !role || !round) {
      return
    }

    setUploading(true)
    setError('')

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('http://127.0.0.1:8000/api/interviews/upload', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Upload failed')
      }
      if (typeof data?.transcript !== 'string' || !data.transcript.trim()) {
        throw new Error('No usable speech was transcribed. Check that the recording contains clear speech, then upload it again.')
      }

      // 暂时把分析结果保存下来，后面的 Processing 页面会继续使用
      sessionStorage.setItem(
        'interviewData',
        JSON.stringify({
          filename: data.filename,
          transcript: data.transcript,
          role,
          round,
          company,
          jd,
        })
      )

      navigate('/processing')
    } catch (err) {
      console.error('Upload error:', err)
      if (err instanceof Error) {
        setError(`Upload failed: ${err.message}`)
      } else {
        setError('Upload failed. Please check the browser console.')
      }
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="form-page">
      <div className="breadcrumbs">
        <Link to="/">Workspace</Link>
        <Icon name="chevron" size={14} />
        <span>New interview</span>
      </div>

      <div className="form-heading">
        <div className="eyebrow">INTERVIEW REVIEW</div>
        <h1>Upload an interview</h1>
        <p>Add a recording and a little context to get started.</p>
      </div>

      <form className="upload-form" onSubmit={handleSubmit}>
        <div className="field-block">
          <label>
            Interview recording <span className="required">Required</span>
          </label>

          <label className={`dropzone ${file ? 'has-file' : ''}`}>
            <input
              type="file"
              accept="audio/*,video/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />

            {file ? (
              <>
                <span className="file-icon">
                  <Icon name="upload" />
                </span>

                <span className="file-info">
                  <strong>{file.name}</strong>
                  <small>
                    {(file.size / (1024 * 1024)).toFixed(1)} MB · Ready to analyze
                  </small>
                </span>

                <span className="change-file">Change</span>
              </>
            ) : (
              <>
                <span className="upload-icon">
                  <Icon name="upload" size={20} />
                </span>

                <span>
                  <strong>Choose a file or drag it here</strong>
                  <small>MP3, WAV, M4A, MP4 · Up to 500 MB</small>
                </span>
              </>
            )}
          </label>
        </div>

        <div className="field-row">
          <div className="field-block">
            <label htmlFor="position">
              Position <span className="required">Required</span>
            </label>

            <select
              id="position"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              required
            >
              <option value="" disabled>
                Select a position
              </option>
              <option>AI Product Manager</option>
              <option>Software Engineer</option>
              <option>Data Analyst</option>
              <option>Other</option>
            </select>
          </div>

          <div className="field-block">
            <label htmlFor="round">
              Interview round <span className="required">Required</span>
            </label>

            <select
              id="round"
              value={round}
              onChange={(e) => setRound(e.target.value)}
              required
            >
              <option value="" disabled>
                Select a round
              </option>

              {[
                'Round 1',
                'Round 2',
                'Final Round',
                'HR Interview',
                'Technical Interview',
                'Case Interview',
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="field-block">
          <label htmlFor="company">
            Company <span className="optional">Optional</span>
          </label>

          <input
            id="company"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="e.g. Acme"
          />
        </div>

        <div className="field-block">
          <label htmlFor="jd">
            Job description <span className="optional">Optional</span>
          </label>

          <textarea
            id="jd"
            rows={4}
            value={jd}
            onChange={(e) => setJd(e.target.value)}
            placeholder="Paste the job description to give your interview review more context."
          />

          <small className="field-help">
            Used as context for your interview review.
          </small>
        </div>

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        <div className="form-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => navigate('/')}
            disabled={uploading}
          >
            Cancel
          </button>

          <button
            className="primary-button"
            type="submit"
            disabled={!file || !role || !round || uploading}
          >
            {uploading ? 'Uploading...' : 'Start analysis'}
            {!uploading && <Icon name="chevron" size={16} />}
          </button>
        </div>
      </form>
    </div>
  )
}

type AnalysisRequest = {
  controller: AbortController
  promise: Promise<any>
  subscribers: number
  cancelTimer?: ReturnType<typeof setTimeout>
}

const analysisRequestsInFlight = new Map<string, AnalysisRequest>()

function subscribeToAnalysis(transcript: string) {
  let entry = analysisRequestsInFlight.get(transcript)
  if (entry?.cancelTimer) {
    clearTimeout(entry.cancelTimer)
    entry.cancelTimer = undefined
  }
  if (!entry) {
    const controller = new AbortController()
    const promise = fetch('http://127.0.0.1:8000/api/interviews/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript }),
      signal: controller.signal,
    }).then(async (response) => {
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'Interview analysis failed')
      return data
    })
    entry = { controller, promise, subscribers: 0 }
    analysisRequestsInFlight.set(transcript, entry)
    const clearRequest = () => {
      if (analysisRequestsInFlight.get(transcript) === entry) {
        analysisRequestsInFlight.delete(transcript)
      }
    }
    promise.then(clearRequest, clearRequest)
  }

  entry.subscribers += 1
  let released = false
  return {
    promise: entry.promise,
    release: () => {
      if (released) return
      released = true
      entry!.subscribers -= 1
      if (entry!.subscribers === 0) {
        // Defer abort by one task so StrictMode's immediate effect replay can
        // resubscribe to the same request instead of issuing a second one.
        entry!.cancelTimer = setTimeout(() => {
          if (entry!.subscribers === 0 && analysisRequestsInFlight.get(transcript) === entry) {
            entry!.controller.abort()
            analysisRequestsInFlight.delete(transcript)
          }
        }, 0)
      }
    },
  }
}

function Processing() {
  const navigate = useNavigate()

  const [error, setError] = useState('')
  const [progressState, setProgressState] = useState<'analyzing' | 'preparing' | 'failed'>('analyzing')
  const [retryAttempt, setRetryAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    let releaseAnalysis: (() => void) | undefined
    const runAnalysis = async () => {
      try {
        setError('')
        setProgressState('analyzing')
        const storedData = sessionStorage.getItem('interviewData')

        if (!storedData) {
          throw new Error('Interview data not found')
        }

        const interviewData = JSON.parse(storedData)

        if (!interviewData.transcript) {
          throw new Error('Transcript not found')
        }

        // The upload endpoint has already completed audio conversion and ASR.
        // Only the analysis request remains in this view.
        const analysisRequest = subscribeToAnalysis(interviewData.transcript)
        releaseAnalysis = analysisRequest.release
        let analysisData
        try {
          analysisData = await analysisRequest.promise
        } finally {
          analysisRequest.release()
          releaseAnalysis = undefined
        }
        if (cancelled) return

        setProgressState('preparing')

        // Save the real analysis result
        sessionStorage.setItem(
          'interviewAnalysis',
          JSON.stringify({
            ...interviewData,
            analysis: analysisData,
          })
        )

        requestAnimationFrame(() => {
          if (!cancelled) navigate('/interview/demo')
        })
      } catch (err) {
        if (cancelled) return
        setProgressState('failed')
        console.error('Analysis error:', err)

        if (err instanceof Error) {
          setError(err.message)
        } else {
          setError('Failed to analyze the interview')
        }
      }
    }

    runAnalysis()
    return () => {
      // Ignore stale completions when React replays the effect or the user leaves.
      // The module-level in-flight request is shared so StrictMode's replay reuses it.
      cancelled = true
      releaseAnalysis?.()
    }
  }, [navigate, retryAttempt])

  const steps = [
    'Processing audio',
    'Generating transcript',
    'Identifying questions and answers',
    'Analyzing interview responses',
    'Preparing interview review',
  ]

  return (
    <div className="processing-view">
      <div className="processing-icon">
        <Icon name="spark" size={24} />
      </div>

      <h1>Preparing your interview review</h1>

      <p>
        This usually takes a few minutes. You can stay here while we work.
      </p>

      <div className="processing-steps">
        {steps.map((step, index) => {
          // Upload and ASR have completed before this route is entered. The analyze
          // endpoint performs extraction and evaluation in one request, so both
          // backend phases remain active together until that request resolves.
          const isCompleted = index < 2 || (progressState === 'preparing' && index < 4)
          const isActive = progressState === 'analyzing' ? index === 2 || index === 3
            : progressState === 'preparing' && index === 4

          return (
            <div key={step} className={`processing-step ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}>
              <span className="step-indicator">
                {isActive ? <span className="spinner" /> : isCompleted ? '✓' : index + 1}
              </span>
              <span>{step}</span>
              {isActive && <small>In progress</small>}
            </div>
          )
        })}
      </div>

      {error && (
        <div className="processing-error" role="alert">
          {error}{' '}
          <p>Retry analysis uses the saved transcript only. To retry upload or transcription, return to the upload page and submit the recording again.</p>
          <button type="button" onClick={() => setRetryAttempt((attempt) => attempt + 1)}>
            Retry analysis
          </button>
        </div>
      )}
    </div>
  )
}

const assessmentLevels = ['Excellent', 'Good', 'Needs Improvement'] as const
type AssessmentLevel = typeof assessmentLevels[number]

function isAssessmentLevel(value: unknown): value is AssessmentLevel {
  return typeof value === 'string' && assessmentLevels.includes(value as AssessmentLevel)
}

function Overview() {
  const [coachReference, setCoachReference] = useState('')
  const [coachOpen, setCoachOpen] = useState(false)
  const [interviewData, setInterviewData] = useState<any>(null)

  useEffect(() => {
    const storedData = sessionStorage.getItem('interviewAnalysis')

    if (storedData) {
      setInterviewData(JSON.parse(storedData))
    }
  }, [])

  if (!interviewData) {
    return (
      <div className="overview-view">
        <p>Loading interview review...</p>
      </div>
    )
  }

  const { role, round, company, analysis } = interviewData

  const qaAnalysis = Array.isArray(analysis?.qa_analysis) ? analysis.qa_analysis : []
  const fallbackAssessment: AssessmentLevel = qaAnalysis.some(
    (item: any) => item?.overall_assessment === 'Needs Improvement'
  )
    ? 'Needs Improvement'
    : qaAnalysis.length > 0 && qaAnalysis.every((item: any) => item?.overall_assessment === 'Excellent')
      ? 'Excellent'
      : 'Good'
  const overallAssessment = isAssessmentLevel(analysis?.overall_assessment)
    ? analysis.overall_assessment
    : fallbackAssessment
  const fallbackSummary = qaAnalysis.length === 0
    ? 'No interview Q&A was available to form an overall summary.'
    : overallAssessment === 'Excellent'
      ? 'The overall rating is Excellent. Review the question-level feedback below for the supporting details.'
      : overallAssessment === 'Needs Improvement'
        ? 'The overall rating is Needs Improvement. Review the question-level feedback below for the areas to work on.'
        : 'The overall rating is Good. Review the question-level feedback below for the supporting details.'
  const overallSummary = typeof analysis?.overall_summary === 'string' && analysis.overall_summary.trim()
    ? analysis.overall_summary.trim()
    : fallbackSummary
  const overallSummaryPoints = getSummaryPoints(analysis?.overall_summary_points, overallSummary)

  return (
    <div className={`review-layout ${coachOpen ? 'coach-is-open' : ''}`}>
    <div className="overview-view">
      <div className="breadcrumbs">
        <Link to="/">Workspace</Link>
        <Icon name="chevron" size={14} />
        <span>Interview review</span>
      </div>

      <div className="overview-header">
        <div>
          <div className="eyebrow">INTERVIEW REVIEW</div>

          <h1>{role || 'Interview'}</h1>

          <p>
            {round || 'Interview'}
            {company && (
              <>
                <span> · </span>
                {company}
              </>
            )}
          </p>
        </div>

        <div className="overview-date">
          {new Date().toLocaleDateString('en-US', {
            month: 'short',
            day: '2-digit',
            year: 'numeric',
          })}
        </div>
      </div>

      <section className="assessment">
        <div className="assessment-label">
          <span className="assessment-dot" />
          OVERALL ASSESSMENT
          <span className="qualitative">
            {overallAssessment}
          </span>
        </div>

        {overallSummaryPoints.length > 0 && (
          <ul className="overview-summary-points">
            {overallSummaryPoints.map((point, index) => (
              <li key={`${point.title}-${index}`}>
                {point.title && <strong>{point.title}</strong>}
                {point.title && ' '}
                {point.detail}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="questions-section">
        <div className="section-heading">
          <div>
            <div className="eyebrow">YOUR CONVERSATION</div>
            <h2>Interview Questions</h2>
          </div>

          <span className="question-count">
            {qaAnalysis.length} questions
          </span>
        </div>

        <div className="question-list">
          {qaAnalysis.map((item: any, index: number) => (
            <QuestionCard
              key={index}
              number={`Q${index + 1}`}
              question={item.question}
              label={isAssessmentLevel(item.overall_assessment) ? item.overall_assessment : 'Good'}
              detail={item}
              onToggle={(expanded) =>
                {
                  setCoachReference(expanded ? `Question ${index + 1}` : '')
                  if (expanded) setCoachOpen(true)
                }
              }
            />
          ))}
        </div>
      </section>

    </div>
      <CoachBar reference={coachReference} interviewData={interviewData} open={coachOpen} onOpenChange={setCoachOpen} />
    </div>
  )
}

function QuestionCard({
  number,
  question,
  label,
  detail,
  onToggle,
}: {
  number: string
  question: string
  label: string
  detail: any
  onToggle: (expanded: boolean) => void
}) {
  const [expanded, setExpanded] = useState(false)

  const toggle = () => {
    const nextExpanded = !expanded
    setExpanded(nextExpanded)
    onToggle(nextExpanded)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      toggle()
    }
  }

  const dimensions = [
    'Relevance',
    'Structure',
    'Specificity',
    'Depth',
    'Communication',
  ]
  const improvementItems: Array<{ issue: string; evidence: string; nextStep: string; example: string }> = Array.isArray(detail?.improvements) && detail.improvements.length > 0
    ? detail.improvements.flatMap((item: any) => (
      item && typeof item === 'object'
        ? [{
          issue: typeof item.issue === 'string' ? item.issue : '',
          evidence: typeof item.evidence === 'string' ? item.evidence : '',
          nextStep: typeof item.next_step === 'string' ? item.next_step : '',
          example: typeof item.example === 'string' ? item.example : '',
        }].filter((normalized) => normalized.issue.trim() || normalized.evidence.trim() || normalized.nextStep.trim() || normalized.example.trim())
        : []
    ))
    : (Array.isArray(detail?.areas_to_improve) ? detail.areas_to_improve : [])
      .flatMap((issue: any) => typeof issue === 'string' && issue.trim()
        ? [{ issue, evidence: '', nextStep: typeof detail?.suggested_improvement === 'string' ? detail.suggested_improvement : '', example: '' }]
        : [])
  const feedbackSummary = typeof detail?.summary === 'string' && detail.summary.trim()
    ? detail.summary.trim()
    : typeof detail?.analysis === 'string' && detail.analysis.trim()
      ? detail.analysis.trim()
      : ''
  const dimensionItems = dimensions.flatMap((name) => {
    const item = detail?.dimensions?.[name]
    if (!item || typeof item !== 'object') return []
    const assessment = isAssessmentLevel(item.assessment) ? item.assessment : ''
    const explanation = typeof item.explanation === 'string' ? item.explanation : ''
    return assessment || explanation ? [{ name, assessment, explanation }] : []
  })
  const nextTime = getNextTimeContent(improvementItems, detail?.suggested_improvement)
  const nextTimeTexts = [...nextTime.steps, ...nextTime.examples]
  const visibleFeedbackSummary = removeRepeatedFeedback(feedbackSummary, nextTimeTexts)
  const visibleImprovementDetails = improvementItems.map((item) => ({
    issue: removeRepeatedFeedback(item.issue, nextTimeTexts),
    evidence: removeRepeatedFeedback(item.evidence, nextTimeTexts),
  }))
  const hasFeedback = Boolean(visibleFeedbackSummary || visibleImprovementDetails.some((item) => item.issue || item.evidence))
  const hasNextTime = nextTime.steps.length > 0 || nextTime.examples.length > 0

  return (
    <div
      className={`question-card-wrap ${
        expanded ? 'expanded' : ''
      }`}
    >
      <div
        className="question-card"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={toggle}
        onKeyDown={handleKeyDown}
      >
        <span className="question-number">{number}:</span>

        <span className="question-text">
          {question}
        </span>

        <span
          className={`assessment-pill ${
            label === 'Needs Improvement'
              ? 'needs-work'
              : ''
          }`}
        >
          {label}
        </span>

        <span
          className={`question-chevron ${
            expanded ? 'open' : ''
          }`}
        >
          <Icon name="chevron" size={17} />
        </span>
      </div>

      {expanded && (
        <div className="inline-detail">
          {(typeof detail?.answer === 'string' && detail.answer.trim()) && (
            <div className="detail-section answer-section">
              <div className="eyebrow">YOUR ANSWER</div>
              <p>{detail.answer}</p>
            </div>
          )}

          {(hasFeedback || hasNextTime) && (
            <section className="ai-feedback detail-section">
              {hasFeedback && (
                <div className="ai-feedback-part">
                  <h3>OVERALL FEEDBACK</h3>
                  {visibleFeedbackSummary && <div className="feedback-prose"><ReactMarkdown remarkPlugins={[remarkGfm]}>{visibleFeedbackSummary}</ReactMarkdown></div>}
                  {visibleImprovementDetails.filter((item) => item.issue || item.evidence).map((item, index) => (
                    <p className="feedback-evidence" key={`${item.issue}-${index}`}>
                      <strong>{combineIssueAndEvidence(item.issue, item.evidence)}</strong>
                    </p>
                  ))}
                </div>
              )}

              {hasNextTime && (
                <div className="ai-feedback-part next-time">
                  <h3>NEXT TIME</h3>
                  {nextTime.steps.map((step, index) => (
                    <div className="feedback-prose next-time-copy" key={`next-step-${index}`}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{step}</ReactMarkdown>
                    </div>
                  ))}
                  {nextTime.examples.map((example, index) => (
                    <div className="reference-example" key={`next-example-${index}`}>
                      <strong>Reference example — adapt to your real experience</strong>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{example}</ReactMarkdown>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {dimensionItems.length > 0 && (
            <details className="dimensions-disclosure">
              <summary>Dimensions</summary>
              <div className="dimension-grid">
                {dimensionItems.map(({ name, assessment, explanation }) => (
                  <div className="dimension" key={name}>
                    <span>{name}</span>
                    {assessment && <strong className={assessment === 'Needs Improvement' ? 'dim-needs' : ''}>{assessment}</strong>}
                    {explanation && <p>{explanation}</p>}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

type CoachMessage = { role: 'user' | 'assistant'; content: string; error?: boolean }

function trimCoachHistory(messages: CoachMessage[]) {
  const maxChars = 8000
  const recentMessages = messages.filter((message) => !message.error && message.content.trim()).slice(-12)
  const selected: Array<{ role: 'user' | 'assistant'; content: string }> = []
  let remaining = maxChars

  for (const message of [...recentMessages].reverse()) {
    if (remaining <= 0) break
    const content = message.content.length > remaining
      ? message.content.slice(-remaining)
      : message.content
    selected.push({ role: message.role, content })
    remaining -= content.length
  }

  return selected.reverse()
}

function CoachBar({ reference, interviewData, open, onOpenChange }: { reference: string; interviewData: any; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState<CoachMessage[]>([])
  const [loading, setLoading] = useState(false)
  const messagesContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) scrollContainerToBottom(messagesContainerRef.current)
  }, [messages, open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const question = prompt.trim()
    if (!question || loading) return
    const history = trimCoachHistory(messages)
    const qaAnalysis = interviewData.analysis?.qa_analysis
    const questionIndex = /^Question (\d+)$/.exec(reference)
    const referenceDetail = questionIndex && Array.isArray(qaAnalysis)
      ? qaAnalysis[Number(questionIndex[1]) - 1]
      : null
    const coachAnalysis = referenceDetail
      ? { reference_detail: referenceDetail }
      : { qa_analysis: Array.isArray(qaAnalysis) ? qaAnalysis : [] }
    setMessages((current) => [...current, { role: 'user', content: question }, { role: 'assistant', content: '' }])
    setPrompt('')
    setLoading(true)

    try {
      const response = await fetch('http://127.0.0.1:8000/api/interviews/coach', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          reference,
          history,
          // A focused question has its full Q&A and feedback in referenceDetail.
          // Whole-interview questions carry the transcript once, separately from analysis.
          transcript: referenceDetail ? '' : interviewData.transcript,
          analysis: coachAnalysis,
        }),
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || '教练暂时无法回答，请稍后重试。')
      }
      if (!response.body) throw new Error('浏览器无法读取流式响应，请重试。')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finished = false
      while (!finished) {
        const { value, done } = await reader.read()
        buffer += decoder.decode(value, { stream: !done })
        let delimiter = /\r?\n\r?\n/.exec(buffer)
        while (delimiter?.index !== undefined) {
          const rawEvent = buffer.slice(0, delimiter.index).replace(/\r/g, '')
          buffer = buffer.slice(delimiter.index + delimiter[0].length)
          const eventName = rawEvent.split('\n').find((line) => line.startsWith('event:'))?.slice(6).trim()
          const dataLine = rawEvent.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n')
          if (dataLine) {
            const payload = JSON.parse(dataLine)
            if (eventName === 'delta') setMessages((current) => current.map((item, index) => index === current.length - 1 ? { ...item, content: item.content + payload.text } : item))
            if (eventName === 'error') throw new Error(payload.message || '生成回答时发生错误，请重试。')
            if (eventName === 'done') finished = true
          }
          delimiter = /\r?\n\r?\n/.exec(buffer)
        }
        if (done) break
      }
      if (!finished) throw new Error('连接中断，回答没有完整生成。请重新提问。')
    } catch (err) {
      console.error('Coach error:', err)
      const errorMessage = err instanceof Error ? err.message : '回答失败，请重试。'
      setMessages((current) => [...current.slice(0, -1), { role: 'assistant', content: errorMessage, error: true }])
    } finally {
      setLoading(false)
    }
  }

  return <>
    {!open && <button className="coach-launch" onClick={() => onOpenChange(true)}><Icon name="spark" size={17}/> Ask AI Coach</button>}
    {open && <><button className="coach-backdrop" aria-label="关闭 AI Coach" onClick={() => onOpenChange(false)}/><aside className="coach-panel" aria-label="AI Coach chat">
      <header className="coach-header"><div><Icon name="spark" size={17}/><strong>AI Coach</strong></div><button className="coach-close" onClick={() => onOpenChange(false)} aria-label="收起 AI Coach">收起</button></header>
      <div className="coach-session-context">{reference ? `围绕 ${reference} 交流` : '基于整场面试分析交流'}</div>
      <div ref={messagesContainerRef} className="coach-messages" aria-live="polite">
        {messages.length === 0 && <div className="coach-empty">你可以询问回答中的亮点、改进方式，或怎样更清楚地组织表达。</div>}
        {messages.map((message, index) => <div key={index} className={`chat-row ${message.role} ${message.error ? 'chat-error' : ''}`}>
          <div className="chat-bubble">{message.role === 'assistant' ? <><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>{loading && index === messages.length - 1 && <span className="typing-cursor"/>}{message.error && <button className="retry-message" onClick={() => setPrompt(messages[index - 1]?.content || '')}>重试此问题</button>}</> : message.content}</div>
        </div>)}
      </div>
      <form className="coach-composer" onSubmit={handleSubmit}>
        <textarea aria-label="向 AI Coach 提问" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }} placeholder="Ask anything about your interview..." />
        <div className="composer-footer"><small>Enter 发送 · Shift + Enter 换行</small><button aria-label="发送消息" type="submit" disabled={!prompt.trim() || loading}>{loading ? <span className="spinner"/> : <Icon name="chevron" size={17}/>}</button></div>
      </form>
    </aside></>}
  </>
}

function NotFound() { return <div className="not-found"><h1>Interview workspace</h1><p>This sample page is not available.</p><Link to="/">Back to workspace</Link></div> }

function App() { return <Shell><Routes><Route path="/" element={<Home/>}/><Route path="/upload" element={<Upload/>}/><Route path="/processing" element={<Processing/>}/><Route path="/interview/:id" element={<Overview/>}/><Route path="*" element={<NotFound/>}/></Routes></Shell> }

export default App
