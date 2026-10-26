export type InterviewStatus = 'transcribed' | 'analyzing' | 'analyzed' | 'analysis_failed' | 'transcription_failed'

export interface InterviewAnalysis {
  qa_analysis?: unknown[]
  overall_assessment?: string
  overall_summary?: string
  overall_summary_points?: unknown[]
  [key: string]: unknown
}

export interface Interview {
  id: string
  filename?: string
  role: string
  round: string
  company: string
  jd?: string
  transcript: string
  analysis?: InterviewAnalysis
  status: InterviewStatus
  error?: string
  createdAt: string
  updatedAt: string
}

export interface CoachMessage {
  id: string
  interviewId: string
  role: 'user' | 'assistant'
  content: string
  error?: boolean
  incomplete?: boolean
  createdAt: string
}
