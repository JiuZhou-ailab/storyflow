// input: Storyflow release links, local product screenshots, and promo video
// output: Craft-style Chinese landing page for writers
// pos: React surface for the public marketing route

import { renderMermaidSVG } from "beautiful-mermaid";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { downloadOptions as releaseDownloadOptions } from "./downloads";

const assets = {
  workspace: "/reference-assets/storyflow-workspace-chat.webp",
  promoVideo: "/reference-assets/storyflow-promo-45s.mp4",
  promoPoster: "/reference-assets/storyflow-promo-poster.jpg",
  dataResults: "/reference-assets/storyflow-data-results.webp",
  dataExpanded: "/reference-assets/storyflow-data-expanded.webp",
  skills: "/reference-assets/storyflow-skills-detail.webp",
  reviewDiff: "/reference-assets/storyflow-review-diff.png",
  delivery: "/reference-assets/storyflow-editor.webp",
  versionHistory: "/reference-assets/storyflow-version-history.png",
};

const docsPath = "/docs/";
const landingPath = "/";

type PageTarget = {
  pathname: string;
  hash: string;
};

const faqs = [
  {
    question: "它和普通 AI 聊天窗口有什么区别？",
    answer:
      "普通聊天只保留对话。Storyflow 以真实项目文件为中心：正文、设定、大纲、素材和 Agent 改动都留在同一个桌面项目里。",
  },
  {
    question: "适合哪些创作项目？",
    answer:
      "网文、长篇、短篇和连载，尤其适合需要持续维护人物、设定、时间线和前文状态的项目。",
  },
  {
    question: "Agent 会直接改我的正文吗？",
    answer:
      "会，但只有在允许写入的执行模式中才会操作。修改会写入项目文件，同时保留差异审阅和版本恢复；你可以接受、拒绝或继续调整。",
  },
  {
    question: "大纲、人物、设定能一起管理吗？",
    answer:
      "可以。项目目录原生显示真实文件，你可以按自己的方式组织正文、大纲、人物、设定和素材。",
  },
  {
    question: "可以让它连续写多个章节吗？",
    answer:
      "可以。你可以把章节目标交给 Agent 分步执行；结果写入项目文件，并在会话中保留执行记录。",
  },
  {
    question: "本地项目是否等于离线模型？",
    answer:
      "不等于。作品文件保存在你选择的本地目录；模型请求会发送给你配置的服务商。",
  },
] as const;

const contextSources = [
  { label: "正文", detail: "章节稿" },
  { label: "大纲", detail: "结构线" },
  { label: "人物", detail: "角色动机" },
  { label: "设定", detail: "世界规则" },
  { label: "风格", detail: "语气要求" },
  { label: "素材", detail: "参考资料" },
  { label: "任务", detail: "Agent 计划" },
  { label: "审阅", detail: "文件改动" },
  { label: "总结", detail: "进度记录" },
  { label: "版本", detail: "历史节点" },
] as const;

const sections = {
  workflow: [
    {
      title: "正文是文件",
      body: "Markdown 正文保留行号、字数和清晰路径，始终是项目里的真实作品文件。",
    },
    {
      title: "Agent 在会话中",
      body: "会话负责理解目标、读取项目和执行任务，不需要把作品复制进普通聊天窗口。",
    },
    {
      title: "目录就是项目",
      body: "正文、大纲、人物、设定和素材按真实文件组织，你看到的就是 Agent 使用的内容。",
    },
    {
      title: "改动可审阅",
      body: "Agent 可以直接修改项目文件；每次具体增删都可以接受、拒绝或继续调整。",
    },
  ],
  context: [
    {
      title: "真实文件提供上下文",
      body: "正文、大纲、人物和素材留在项目里，需要时可以直接被会话引用。",
    },
    {
      title: "按章节持续推进",
      body: "把章节目标拆成明确任务，Agent 读取当前项目状态后继续写作或整理。",
    },
    {
      title: "创作过程可回看",
      body: "会话、文件改动和版本节点留在同一项目中，方便回看每次决定。",
    },
    {
      title: "本地目录由你掌握",
      body: "项目保存在你选择的文件夹里，目录结构与正文文件始终可见。",
    },
  ],
  sources: [
    {
      title: "查询结果留在会话",
      body: "榜单、标签和分析结果直接回到当前会话，不需要在外部工具之间复制粘贴。",
    },
    {
      title: "需要时放大阅读",
      body: "长表格可以单独展开，完整查看排名、标签和趋势，再回到原任务继续推进。",
    },
  ],
  modes: [
    {
      title: "探索模式",
      body: "在只读模式中分析设定、整理冲突和提出方案，不修改项目文件。",
    },
    {
      title: "执行模式",
      body: "确认方向后续写章节、整理资料或修改文件，再由写作者审阅。",
    },
  ],
  review: [
    {
      title: "具体增删",
      body: "按文件展示新增、删除和修改内容，不必在整篇正文里寻找变化。",
    },
    {
      title: "逐项接受",
      body: "确认想保留的改动，并把审阅决定记录在当前项目中。",
    },
    {
      title: "安全拒绝",
      body: "不满意的改动可以撤回；如果文件已发生冲突，系统会阻止不安全覆盖。",
    },
    {
      title: "继续调整",
      body: "接受或拒绝后仍可继续修改，让 Agent 根据反馈再次处理。",
    },
  ],
  customize: [
    {
      title: "写作方法可换",
      body: "大纲、人物、时间线和章节审查等方法可以沉淀为 Skills，按项目复用。",
    },
    {
      title: "流程可持续",
      body: "你的项目越写越长，Storyflow 仍然围绕同一套目录、文件和上下文推进。",
    },
  ],
  versioning: [
    {
      title: "关键节点自动保存",
      body: "发送前、Agent 回合后，以及正文变化超过阈值或间隔数分钟后，自动创建本地版本。",
    },
    {
      title: "随时恢复",
      body: "可以从版本历史恢复任意节点；恢复前也会保存当前状态。",
    },
  ],
} as const;

const docsImages = {
  header: "/reference-assets/docs/doc-00-header.png",
  windowMap: "/reference-assets/docs/doc-01-window-map.png",
  sourceTree: "/reference-assets/docs/doc-02-source-tree.png",
  collaboration: "/reference-assets/docs/doc-03-collaboration.png",
  initialBrief: "/reference-assets/docs/doc-05-initial-brief.png",
  chapterCheck: "/reference-assets/docs/doc-06-chapter-check.png",
  fullReview: "/reference-assets/docs/doc-07-full-review.png",
  skillMenu: "/reference-assets/docs/doc-08-skill-menu.png",
} as const;

const howItWorksDiagram = `flowchart TD
  request["创作目标"] --> brief["项目简报"]
  brief --> topic["题材定位"]
  brief --> protagonist["人物设定"]
  brief --> golden["黄金三章"]
  brief --> density["篇幅与节奏"]
  topic --> outline["故事大纲"]
  protagonist --> outline
  golden --> chapter1["第1章拉新"]
  golden --> chapter2["第2章加压"]
  golden --> chapter3["第3章锁留存"]
  density --> outline
  chapter3 --> outline
  outline --> beats["章节规划"]
  outline --> characters["人物文件"]
  outline --> material["参考素材"]
  beats --> draft["正文文件"]
  draft --> diff["改动审阅"]
  draft --> scratch["试稿与审核"]
`;

function Icon({ name }: { name: string }) {
  if (name === "download") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <path d="M7 10l5 5 5-5" />
        <path d="M12 15V3" />
      </svg>
    );
  }

  if (name === "play") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" opacity="0.3" />
        <path d="M10 7.5v9l6-4.5-6-4.5z" />
      </svg>
    );
  }

  if (name === "github") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 0C5.373 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.5 11.5 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
      </svg>
    );
  }

  if (name === "windows") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M0 3.449 9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}

function Header({ isDocsPage }: { isDocsPage: boolean }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 0);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <header className={scrolled ? "site-header is-scrolled" : "site-header"}>
      <div className="header-inner">
        <a
          className="header-mark"
          href={landingPath}
          aria-label="Storyflow"
          data-storyflow-page-link="true"
        >
          <img src="/apple-touch-icon.png" alt="" />
        </a>
        <nav className="header-nav" aria-label="页面导航">
          <a href="/#workflow" data-storyflow-page-link="true">
            理解产品
          </a>
          <a
            href={docsPath}
            aria-current={isDocsPage ? "page" : undefined}
            data-storyflow-page-link="true"
          >
            文档
          </a>
          <a href="/#downloads" data-storyflow-page-link="true">
            下载桌面版
          </a>
        </nav>
      </div>
    </header>
  );
}

function DownloadMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div className="download-menu" ref={menuRef} id="downloads">
      <button className="button button-primary" type="button" onClick={() => setOpen((value) => !value)}>
        <Icon name="download" />
        下载 Storyflow 桌面版
      </button>
      {open ? (
        <div className="download-popover">
          {releaseDownloadOptions.map((option) => (
            <a download href={option.href} key={option.id}>
              <Icon name={option.platform === "Windows" ? "windows" : "apple"} />
              {option.label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ButtonRow() {
  return (
    <div className="button-row">
      <DownloadMenu />
      <a className="button button-secondary" href="#how-it-works-diagram">
        <Icon name="play" />
        查看工作流程
      </a>
      <a className="button button-secondary" href="#review">
        <Icon name="github" />
        查看如何审阅改动
      </a>
    </div>
  );
}

function HowItWorksDiagram() {
  const svg = useMemo(
    () =>
      renderMermaidSVG(howItWorksDiagram, {
        bg: "transparent",
        fg: "var(--foreground)",
        accent: "#2563eb",
        line: "color-mix(in oklch, var(--foreground) 26%, transparent)",
        muted: "color-mix(in oklch, var(--foreground) 56%, transparent)",
        surface: "var(--background)",
        border: "color-mix(in oklch, var(--foreground) 14%, transparent)",
        transparent: true,
        interactive: false,
      }),
    [],
  );

  return (
    <section className="diagram-section" id="how-it-works-diagram" aria-labelledby="how-it-works-title">
      <div className="diagram-copy">
        <h2 id="how-it-works-title">一个写作 Skill 如何推进项目</h2>
        <p>
          下面是一种网文写作流程示例，不是新项目的固定模板。Skill 可以根据任务创建简报、大纲、人物、素材和正文文件，Agent
          沿真实文件推进，写作者通过差异和版本历史检查结果。
        </p>
      </div>
      <div className="mermaid-diagram-frame" dangerouslySetInnerHTML={{ __html: svg }} />
    </section>
  );
}

function CardGrid({ cards }: { cards: readonly { title: string; body: string }[] }) {
  return (
    <div className="card-grid">
      {cards.map((card) => (
        <article className="info-card" key={card.title}>
          <h3>{card.title}</h3>
          <p>{card.body}</p>
        </article>
      ))}
    </div>
  );
}

function TextSection({
  title,
  children,
  className = "",
  id,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={`text-section ${className}`} id={id}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Hero() {
  const promoVideoRef = useRef<HTMLVideoElement>(null);
  const [promoVideoStarted, setPromoVideoStarted] = useState(false);

  const playPromoVideo = () => {
    void promoVideoRef.current?.play();
  };

  return (
    <section className="hero">
      <div className="hero-logo" aria-label="Storyflow">
        STORYFLOW
      </div>
      <div className="hero-copy">
        <h1>小说创作者的 AI 桌面工作台</h1>
        <p>
          把<strong>对话</strong>、<strong>正文</strong>、<strong>资料</strong>和<strong>Skills</strong>放进同一个本地项目。
          <br />
          Agent 可以读取真实文件并修改正文，每次改动都可审阅和恢复。
          <br />
          适合需要长期维护人物、设定和前文的小说项目。
        </p>
      </div>
      <ButtonRow />
      <figure className="hero-shot" aria-label="Storyflow 产品演示视频">
        <video
          className="hero-video"
          controls
          ref={promoVideoRef}
          playsInline
          onEnded={() => setPromoVideoStarted(false)}
          onPause={() => setPromoVideoStarted(false)}
          onPlay={() => setPromoVideoStarted(true)}
          poster={assets.promoPoster}
          preload="metadata"
        >
          <source src={assets.promoVideo} type="video/mp4" />
          你的浏览器暂不支持直接播放视频。
        </video>
        {!promoVideoStarted ? (
          <button className="video-play-button" type="button" onClick={playPromoVideo}>
            <Icon name="play" />
            播放演示
          </button>
        ) : null}
        <figcaption>
          <a href={assets.promoVideo} target="_blank" rel="noreferrer">
            打开 45 秒产品演示视频
          </a>
        </figcaption>
      </figure>
    </section>
  );
}

function FaqSection() {
  return (
    <section className="faq-section">
      <h2>开始写之前，你可能会问</h2>
      <div className="faq-list">
        {faqs.map((item) => (
          <article className="faq-item" key={item.question}>
            <h3>{item.question}</h3>
            <p>{item.answer}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function SourceStrip() {
  return (
    <div className="source-strip" aria-label="Storyflow 写作上下文">
      {contextSources.map((source) => (
        <span title={`${source.label}：${source.detail}`} key={source.label}>
          <strong>{source.label}</strong>
          <small>{source.detail}</small>
        </span>
      ))}
    </div>
  );
}

function getCurrentPageTarget(): PageTarget {
  if (typeof window === "undefined") {
    return { pathname: landingPath, hash: "" };
  }

  return {
    pathname: window.location.pathname,
    hash: window.location.hash,
  };
}

function normalizePagePath(pathname: string) {
  const normalized = pathname.replace(/\/$/, "");
  return normalized === "" ? landingPath : normalized;
}

function isDocsPagePath(pathname: string) {
  return normalizePagePath(pathname) === "/docs";
}

function isHandledPagePath(pathname: string) {
  const normalized = normalizePagePath(pathname);
  return normalized === landingPath || normalized === "/docs";
}

function scrollToPageHash(hash: string) {
  window.requestAnimationFrame(() => {
    if (!hash) {
      window.scrollTo({ top: 0 });
      return;
    }

    const target = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (target) {
      target.scrollIntoView();
    }
  });
}

function LandingPage() {
  return (
    <>
        <Hero />
        <FaqSection />
        <HowItWorksDiagram />

        <TextSection title="不是聊天窗口，而是写作工作台" id="workflow">
          <p>
            Storyflow 以真实项目文件为中心。会话负责理解任务和执行，正文、资料与项目目录始终可见，所有结果都回到同一份作品。
          </p>
          <CardGrid cards={sections.workflow} />
          <p className="fine-print">
            支持 Apple Silicon、Intel Mac 和 Windows x64。
          </p>
        </TextSection>

        <hr className="section-divider" />

        <TextSection title="人物、设定和前文，始终留在项目里">
          <p>
            写小说需要反复回到人物、设定、时间线、章节目标和前文伏笔。Storyflow
            让这些信息作为真实项目文件存在，供写作者和 Agent 持续使用。
          </p>
          <SourceStrip />
          <CardGrid cards={sections.context} />
        </TextSection>

        <TextSection title="榜单与资料查询留在同一个工作流里" className="compact-top">
          <p>
            连接数据源后，Agent 可以在当前会话中查询榜单与分析结果。表格保留在任务上下文里，需要专注阅读时再放大查看。
          </p>
          <img className="wide-image inline-image" src={assets.dataResults} alt="Storyflow 会话中的网文榜单查询结果" />
          <img className="wide-image inline-image" src={assets.dataExpanded} alt="Storyflow 放大查看网文榜单分析" />
          <section className="section-cards flush-bottom">
            <CardGrid cards={sections.sources} />
          </section>
        </TextSection>

        <TextSection title="对话与正文同屏推进" className="compact-top">
          <p>
            左侧会话负责讨论、执行和审阅，右侧正文与项目文件保持可见。写作结果直接落进作品，不必在聊天窗口和文档之间来回搬运。
          </p>
          <div className="split-section">
            <img src={assets.delivery} alt="Storyflow 对话、正文编辑器和项目文件树" />
            <article className="info-card tall-card">
              <h3>正文独立保存</h3>
              <p>章节仍是清晰的 Markdown 文件，不会埋进聊天记录。</p>
              <h3>改动可审阅</h3>
              <p>Agent 修改了哪些文件、增加或删除了什么，都可以检查。</p>
              <h3>继续写时有上下文</h3>
              <p>下一次继续写时，仍然从当前项目和正文状态出发。</p>
            </article>
          </div>
        </TextSection>

        <TextSection title="先探索，再执行" className="compact-top">
          <p>
            先在只读模式中分析设定、整理冲突、提出方案；确认方向后，再切换执行模式修改文件。
          </p>
        </TextSection>
        <img className="wide-image" src={assets.workspace} alt="Storyflow 对话、正文和项目文件协同界面" />
        <section className="section-cards">
          <CardGrid cards={sections.modes} />
        </section>

        <TextSection title="每次文件改动，都可以逐项审阅" className="compact-top" id="review">
          <p>
            Agent 修改正文后，Storyflow 会展示具体增删内容。你可以接受、拒绝或继续调整，不必在整篇文本里寻找变化。
          </p>
        </TextSection>
        <img className="wide-image no-shadow" src={assets.reviewDiff} alt="Storyflow 审阅差异与接受拒绝界面" />
        <section className="section-cards">
          <CardGrid cards={sections.review} />
        </section>

        <TextSection title="把你的写作方法沉淀下来" className="compact-top">
          <p>
            章节审查、人物设计、大纲生成、剧情因果检查和时间线分析，都可以沉淀为可复用的
            Skills。你可以直接查看和编辑这些方法，不必每次从零写提示词。
          </p>
        </TextSection>
        <img className="wide-image" src={assets.skills} alt="Storyflow 写作 Skill 详情与说明界面" />
        <section className="section-cards">
          <CardGrid cards={sections.customize} />
        </section>

        <TextSection title="版本管理，不怕改坏" className="compact-top">
          <p>
            长文本写作最怕回不去。Storyflow
            会围绕本地工作区保存关键节点，Agent 写偏了、你改错了，都可以回到更早的版本继续推进。
          </p>
        </TextSection>
        <img className="wide-image" src={assets.versionHistory} alt="Storyflow 版本管理与恢复界面" />
        <section className="section-cards">
          <CardGrid cards={sections.versioning} />
        </section>

        <TextSection title="你的作品，由你决定如何落稿" className="compact-top">
          <p>
            Agent 负责读取项目、扩展可能性和执行重复任务；你负责判断、取舍、改写和落稿。AI
            是工作台的一部分，不替你做最终决定。
          </p>
        </TextSection>
    </>
  );
}

function DocsPage() {
  return (
    <article className="docs-page">
      <section className="docs-hero">
        <p className="docs-kicker">Storyflow 文档</p>
        <h1>小说 Agents 写作工作区说明</h1>
        <p>面向编剧、网文作者和内容策划；配图来自当前 Electron 应用截图。</p>
      </section>

      <section className="docs-summary">
        <h2>一句话理解</h2>
        <p>
          小说 Agents 的写作工作区像一个带助手的作品资料柜：左侧是一本书的目录分区，
          中间是正在沉淀的作品文件，右侧是你和助手讨论、确认、改稿的地方。
        </p>
      </section>

      <section className="docs-section" id="header-tools">
        <div className="docs-section-copy">
          <h2>图 0：Header 功能区</h2>
        </div>
        <figure className="docs-figure docs-figure-wide">
          <img src={docsImages.header} alt="真实截图：Header 功能区" />
          <figcaption>图 0：Header 功能区</figcaption>
        </figure>
        <ul className="docs-bullet-list">
          <li>
            <strong>项目切换：</strong>从一本书切到另一本书。
          </li>
          <li>
            <strong>数据源：</strong>接入资料、文件夹、外部服务，适合挂参考资料和素材库。
          </li>
          <li>
            <strong>技能：</strong>给助手加载专门工作方法，例如写作法、拆文法、审校法。
          </li>
          <li>
            <strong>自动化：</strong>让任务按规则自动运行，适合定时检查和持续跟进。
          </li>
          <li>
            <strong>设置：</strong>模型、权限和应用设置。
          </li>
          <li>
            <strong>版本管理：</strong>保存、查看、恢复写作版本，相当于作品的时间机器。
          </li>
        </ul>
      </section>

      <section className="docs-section" id="window-map">
        <div className="docs-section-copy">
          <h2>图 1：整窗地图</h2>
        </div>
        <figure className="docs-figure docs-figure-wide">
          <img src={docsImages.windowMap} alt="真实截图：整体框选" />
          <figcaption>图 1：整体框选</figcaption>
        </figure>
        <ul className="docs-bullet-list">
          <li>
            <strong>资料目录：</strong>一本书的分区书架。正文、大纲、角色、风格、素材分开放，避免所有信息混在聊天记录里。
          </li>
          <li>
            <strong>正文 / 文档区：</strong>正在编辑的作品文件。截图里打开的是第一章正文，它会被保存成作品资产。
          </li>
          <li>
            <strong>助手协作区：</strong>助手检查章节是否和大纲 beat 对齐，也可以继续写下一章、重写、扩写或改方向。
          </li>
          <li>
            <strong>输入区：</strong>作者给助手下一步任务，例如继续、重写、加强冲突、改成更爽。
          </li>
        </ul>
      </section>

      <section className="docs-section" id="source-tree">
        <div className="docs-section-copy">
          <h2>图 2：资料树框选</h2>
          <p>左侧资料树不是工程目录，而是一套写作资料柜。</p>
        </div>
        <figure className="docs-figure docs-figure-contain">
          <img src={docsImages.sourceTree} alt="真实截图：资料树框选" />
          <figcaption>图 2：资料树框选</figcaption>
        </figure>
        <ul className="docs-bullet-list">
          <li>
            <strong>全局信息：</strong>放大纲、人物、地点、风格、时间线、状态、素材等长期资料。
          </li>
          <li>
            <strong>正文：</strong>只放真正会给读者看的章节。
          </li>
          <li>
            <strong>当前章节：</strong>正在编辑的具体正文文件。
          </li>
        </ul>
      </section>

      <section className="docs-section" id="collaboration">
        <div className="docs-section-copy">
          <h2>图 3：写作协作区框选</h2>
        </div>
        <figure className="docs-figure docs-figure-wide">
          <img src={docsImages.collaboration} alt="真实截图：写作协作区框选" />
          <figcaption>图 3：写作协作区框选</figcaption>
        </figure>
        <ul className="docs-bullet-list">
          <li>
            <strong>作品草稿：</strong>沉淀正文和修改痕迹。
          </li>
          <li>
            <strong>助手反馈：</strong>检查章节钩子、主要事件、信息差、情绪落点等 beat 是否对齐。
          </li>
          <li>
            <strong>下一步：</strong>作者像和编辑沟通一样，要求继续写、重写、调整节奏或加强某条线。
          </li>
        </ul>
      </section>

      <section className="docs-section" id="create-project">
        <div className="docs-section-copy">
          <h2>创建并开始一个项目</h2>
          <h3>创建项目功能怎么用</h3>
          <p>
            创建项目可以理解成给一本新作品开一个独立资料柜。系统只建立空项目，不预先创建目录或文件；项目结构由你真正创建或导入的内容决定。
          </p>
          <h3>创建时要决定什么</h3>
          <ul className="docs-inline-list">
            <li>项目名称：建议直接写作品名或暂定名，例如《女扮男装入朝后》。</li>
            <li>保存位置：决定这个项目放在哪个工作区或文件夹里，方便以后找回。</li>
          </ul>
          <h3>空项目从哪里开始</h3>
          <p>
            新项目打开后会提供四个入口。它们都是显式操作，不会在背后改动你的文件夹。
          </p>
          <ul className="docs-inline-list">
            <li>描述项目：先告诉助手题材、主角、冲突、篇幅和禁区。</li>
            <li>导入文件：把已有大纲、正文或素材原样放入项目。</li>
            <li>创建文件：从一个真实文件开始，按需要逐步形成目录。</li>
            <li>添加 Skills：为当前任务选择可复用的写作方法。</li>
          </ul>
          <h3>创建后第一件事</h3>
          <p>没有旧稿时，建议先描述项目；已有材料时，直接导入文件。随后按真实工作需要逐步沉淀：</p>
          <ul className="docs-inline-list">
            <li>先填简报：题材、主角、核心钩子、篇幅、禁区。</li>
            <li>再推大纲：每章钩子、冲突、反转、情绪落点。</li>
            <li>再补人物和素材：动机、秘密、关系变化、可复用设定。</li>
            <li>最后写正文：每章一个文件，把正式内容沉淀到正文区。</li>
          </ul>
          <p>如果作者只是想临时问一个问题，可以继续用聊天；如果要认真推进一篇作品，就应该创建项目。</p>
        </div>
        <ul className="docs-bullet-list">
          <li>把选题信息丢给助手，让助手先追问会影响大纲的关键问题。</li>
          <li>确认题材、人设、篇幅、读者期待和禁区。</li>
          <li>让助手先填简报，再推大纲，不要一上来直接写正文。</li>
          <li>大纲确认后，逐章写正文，每章一个文件。</li>
          <li>每次改动都回到对应文件里沉淀，不只留在聊天里。</li>
        </ul>
      </section>

      <section className="docs-section docs-checklist" id="checklist">
        <div className="docs-section-copy">
          <h2>判断是否用对了</h2>
        </div>
        <ul className="docs-bullet-list">
          <li>不用在聊天记录里翻找设定，资料都在左侧分类里。</li>
          <li>助手不会每次重新理解一本书，因为简报、大纲、人物、风格都能作为上下文。</li>
          <li>写正文前，章节钩子、反转点和情绪落点已经比较清楚。</li>
        </ul>
      </section>

      <section className="docs-section" id="initial-brief">
        <div className="docs-section-copy">
          <h2>1. 初始给出的信息越明确越好</h2>
          <p>主要就是题材，人设，核心梗，金手指之类的。</p>
        </div>
        <figure className="docs-figure docs-figure-wide">
          <img src={docsImages.initialBrief} alt="真实截图：初始信息和关键问题确认" />
          <figcaption>初始给出的信息越明确越好</figcaption>
        </figure>
      </section>

      <section className="docs-section" id="chapter-check">
        <div className="docs-section-copy">
          <h2>2. 最好一章写完后进行检查</h2>
          <p>不要一次性全部写完，效果会变差；如果一章一章写，模型检查会更仔细。</p>
        </div>
        <figure className="docs-figure docs-figure-wide">
          <img src={docsImages.chapterCheck} alt="真实截图：一章写完后进行检查" />
          <figcaption>一章写完后进行检查</figcaption>
        </figure>
      </section>

      <section className="docs-section" id="full-review">
        <div className="docs-section-copy">
          <h2>3. 写完后审查</h2>
          <p>
            写完后让 Agent 审查一遍全文，查看哪里有逻辑上的问题和错误。你可以自定义自己的技能，告诉 Agent 后它会帮你写，比如小说审查。
          </p>
        </div>
        <figure className="docs-figure docs-figure-wide">
          <img src={docsImages.fullReview} alt="真实截图：小说审查技能" />
          <figcaption>写完后让 Agent 审查一遍全文</figcaption>
        </figure>
        <div className="docs-section-copy docs-subsection">
          <p>然后在对话框中打出 “/” 字符后就可以看到你定义的技能了。</p>
        </div>
        <figure className="docs-figure docs-figure-contain">
          <img src={docsImages.skillMenu} alt="真实截图：对话框中输入斜杠查看技能" />
          <figcaption>在对话框中打出 “/” 字符后可以看到你定义的技能</figcaption>
        </figure>
      </section>
    </article>
  );
}

export function App() {
  const [pageTarget, setPageTarget] = useState<PageTarget>(() => getCurrentPageTarget());
  const isDocsPage = isDocsPagePath(pageTarget.pathname);

  useEffect(() => {
    const handlePopState = () => {
      setPageTarget(getCurrentPageTarget());
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const handlePageClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey
    ) {
      return;
    }

    const link = (event.target as Element).closest<HTMLAnchorElement>("a[data-storyflow-page-link='true']");
    if (!link || link.target || link.hasAttribute("download")) {
      return;
    }

    const targetUrl = new URL(link.href, window.location.href);
    if (targetUrl.origin !== window.location.origin || !isHandledPagePath(targetUrl.pathname)) {
      return;
    }

    event.preventDefault();

    const nextTarget = {
      pathname: targetUrl.pathname,
      hash: targetUrl.hash,
    };
    const nextUrl = `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

    if (nextUrl !== currentUrl) {
      window.history.pushState(null, "", nextUrl);
    }

    setPageTarget(nextTarget);
    scrollToPageHash(nextTarget.hash);
  };

  return (
    <div className="page-shell" onClick={handlePageClick}>
      <div className="background-pattern" aria-hidden="true" />
      <Header isDocsPage={isDocsPage} />
      <main className="main-content">{isDocsPage ? <DocsPage /> : <LandingPage />}</main>
      <footer className="site-footer">
        <span>© 2026 Storyflow</span>
        <span className="footer-links">
          <a href="/#workflow" data-storyflow-page-link="true">
            理解产品
          </a>
          <a href={docsPath} data-storyflow-page-link="true">
            文档
          </a>
          <a href="/#downloads" data-storyflow-page-link="true">
            下载桌面版
          </a>
        </span>
      </footer>
    </div>
  );
}
