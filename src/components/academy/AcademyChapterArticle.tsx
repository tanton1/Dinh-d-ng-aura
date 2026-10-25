import { useId } from 'react'
import ReactMarkdown from 'react-markdown'
import type { CourseLessonDraft } from '../../types'
import './academy-chapter-article.css'

/** Render the delivered chapter verbatim, without injecting legacy guide content. */
export default function AcademyChapterArticle({ lesson }: { lesson: CourseLessonDraft }) {
  const prefix = useId()
  const body = lesson.primaryContent?.kind === 'rich-text' ? lesson.primaryContent.body ?? '' : ''
  const sections = body.split('\n').flatMap((line, index) => /^##\s+/.test(line)
    ? [{ title: line.replace(/^##\s+/, ''), line: index + 1 }] : [])
  const headingId = (line?: number) => `${prefix}-section-${line ?? 'unknown'}`
  return <article className="academy-chapter-article" aria-label="Bài đọc đầy đủ của chương">
    <header><h3>{lesson.title}</h3>{lesson.summary ? <p>{lesson.summary}</p> : null}</header>
    {sections.length ? <nav aria-label="Mục lục bài đọc"><strong>Trong bài này</strong><ul>
      {sections.map((section) => <li key={section.line}><a href={`#${headingId(section.line)}`} onClick={(event) => {
        // App navigation uses the URL hash; do not replace the course route.
        event.preventDefault()
        const heading = document.getElementById(headingId(section.line))
        heading?.focus({ preventScroll: true }); heading?.scrollIntoView({ block: 'start' })
      }}>{section.title}</a></li>)}
    </ul></nav> : null}
    <div className="academy-chapter-article__body"><ReactMarkdown components={{
      h1: () => null,
      h2: ({ children, node }) => <h4 tabIndex={-1} id={headingId(node?.position?.start.line)}>{children}</h4>,
      h3: ({ children }) => <h5>{children}</h5>,
      h4: ({ children }) => <h6>{children}</h6>,
      a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
    }}>{body}</ReactMarkdown></div>
  </article>
}
