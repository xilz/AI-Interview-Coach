import { useState, type KeyboardEvent, type ReactNode, useEffect } from 'react'
import { Link, Route, Routes, useNavigate } from 'react-router-dom'
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

      if (!response.ok) {
        throw new Error('Upload failed')
      }

      const data = await response.json()

      console.log('Upload result:', data)

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

function Processing() {
  const navigate = useNavigate()

  const [currentStep, setCurrentStep] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    const runAnalysis = async () => {
      try {
        const storedData = sessionStorage.getItem('interviewData')

        if (!storedData) {
          throw new Error('Interview data not found')
        }

        const interviewData = JSON.parse(storedData)

        if (!interviewData.transcript) {
          throw new Error('Transcript not found')
        }

        // Step 1: Processing audio
        setCurrentStep(0)
        await new Promise((resolve) => setTimeout(resolve, 500))

        // Step 2: Generating transcript
        setCurrentStep(1)
        await new Promise((resolve) => setTimeout(resolve, 500))

        // Step 3: Identifying questions and answers
        setCurrentStep(2)

        const response = await fetch(
          'http://127.0.0.1:8000/api/interviews/analyze',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              transcript: interviewData.transcript,
            }),
          }
        )

        if (!response.ok) {
          throw new Error('Interview analysis failed')
        }

        const analysisData = await response.json()

        // Step 4: Analyzing interview responses
        setCurrentStep(3)
        await new Promise((resolve) => setTimeout(resolve, 500))

        // Step 5: Preparing interview review
        setCurrentStep(4)

        // Save the real analysis result
        sessionStorage.setItem(
          'interviewAnalysis',
          JSON.stringify({
            ...interviewData,
            analysis: analysisData,
          })
        )

        await new Promise((resolve) => setTimeout(resolve, 500))

        // Go to the interview review page
        navigate('/interview/demo')
      } catch (err) {
        console.error('Analysis error:', err)

        if (err instanceof Error) {
          setError(err.message)
        } else {
          setError('Failed to analyze the interview')
        }
      }
    }

    runAnalysis()
  }, [navigate])

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
        {steps.map((step, i) => {
          const isCompleted = i < currentStep
          const isActive = i === currentStep

          return (
            <div
              key={step}
              className={`processing-step ${
                isActive ? 'active' : ''
              } ${isCompleted ? 'completed' : ''}`}
            >
              <span className="step-indicator">
                {isActive ? (
                  <span className="spinner" />
                ) : isCompleted ? (
                  '✓'
                ) : (
                  i + 1
                )}
              </span>

              <span>{step}</span>

              {isActive && <small>In progress</small>}
            </div>
          )
        })}
      </div>

      {error && (
        <div className="processing-error">
          {error}
        </div>
      )}
    </div>
  )
}

function Overview() {
  const [coachReference, setCoachReference] = useState('')
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

  const qaAnalysis = analysis?.qa_analysis || []

  // Collect strengths and improvement areas from all questions
  const strengths = qaAnalysis.flatMap(
    (item: any) => item.strengths || []
  )

  const improvements = qaAnalysis.flatMap(
    (item: any) => item.areas_to_improve || []
  )

  // Use the overall assessment returned by the AI
  const assessments = qaAnalysis.map(
    (item: any) => item.overall_assessment
  )

  let overallAssessment = 'Good'

  if (assessments.includes('Needs Improvement')) {
    overallAssessment = 'Needs Improvement'
  } else if (
    assessments.length > 0 &&
    assessments.every((item: string) => item === 'Excellent')
  ) {
    overallAssessment = 'Excellent'
  }

  const assessmentText =
    overallAssessment === 'Excellent'
      ? 'Your overall interview performance was strong. Your answers were generally relevant, structured, and specific.'
      : overallAssessment === 'Needs Improvement'
        ? 'Your interview showed some good points, but several answers could be more structured, specific, and detailed.'
        : 'Your overall interview performance was good, but some answers could be more structured and specific.'

  return (
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

        <p>{assessmentText}</p>
      </section>

      <div className="strength-grid">
        <section className="strength-card">
          <h2>What Went Well</h2>

          {strengths.length > 0 ? (
            <ul>
              {strengths.slice(0, 4).map(
                (strength: string, index: number) => (
                  <li key={index}>{strength}</li>
                )
              )}
            </ul>
          ) : (
            <p>No specific strengths were identified.</p>
          )}
        </section>

        <section className="strength-card">
          <h2>Areas to Improve</h2>

          {improvements.length > 0 ? (
            <ul>
              {improvements.slice(0, 4).map(
                (improvement: string, index: number) => (
                  <li key={index}>{improvement}</li>
                )
              )}
            </ul>
          ) : (
            <p>No major improvement areas were identified.</p>
          )}
        </section>
      </div>

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
              label={item.overall_assessment}
              detail={item}
              onToggle={(expanded) =>
                setCoachReference(
                  expanded ? `Q${index + 1}` : ''
                )
              }
            />
          ))}
        </div>
      </section>

      <CoachBar
        reference={
          coachReference
            ? `Question ${coachReference.slice(1)}`
            : ''
        }
      />
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
        <span className="question-number">{number}</span>

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

          <div className="detail-section">
            <div className="eyebrow">YOUR ANSWER</div>

            <p>
              {detail?.answer || 'No answer available.'}
            </p>
          </div>

          <div className="detail-section">
            <div className="eyebrow">AI ANALYSIS</div>

            <p>
              {detail?.analysis || 'No analysis available.'}
            </p>

            <div className="dimension-grid">
              {dimensions.map((dimension) => {
                const value =
                  detail?.dimensions?.[dimension] ||
                  'Good'

                return (
                  <div
                    className="dimension"
                    key={dimension}
                  >
                    <span>{dimension}</span>

                    <strong
                      className={
                        value === 'Needs Improvement'
                          ? 'dim-needs'
                          : ''
                      }
                    >
                      {value}
                    </strong>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="detail-columns">
            <div>
              <h3>What Went Well</h3>

              <ul>
                {(detail?.strengths || []).map(
                  (item: string, index: number) => (
                    <li key={index}>{item}</li>
                  )
                )}
              </ul>
            </div>

            <div>
              <h3>Areas to Improve</h3>

              <ul>
                {(detail?.areas_to_improve || []).map(
                  (item: string, index: number) => (
                    <li key={index}>{item}</li>
                  )
                )}
              </ul>
            </div>
          </div>

          <div className="suggestion">
            <strong>Try this next time</strong>

            <p>
              {detail?.suggested_improvement ||
                'Try to make your answer more specific and structured.'}
            </p>
          </div>

        </div>
      )}
    </div>
  )
}

function CoachBar({ reference }: { reference: string }) {
  const [prompt, setPrompt] = useState('')
  const [response, setResponse] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (
    e: React.FormEvent
  ) => {
    e.preventDefault()

    if (!prompt.trim() || loading) {
      return
    }

    try {
      setLoading(true)
      setResponse('')

      const storedData =
        sessionStorage.getItem('interviewAnalysis')

      if (!storedData) {
        throw new Error(
          'Interview data not found'
        )
      }

      const interviewData = JSON.parse(storedData)

      const response = await fetch(
        'http://127.0.0.1:8000/api/interviews/coach',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            question: prompt,
            reference,
            transcript:
              interviewData.transcript,
            analysis:
              interviewData.analysis,
          }),
        }
      )

      if (!response.ok) {
        throw new Error(
          'AI Coach request failed'
        )
      }

      const data = await response.json()

      setResponse(data.answer || data.response || '')
      setPrompt('')
    } catch (err) {
      console.error('Coach error:', err)

      setResponse(
        'Sorry, I could not answer this question right now.'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="coach-wrap">

      <div className="coach-context">
        <Icon name="spark" size={15} />

        <span>AI Coach</span>

        <small>
          {reference
            ? `Reference: ${reference}`
            : 'Ask about your interview'}
        </small>
      </div>

      {response && (
        <div className="coach-response">
          {response}
        </div>
      )}

      <form
        className="coach-input"
        onSubmit={handleSubmit}
      >
        <input
          aria-label="Ask the AI Coach"
          value={prompt}
          onChange={(e) =>
            setPrompt(e.target.value)
          }
          placeholder={
            reference
              ? `Ask about ${reference.toLowerCase()}...`
              : 'Ask anything about your interview...'
          }
        />

        <button
          aria-label="Send to AI Coach"
          type="submit"
          disabled={!prompt.trim() || loading}
        >
          {loading ? (
            <span className="spinner" />
          ) : (
            <Icon name="chevron" size={17} />
          )}
        </button>
      </form>

    </div>
  )
}

function NotFound() { return <div className="not-found"><h1>Interview workspace</h1><p>This sample page is not available.</p><Link to="/">Back to workspace</Link></div> }

function App() { return <Shell><Routes><Route path="/" element={<Home/>}/><Route path="/upload" element={<Upload/>}/><Route path="/processing" element={<Processing/>}/><Route path="/interview/:id" element={<Overview/>}/><Route path="*" element={<NotFound/>}/></Routes></Shell> }

export default App
