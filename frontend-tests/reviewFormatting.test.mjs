import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { combineIssueAndEvidence, getNextTimeContent, getSummaryPoints, removeRepeatedFeedback } from '../src/reviewFormatting.ts'
import { scrollContainerToBottom } from '../src/coachScroll.ts'

test('NEXT TIME omits duplicate new and legacy suggestion values', () => {
  const result = getNextTimeContent([
    { next_step: '先说目标，再说明行动。' },
    { next_step: '先说目标，再说明行动。' },
    { next_step: '最后补充实际结果。' },
  ], '先说目标，再说明行动。 最后补充实际结果。')
  assert.deepEqual(result.steps, ['先说目标，再说明行动。', '最后补充实际结果。'])
})

test('NEXT TIME retains different legacy advice instead of dropping it', () => {
  const result = getNextTimeContent([{ next_step: '补充实际结果。' }], '另外说明你如何验证结果。')
  assert.deepEqual(result.steps, ['补充实际结果。', '另外说明你如何验证结果。'])
})

test('OVERALL FEEDBACK removes exact duplicate NEXT TIME paragraphs only', () => {
  assert.equal(removeRepeatedFeedback('补充实际结果。', ['补充实际结果。']), '')
  assert.equal(
    removeRepeatedFeedback('回答缺少结果，因此影响判断。\n\n补充实际结果。', ['补充实际结果。']),
    '回答缺少结果，因此影响判断。',
  )
  assert.equal(removeRepeatedFeedback('把影响说清楚。', ['补充实际结果。']), '把影响说清楚。')
})

test('issue evidence is integrated without a separate Evidence label or duplicated phrase', () => {
  assert.equal(combineIssueAndEvidence('归因错误，混淆概念', '认为 delay 为 0 所以不阻塞。'), '归因错误，混淆概念：认为 delay 为 0 所以不阻塞。')
  assert.equal(combineIssueAndEvidence('该回答认为 delay 为 0 所以不阻塞。', '认为 delay 为 0 所以不阻塞。'), '该回答认为 delay 为 0 所以不阻塞。')
  assert.equal(combineIssueAndEvidence('结果不足', '结果'), '结果不足：结果')
})

test('Coach streaming scroll updates only its own message container', () => {
  const messageContainer = { scrollTop: 10, scrollHeight: 900 }
  const mainPage = { scrollTop: 420 }
  scrollContainerToBottom(messageContainer)
  assert.equal(messageContainer.scrollTop, 900)
  assert.equal(mainPage.scrollTop, 420)
  assert.equal(scrollContainerToBottom(null), undefined)
})

test('Processing keeps the historical five independent progress labels', async () => {
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  for (const label of [
    'Processing audio', 'Generating transcript', 'Identifying questions and answers',
    'Analyzing interview responses', 'Preparing interview review',
  ]) assert.match(source, new RegExp(label))
  assert.match(source, /progressState === 'analyzing' \? index === 2 \|\| index === 3/)
})

test('summary points use structured output and old strings remain one intact point', () => {
  assert.deepEqual(getSummaryPoints([
    { title: '结构', detail: '多个回答组织顺序清楚。' },
    { title: '结果', detail: '多次缺少行动后的结果。' },
    { title: '', detail: '   ' },
  ], 'ignored legacy summary'), [
    { title: '结构', detail: '多个回答组织顺序清楚。' },
    { title: '结果', detail: '多次缺少行动后的结果。' },
  ])
  assert.deepEqual(getSummaryPoints(undefined, '旧版整段总结。'), [{ title: '', detail: '旧版整段总结。' }])
})

test('empty summary points do not render empty bullets; feedback typography is shared on mobile', async () => {
  assert.deepEqual(getSummaryPoints([], ''), [])
  const css = await readFile(new URL('../src/App.css', import.meta.url), 'utf8')
  const rootCss = await readFile(new URL('../src/index.css', import.meta.url), 'utf8')
  assert.match(css, /\.feedback-prose,\.feedback-evidence\s*\{[^}]*font-size:var\(--review-body-size\)[^}]*font-weight:400/s)
  assert.match(rootCss, /--review-body-size:\s*14px/)
  const mobileRules = [...css.matchAll(/@media\s*\([^)]*\)\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)].map((match) => match[1])
  assert.equal(mobileRules.some((rule) => /\.feedback-prose|\.feedback-evidence/.test(rule)), false)
})
