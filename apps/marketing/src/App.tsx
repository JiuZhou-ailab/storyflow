// input: Download metadata and static product positioning
// output: Storyflow public landing page
// pos: Primary React surface for the marketing site

import {
  ArrowRight,
  BookOpenText,
  Check,
  ChevronRight,
  Download,
  FileText,
  GitBranch,
  Github,
  Layers3,
  MessagesSquare,
  PenLine,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { downloadOptions, latestReleaseUrl, repositoryUrl } from "./downloads";

const capabilities = [
  {
    title: "Writing workspace",
    body: "Draft, revise, compare, and export manuscripts from a project surface built around chapters, outlines, states, and source files.",
    icon: BookOpenText,
  },
  {
    title: "Agent sessions with memory",
    body: "Run multi-turn coding and writing work with local workspace context, permissions, sources, skills, and durable session history.",
    icon: MessagesSquare,
  },
  {
    title: "Review before merge",
    body: "Inspect generated edits as readable diffs, keep author control, and preserve local version snapshots for long-running work.",
    icon: GitBranch,
  },
];

const workflow = [
  "Create a writing project from a method pack.",
  "Attach drafts, notes, references, and local folders.",
  "Ask agents to revise with source-aware constraints.",
  "Review every changed line before it lands.",
];

const integrations = [
  "Claude Agent SDK",
  "OpenAI API",
  "GitHub Copilot",
  "Google AI Studio",
  "MCP sources",
  "Local files",
];

function LogoMark() {
  return (
    <svg aria-hidden="true" className="logo-mark" viewBox="0 0 299 300" role="img">
      <path d="M137.879 300.001h-.004C62.324 300.001.966 239.232.012 163.908L0 162.126h137.879v137.875Z" />
      <path d="M137.879 0h-.004C61.729 0 0 61.729 0 137.875v.003h137.879V0Z" />
      <path d="M160.558 137.883h.003c76.146 0 137.875-61.729 137.875-137.875V.006H160.558v137.877Z" />
      <path d="M160.558 162.123h.003c75.551 0 136.91 60.768 137.865 136.093l.01 1.782H160.558V162.123Z" />
    </svg>
  );
}

function DownloadButtons({ compact = false }: { compact?: boolean }) {
  const primaryDownloads = downloadOptions.filter((option) => option.platform === "macOS");

  return (
    <div className={compact ? "download-grid compact" : "download-grid"}>
      {primaryDownloads.map((option) => (
        <a className="download-card" href={option.href} key={option.id}>
          <span>
            <Download size={18} strokeWidth={1.8} />
          </span>
          <strong>{option.label}</strong>
          <small>{option.detail}</small>
        </a>
      ))}
      <a className="download-card secondary" href={downloadOptions[2].href}>
        <span>
          <Download size={18} strokeWidth={1.8} />
        </span>
        <strong>{downloadOptions[2].label}</strong>
        <small>{downloadOptions[2].detail}</small>
      </a>
    </div>
  );
}

function ProductFrame() {
  return (
    <div className="product-frame" aria-label="Storyflow workspace preview">
      <div className="window-bar">
        <div className="traffic-lights">
          <i />
          <i />
          <i />
        </div>
        <span>Storyflow / Manuscript Workspace</span>
      </div>
      <div className="workspace">
        <aside className="workspace-nav">
          <p>Drafts</p>
          <strong>The lighthouse chapter</strong>
          <strong className="muted">Character ledger</strong>
          <strong className="muted">Timeline notes</strong>
          <div className="nav-rule" />
          <p>Agents</p>
          <strong className="active">Line editor</strong>
          <strong className="muted">Continuity audit</strong>
        </aside>
        <main className="editor-pane">
          <div className="editor-meta">
            <span>Chapter 04</span>
            <span>2,418 words</span>
            <span>review ready</span>
          </div>
          <h2>The room had remembered the rain.</h2>
          <p>
            Mara crossed out the sentence, then restored it. The agent had found the
            continuity break, but the rhythm was hers to keep.
          </p>
          <p>
            In the margin, Storyflow held the note open beside the draft: lighthouse key
            introduced before page 19; do not reveal the keeper yet.
          </p>
          <div className="change-strip">
            <span>
              <Check size={15} />
              3 edits accepted
            </span>
            <span>1 unresolved source note</span>
          </div>
        </main>
        <aside className="review-pane">
          <div>
            <FileText size={16} />
            <span>Inline review</span>
          </div>
          <p>Keep the image. Tighten the causal bridge before the next reveal.</p>
          <button type="button">Apply edit</button>
        </aside>
      </div>
    </div>
  );
}

export function App() {
  return (
    <div className="site-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Storyflow home">
          <LogoMark />
          <span>Storyflow</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#workspace">Workspace</a>
          <a href="#downloads">Download</a>
          <a href={repositoryUrl}>GitHub</a>
        </nav>
      </header>

      <main id="top">
        <section className="hero-section">
          <ProductFrame />
          <div className="hero-copy">
            <div className="eyebrow">
              <Sparkles size={16} />
              Native desktop AI workspace for long-form work
            </div>
            <h1>Storyflow</h1>
            <p className="hero-lede">
              A local-first writing and agent workspace for drafting, revising, reviewing,
              and shipping complex projects without losing control of the text.
            </p>
            <div className="hero-actions">
              <a className="primary-action" href="#downloads">
                Download Storyflow
                <ArrowRight size={18} />
              </a>
              <a className="secondary-action" href={latestReleaseUrl}>
                View releases
                <ChevronRight size={17} />
              </a>
            </div>
          </div>
        </section>

        <section className="trust-strip" aria-label="Release status">
          <span>
            <ShieldCheck size={16} />
            Signed macOS release chain
          </span>
          <span>Apple Silicon and Intel builds</span>
          <span>GitHub Releases updater</span>
        </section>

        <section className="section-block" id="workspace">
          <div className="section-kicker">What it is</div>
          <div className="section-heading">
            <h2>One surface for draft, context, agent work, and review.</h2>
            <p>
              Storyflow keeps writing projects close to the filesystem while giving agents
              enough structure to make targeted edits instead of vague suggestions.
            </p>
          </div>
          <div className="capability-grid">
            {capabilities.map((item) => (
              <article className="capability" key={item.title}>
                <item.icon size={22} strokeWidth={1.65} />
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="flow-section">
          <div className="flow-copy">
            <div className="section-kicker">Workflow</div>
            <h2>Built for the parts of AI work that still need judgment.</h2>
            <p>
              The interface is organized around source material, workspace state, explicit
              method packs, and reviewable changes. Agents can move fast; the author keeps
              the final hand on the manuscript.
            </p>
          </div>
          <ol className="workflow-list">
            {workflow.map((item, index) => (
              <li key={item}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                {item}
              </li>
            ))}
          </ol>
        </section>

        <section className="integrations-section" aria-label="Supported integrations">
          <div>
            <Layers3 size={22} />
            <h2>Bring your own stack.</h2>
          </div>
          <div className="integration-list">
            {integrations.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </section>

        <section className="download-section" id="downloads">
          <div className="download-copy">
            <div className="section-kicker">Download</div>
            <h2>Install Storyflow for desktop.</h2>
            <p>
              macOS requires 12.0 or later. Use the Apple Silicon build for M-series Macs
              and the Intel build for older Intel Macs.
            </p>
          </div>
          <DownloadButtons compact />
          <div className="release-links">
            <a href={latestReleaseUrl}>
              Latest release
              <ChevronRight size={16} />
            </a>
            <a href={repositoryUrl}>
              <Github size={16} />
              Source code
            </a>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div>
          <LogoMark />
          <span>Storyflow</span>
        </div>
        <p>
          Desktop AI workspace for writers, builders, and teams who need editable output
          instead of disposable chat.
        </p>
        <a href={repositoryUrl}>
          <PenLine size={16} />
          Open source repository
        </a>
      </footer>
    </div>
  );
}
