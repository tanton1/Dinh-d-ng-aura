import { test } from 'node:test'
import assert from 'node:assert/strict'
import { importPreviewHasErrors, parseNotebookLmFiles } from '../src/services/courseNotebookLmImportService'

test('parses NotebookLM flashcards, quiz and media into a preview', async () => {
  const preview = await parseNotebookLmFiles([
    new File([JSON.stringify({ chapterTitle: 'Chương 1', lessonTitle: 'Calo' })], 'manifest.json', { type: 'application/json' }),
    new File(['front,back,hint\nProtein,Chất đạm,Nhóm chất'], 'flashcards.csv', { type: 'text/csv' }),
    new File([JSON.stringify({ questions: [{ question: '2 + 2?', options: ['3', '4'], correctIndex: 1, explanation: 'Bốn.' }] })], 'quiz.json', { type: 'application/json' }),
    new File(['pdf'], 'slides.pdf', { type: 'application/pdf' }),
    new File(['video'], 'overview.mp4', { type: 'video/mp4' }),
  ])
  assert.equal(preview.counts.flashcards, 1)
  assert.equal(preview.counts.quizQuestions, 1)
  assert.equal(preview.counts.media, 2)
  assert.equal(importPreviewHasErrors(preview), false)
})

test('reports malformed rows instead of silently importing them', async () => {
  const preview = await parseNotebookLmFiles([
    new File(['front,back\nOnly front,'], 'flashcards.csv', { type: 'text/csv' }),
    new File(['{"questions":[{"question":"Missing options"}]}'], 'quiz.json', { type: 'application/json' }),
  ])
  assert.equal(importPreviewHasErrors(preview), true)
  assert.ok(preview.issues.some((issue) => issue.file === 'flashcards.csv' && issue.row === 2))
  assert.ok(preview.issues.some((issue) => issue.file === 'quiz.json' && issue.row === 1))
})

test('accepts Vietnamese aliases and matches correctAnswer text', async () => {
  const preview = await parseNotebookLmFiles([
    new File(['Mặt trước,Mặt sau,Gợi ý\nCalo,Năng lượng,Ghi nhớ'], 'cards.csv', { type: 'text/csv' }),
    new File([JSON.stringify([{ question: 'Mục tiêu?', options: ['A', 'B'], correctAnswer: 'B' }])], 'questions.json', { type: 'application/json' }),
  ])
  assert.equal(preview.flashcards[0].front, 'Calo')
  assert.equal(preview.quizQuestions[0].correctIndex, 1)
})

test('accepts a NotebookLM video URL export without treating it as a local upload', async () => {
  const preview = await parseNotebookLmFiles([
    new File(['https://notebooklm.google.com/notebook/example'], 'video-url.txt', { type: 'text/plain' }),
  ])
  assert.equal(importPreviewHasErrors(preview), false)
  assert.equal(preview.media[0].kind, 'video')
  assert.equal(preview.media[0].file, undefined)
  assert.match(preview.media[0].url ?? '', /^https:\/\//)
})

test('a manifest without learning content cannot create an empty lesson', async () => {
  const preview = await parseNotebookLmFiles([
    new File(['{"lessonTitle":"Empty"}'], 'manifest.json', { type: 'application/json' }),
  ])
  assert.equal(importPreviewHasErrors(preview), true)
  assert.match(preview.issues.at(-1)?.message ?? '', /Chưa tìm thấy/)
})
