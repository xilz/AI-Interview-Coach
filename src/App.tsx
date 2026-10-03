import { useState, type KeyboardEvent, type ReactNode } from 'react'
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
  return <div className="form-page"><div className="breadcrumbs"><Link to="/">Workspace</Link><Icon name="chevron" size={14}/><span>New interview</span></div><div className="form-heading"><div className="eyebrow">INTERVIEW REVIEW</div><h1>Upload an interview</h1><p>Add a recording and a little context to get started.</p></div>
    <form className="upload-form" onSubmit={(e) => { e.preventDefault(); navigate('/processing') }}>
      <div className="field-block"><label>Interview recording <span className="required">Required</span></label><label className={`dropzone ${file ? 'has-file' : ''}`}><input type="file" accept="audio/*,video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)}/>{file ? <><span className="file-icon"><Icon name="upload"/></span><span className="file-info"><strong>{file.name}</strong><small>{(file.size / (1024 * 1024)).toFixed(1)} MB · Ready to analyze</small></span><span className="change-file">Change</span></> : <><span className="upload-icon"><Icon name="upload" size={20}/></span><span><strong>Choose a file or drag it here</strong><small>MP3, WAV, M4A, MP4 · Up to 500 MB</small></span></>}</label></div>
      <div className="field-row"><div className="field-block"><label htmlFor="position">Position <span className="required">Required</span></label><select id="position" value={role} onChange={(e) => setRole(e.target.value)} required><option value="" disabled>Select a position</option><option>AI Product Manager</option><option>Software Engineer</option><option>Data Analyst</option><option>Other</option></select></div><div className="field-block"><label htmlFor="round">Interview round <span className="required">Required</span></label><select id="round" value={round} onChange={(e) => setRound(e.target.value)} required><option value="" disabled>Select a round</option>{['Round 1', 'Round 2', 'Final Round', 'HR Interview', 'Technical Interview', 'Case Interview'].map(x => <option key={x}>{x}</option>)}</select></div></div>
      <div className="field-block"><label htmlFor="company">Company <span className="optional">Optional</span></label><input id="company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Acme"/></div>
      <div className="field-block"><label htmlFor="jd">Job description <span className="optional">Optional</span></label><textarea id="jd" rows={4} placeholder="Paste the job description to give your interview review more context."/><small className="field-help">Used as context for your interview review.</small></div>
      <div className="form-actions"><button type="button" className="secondary-button" onClick={() => navigate('/')}>Cancel</button><button className="primary-button" type="submit" disabled={!file || !role || !round}>Start analysis <Icon name="chevron" size={16}/></button></div>
    </form>
  </div>
}

function Processing() { return <div className="processing-view"><div className="processing-icon"><Icon name="spark" size={24}/></div><h1>Preparing your interview review</h1><p>This usually takes a few minutes. You can stay here while we work.</p><div className="processing-steps">{['Processing audio', 'Generating transcript', 'Identifying questions and answers', 'Analyzing interview responses', 'Preparing interview review'].map((step, i) => <div key={step} className={`processing-step ${i === 0 ? 'active' : ''}`}><span className="step-indicator">{i === 0 ? <span className="spinner"/> : i + 1}</span><span>{step}</span>{i === 0 && <small>In progress</small>}</div>)}</div><Link to="/interview/demo" className="mock-link">Preview a sample interview review <Icon name="chevron" size={14}/></Link></div> }

function Overview() {
  const [coachReference, setCoachReference] = useState('')
  return <div className="overview-view"><div className="breadcrumbs"><Link to="/">Workspace</Link><Icon name="chevron" size={14}/><span>Interview review</span></div><div className="overview-header"><div><div className="eyebrow">INTERVIEW REVIEW</div><h1>AI Product Manager</h1><p>Round 1 <span>·</span> Northstar AI</p></div><div className="overview-date">Sep 28, 2026</div></div><section className="assessment"><div className="assessment-label"><span className="assessment-dot"/> OVERALL ASSESSMENT <span className="qualitative">Good</span></div><p>Your overall performance was good. You demonstrated a clear understanding of your project experience, but some answers could be more structured and specific.</p></section><div className="strength-grid"><section className="strength-card"><h2>What Went Well</h2><ul><li>Connected your experience to the role’s core responsibilities.</li><li>Shared clear examples from previous projects.</li></ul></section><section className="strength-card"><h2>Areas to Improve</h2><ul><li>Make outcomes and impact more specific.</li><li>Use a clearer structure for open-ended questions.</li></ul></section></div><section className="questions-section"><div className="section-heading"><div><div className="eyebrow">YOUR CONVERSATION</div><h2>Interview Questions</h2></div><span className="question-count">3 questions</span></div><div className="question-list">{[
      ['Q1', 'Tell me about your previous project.', 'Good'], ['Q2', 'Why do you want to become an AI Product Manager?', 'Good'], ['Q3', 'How would you improve this product?', 'Needs Improvement'],
    ].map(([number, question, label]) => <QuestionCard key={number} number={number} question={question} label={label} onToggle={(expanded) => setCoachReference(expanded ? number : '')}/>)}</div></section><CoachBar reference={coachReference ? `Question ${coachReference.slice(1)}` : ''}/>
  </div> }

const questionDetails: Record<string, { answer: string; analysis: string; strengths: string; improvements: string; suggestion: string; dimensions: string[] }> = {
  Q1: { answer: '“In my last role, I led a redesign of our onboarding flow. We noticed many new users did not reach their first successful workflow, so I partnered with design and engineering to simplify setup and add clearer guidance. Activation improved after launch, and we kept iterating based on support feedback.”', analysis: 'You gave a relevant example and explained the problem, your contribution, and the outcome. Adding a concrete measure of the change would make the impact more specific.', strengths: 'Clear ownership and a relevant project example; you connected the work to a user problem.', improvements: 'Quantify the activation change and briefly explain how you measured it.', suggestion: 'Keep the problem → action → result structure, and include one measurable outcome if available.', dimensions: ['Good', 'Good', 'Good', 'Good', 'Good'] },
  Q2: { answer: '“I enjoy working at the intersection of user needs and technology. In my previous projects I often helped translate customer feedback into product decisions, and I’d like to do more of that with AI products. I’m especially interested in making complex capabilities useful and understandable to people.”', analysis: 'Your motivation is relevant and communicates a thoughtful interest in the role. The answer would be more memorable with a specific example that connects your experience to this company or product.', strengths: 'Communicated a clear reason for moving into AI product management and connected it to prior work.', improvements: 'Support your motivation with a concrete example and a more specific connection to the role.', suggestion: 'Name one experience that sparked your interest, then connect it to the kind of product challenge in this role.', dimensions: ['Good', 'Good', 'Needs Improvement', 'Good', 'Good'] },
  Q3: { answer: '“I think I would make the onboarding better and add more AI features so users can get more value. I’d probably talk to users and see what they need.”', analysis: 'Your answer identifies relevant directions, but stays at a high level. A concrete user need and a clear prioritization rationale would make your thinking easier to follow.', strengths: 'Recognized onboarding as a potential source of user friction.', improvements: 'Define the user problem before suggesting a solution.', suggestion: 'Describe one specific user segment, the obstacle they face, and how you would validate which improvement matters most.', dimensions: ['Good', 'Good', 'Needs Improvement', 'Needs Improvement', 'Good'] },
}

function QuestionCard({ number, question, label, onToggle }: { number: string; question: string; label: string; onToggle: (expanded: boolean) => void }) {
  const [expanded, setExpanded] = useState(false)
  const detail = questionDetails[number]
  const toggle = () => { const nextExpanded = !expanded; setExpanded(nextExpanded); onToggle(nextExpanded) }
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle() }
  }
  return <div className={`question-card-wrap ${expanded ? 'expanded' : ''}`}>
    <div className="question-card" role="button" tabIndex={0} aria-expanded={expanded} onClick={toggle} onKeyDown={handleKeyDown}><span className="question-number">{number}</span><span className="question-text">{question}</span><span className={`assessment-pill ${label === 'Needs Improvement' ? 'needs-work' : ''}`}>{label}</span><span className={`question-chevron ${expanded ? 'open' : ''}`}><Icon name="chevron" size={17}/></span></div>
    {expanded && <div className="inline-detail"><div className="detail-section"><div className="eyebrow">YOUR ANSWER</div><p>{detail.answer}</p></div><div className="detail-section"><div className="eyebrow">AI ANALYSIS</div><p>{detail.analysis}</p><div className="dimension-grid">{['Relevance', 'Structure', 'Specificity', 'Depth', 'Communication'].map((dimension, i) => <div className="dimension" key={dimension}><span>{dimension}</span><strong className={detail.dimensions[i] === 'Needs Improvement' ? 'dim-needs' : ''}>{detail.dimensions[i]}</strong></div>)}</div></div><div className="detail-columns"><div><h3>What Went Well</h3><p>{detail.strengths}</p></div><div><h3>Areas to Improve</h3><p>{detail.improvements}</p></div></div><div className="suggestion"><strong>Try this next time</strong><p>{detail.suggestion}</p></div></div>}
  </div>
}

function CoachBar({ reference }: { reference: string }) { const [prompt, setPrompt] = useState(''); const [sent, setSent] = useState(false); return <div className="coach-wrap"><div className="coach-context"><Icon name="spark" size={15}/><span>AI Coach</span><small>{reference ? `Reference: ${reference}` : 'Ask about your interview'}</small></div>{sent && <div className="coach-response">That’s a useful question. Start by naming the user and the specific problem you observed, then explain how you would compare possible improvements.</div>}<form className="coach-input" onSubmit={(e) => { e.preventDefault(); if (prompt.trim()) { setSent(true); setPrompt('') } }}><input aria-label="Ask the AI Coach" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={reference ? `Ask about ${reference.toLowerCase()}...` : 'Ask anything about your interview...'} /><button aria-label="Send to AI Coach" type="submit" disabled={!prompt.trim()}><Icon name="chevron" size={17}/></button></form></div> }

function NotFound() { return <div className="not-found"><h1>Interview workspace</h1><p>This sample page is not available.</p><Link to="/">Back to workspace</Link></div> }

function App() { return <Shell><Routes><Route path="/" element={<Home/>}/><Route path="/upload" element={<Upload/>}/><Route path="/processing" element={<Processing/>}/><Route path="/interview/:id" element={<Overview/>}/><Route path="*" element={<NotFound/>}/></Routes></Shell> }

export default App
