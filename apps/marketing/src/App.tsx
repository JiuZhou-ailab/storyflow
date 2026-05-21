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
  Layers3,
  MessagesSquare,
  PenLine,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { downloadBaseUrl, downloadOptions, updateManifestUrls } from "./downloads";

const capabilities = [
  {
    title: "写作工作台",
    body: "围绕章节、大纲、状态和素材文件组织长篇项目，在同一个界面里起草、修订、对比和导出。",
    icon: BookOpenText,
  },
  {
    title: "有记忆的 Agent 会话",
    body: "把本地工作区、权限、来源、技能和会话历史交给 Agent，让多轮写作与开发任务保持上下文。",
    icon: MessagesSquare,
  },
  {
    title: "落稿前审阅",
    body: "所有生成改动都以可读 diff 呈现，作者保留最终控制权，并为长任务保存本地版本快照。",
    icon: GitBranch,
  },
];

const workflow = [
  "从方法包创建写作项目。",
  "接入草稿、笔记、参考资料和本地文件夹。",
  "让 Agent 在来源约束下定向修订。",
  "逐行审阅改动，再写入项目。",
];

const integrations = [
  "Claude Agent SDK",
  "OpenAI API",
  "GitHub Copilot",
  "Google AI Studio",
  "MCP 来源",
  "本地文件",
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
    <div className="product-frame" aria-label="Storyflow 工作区预览">
      <div className="window-bar">
        <div className="traffic-lights">
          <i />
          <i />
          <i />
        </div>
        <span>Storyflow / 长篇创作工作区</span>
      </div>
      <div className="workspace">
        <aside className="workspace-nav">
          <p>草稿</p>
          <strong>灯塔章节</strong>
          <strong className="muted">人物台账</strong>
          <strong className="muted">时间线笔记</strong>
          <div className="nav-rule" />
          <p>Agent</p>
          <strong className="active">行文编辑</strong>
          <strong className="muted">连续性审查</strong>
        </aside>
        <main className="editor-pane">
          <div className="editor-meta">
            <span>第 04 章</span>
            <span>2,418 字</span>
            <span>等待审阅</span>
          </div>
          <h2>房间仍记得那场雨。</h2>
          <p>
            玛拉删掉那句话，又把它恢复。Agent 找到了连续性断点，但句子的节奏仍由她决定。
          </p>
          <p>
            Storyflow 把素材注记固定在页边：灯塔钥匙已在第 19 页前出现，守塔人的身份暂不揭示。
          </p>
          <div className="change-strip">
            <span>
              <Check size={15} />
              已接受 3 处改动
            </span>
            <span>1 条来源注记待处理</span>
          </div>
        </main>
        <aside className="review-pane">
          <div>
            <FileText size={16} />
            <span>行内审阅</span>
          </div>
          <p>保留这个意象。在下一次揭示之前，补强事件之间的因果桥。</p>
          <button type="button">应用改动</button>
        </aside>
      </div>
    </div>
  );
}

export function App() {
  return (
    <div className="site-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Storyflow 首页">
          <LogoMark />
          <span>Storyflow</span>
        </a>
        <nav aria-label="主导航">
          <a href="#workspace">工作区</a>
          <a href="#flow">工作流</a>
          <a href="#downloads">下载</a>
        </nav>
      </header>

      <main id="top">
        <section className="hero-section">
          <ProductFrame />
          <div className="hero-copy">
            <div className="eyebrow">
              <Sparkles size={16} />
              为长篇创作而生的桌面 AI 工作区
            </div>
            <h1>Storyflow</h1>
            <p className="hero-lede">
              本地优先的写作与 Agent 工作台。起草、修订、审阅、交付复杂项目，同时保留对文本的最终控制。
            </p>
            <div className="hero-actions">
              <a className="primary-action" href="#downloads">
                下载 Storyflow
                <ArrowRight size={18} />
              </a>
              <a className="secondary-action" href={updateManifestUrls.macOS}>
                查看更新清单
                <ChevronRight size={17} />
              </a>
            </div>
          </div>
        </section>

        <section className="trust-strip" aria-label="发布状态">
          <span>
            <ShieldCheck size={16} />
            macOS 签名发布链路
          </span>
          <span>Apple Silicon 与 Intel 双架构</span>
          <span>公开下载与自动更新</span>
        </section>

        <section className="section-block" id="workspace">
          <div className="section-kicker">产品定位</div>
          <div className="section-heading">
            <h2>把草稿、上下文、Agent 协作和审阅放在同一张桌面上。</h2>
            <p>
              Storyflow 让写作项目贴近本地文件系统，同时为 Agent 提供足够结构，使它们能做定向改稿，而不是给出松散建议。
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

        <section className="flow-section" id="flow">
          <div className="flow-copy">
            <div className="section-kicker">工作流</div>
            <h2>为 AI 时代仍需要判断力的部分而设计。</h2>
            <p>
              界面围绕素材、工作区状态、明确的方法包和可审阅改动组织。Agent 可以快速推进，作者始终握住最后的落笔权。
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

        <section className="integrations-section" aria-label="支持的集成">
          <div>
            <Layers3 size={22} />
            <h2>接入你自己的工具栈。</h2>
          </div>
          <div className="integration-list">
            {integrations.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </section>

        <section className="download-section" id="downloads">
          <div className="download-copy">
            <div className="section-kicker">下载</div>
            <h2>安装桌面版 Storyflow。</h2>
            <p>
              macOS 需要 12.0 或更高版本。M 系列 Mac 使用 Apple Silicon 版，较早的 Intel Mac 使用 Intel 版。
            </p>
          </div>
          <DownloadButtons compact />
          <div className="release-links">
            <a href={downloadBaseUrl}>
              完整下载列表
              <ChevronRight size={16} />
            </a>
            <a href={updateManifestUrls.macOS}>
              macOS 更新清单
              <ChevronRight size={16} />
            </a>
            <a href={updateManifestUrls.Windows}>
              Windows 更新清单
              <ChevronRight size={16} />
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
          为创作者、开发者和团队准备的桌面 AI 工作区。需要的是可审阅、可编辑、可落地的产出，而不是一次性聊天。
        </p>
        <a href={downloadBaseUrl}>
          <PenLine size={16} />
          下载目录
        </a>
      </footer>
    </div>
  );
}
