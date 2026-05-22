// input: Storyflow release links, local product screenshots, and promo video
// output: Craft-style Chinese landing page for writers
// pos: React surface for the public marketing route

import { renderMermaidSVG } from "beautiful-mermaid";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { downloadOptions as releaseDownloadOptions } from "./downloads";

const assets = {
  workspace: "./reference-assets/storyflow-workspace.png",
  promoVideo: "./reference-assets/storyflow-promo-45s.mp4",
  promoPoster: "./reference-assets/storyflow-promo-poster.jpg",
  dataSource: "./reference-assets/storyflow-data-source.png",
  skills: "./reference-assets/storyflow-skills.png",
  reviewDiff: "./reference-assets/storyflow-review-diff.png",
  delivery: "./reference-assets/storyflow-delivery.png",
  versionHistory: "./reference-assets/storyflow-version-history.png",
};

const faqs = [
  {
    question: "它和普通 AI 聊天窗口有什么区别？",
    answer:
      "Storyflow 不是把小说贴进聊天框再复制回来。它把正文、设定、大纲、素材、Agent 任务和审阅记录放进同一个桌面项目里，写作过程可以持续推进。",
  },
  {
    question: "适合什么类型的写作者？",
    answer:
      "适合写长文本的人：网文、短篇、连载、角色设定集、章节大纲、素材整理。尤其适合需要反复续写、审稿、改稿、管理上下文的项目。",
  },
  {
    question: "Agent 会直接改我的正文吗？",
    answer:
      "不会把最终判断权拿走。Agent 可以生成候选章节、整理任务、提出审阅意见，写作者仍然逐段检查、采用、改写或删除。",
  },
  {
    question: "大纲、人物、设定能一起管理吗？",
    answer:
      "可以。左侧工作区把全局信息、大纲、角色、风格、分析、素材和正文组织在同一个项目树里，避免资料散落在聊天记录和文件夹之间。",
  },
  {
    question: "可以让它连续写多个章节吗？",
    answer:
      "可以。Storyflow 支持把章节拆成任务，Agent 可以按计划执行，右侧面板会保留任务状态、文件路径、章节摘要和创作总结。",
  },
  {
    question: "为什么强调桌面版？",
    answer:
      "长文本写作需要稳定的本地项目、文件路径、窗口布局和持续上下文。桌面版更适合把写作、资料、Agent 执行和审阅变成一个长期工作台。",
  },
] as const;

const sourceLogos = [
  "正文",
  "大纲",
  "人物",
  "设定",
  "风格",
  "素材",
  "任务",
  "审阅",
  "总结",
  "导出",
] as const;

const sections = {
  workflow: [
    {
      title: "正文在中心",
      body: "写作区保留接近文档编辑器的专注体验，章节文本、行号、字数和上下文都在同一个主视图里。",
    },
    {
      title: "Agent 在右侧",
      body: "右侧面板负责续写、总结、拆任务、审阅和生成候选内容，不打断正文编辑的节奏。",
    },
    {
      title: "资料在左侧",
      body: "大纲、人物、设定、风格要求和素材被整理成项目树，Agent 调用上下文时有稳定来源。",
    },
    {
      title: "结果可审阅",
      body: "Agent 产出不会直接变成最终稿。写作者可以逐段取舍，把结果落回正文。",
    },
  ],
  context: [
    {
      title: "长文本上下文",
      body: "围绕章节、大纲、人物和素材组织上下文，而不是依赖一段容易失控的长聊天记录。",
    },
    {
      title: "章节任务流",
      body: "把第 7 章、第 8 章、第 9 章拆成明确任务，完成情况和文件路径都可追踪。",
    },
    {
      title: "创作状态保留",
      body: "每次讨论、续写、总结和审阅都留在项目里，方便回看为什么这样写。",
    },
    {
      title: "本地项目优先",
      body: "围绕你的本地文件夹和桌面工作流设计，适合长期维护一个创作项目。",
    },
  ],
  sources: [
    {
      title: "数据源可连接",
      body: "MCP、文档和素材库可以进入同一个项目，让 Agent 使用榜单、标签、分析数据和参考资料。",
    },
    {
      title: "说明先于调用",
      body: "数据表、字段含义、可用边界和连接状态都在工作台里，减少模型误读来源的概率。",
    },
  ],
  modes: [
    {
      title: "探索模式",
      body: "先让 Agent 分析设定、整理冲突、提出章节方案。这个阶段默认不直接改正文。",
    },
    {
      title: "执行模式",
      body: "方案确认后再进入执行：续写章节、补齐摘要、拆分任务，最后由写作者审阅落稿。",
    },
  ],
  review: [
    {
      title: "章节承接",
      body: "检查本章是否接住上一章的情绪、伏笔和人物状态，避免突然跳戏。",
    },
    {
      title: "人物动机",
      body: "审阅角色行为是否符合前文设定，避免为了推进剧情而降智。",
    },
    {
      title: "节奏与爽点",
      body: "对短篇、网文、连载章节的节奏进行检查，保留读者愿意继续看的推进力。",
    },
    {
      title: "可落稿建议",
      body: "不是泛泛评价，而是给出可以直接改写、补句、删段的具体建议。",
    },
  ],
  customize: [
    {
      title: "写作方法可换",
      body: "大纲、人物、时间线、章节审查等方法可以以技能形式沉淀，按项目复用。",
    },
    {
      title: "流程可持续",
      body: "你的项目越写越长，Storyflow 仍然围绕同一套目录、文件和上下文推进。",
    },
  ],
  versioning: [
    {
      title: "自动保存",
      body: "发送前、Agent 回合后、正文变更到达阈值时自动创建本地版本点。",
    },
    {
      title: "一键恢复",
      body: "写偏、改坏或想回到上一轮时，可以从版本管理里恢复到任意历史状态。",
    },
  ],
} as const;

const howItWorksDiagram = `flowchart TD
  request["初始化请求"] --> brief["简报.md"]
  brief --> topic["题材定位"]
  brief --> protagonist["主角设置"]
  brief --> golden["黄金三章"]
  brief --> density["密度选择"]
  topic --> outline["大纲.md"]
  protagonist --> outline
  golden --> chapter1["第1章拉新"]
  golden --> chapter2["第2章加压"]
  golden --> chapter3["第3章锁留存"]
  density --> outline
  chapter3 --> outline
  outline --> beats["分章 beat"]
  outline --> characters["人物.md"]
  outline --> material["素材.md"]
  beats --> draft["正文/NN-标题.md"]
  draft --> diff["git diff 留痕"]
  draft --> scratch[".work/ 试稿与审核"]
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

function Header() {
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
        <a className="header-mark" href="/" aria-label="Storyflow">
          <img src="./apple-touch-icon.png" alt="" />
        </a>
        <nav className="header-nav" aria-label="页面导航">
          <a href="#workflow">理解产品</a>
          <a href="#downloads">下载桌面版</a>
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
            <a href={option.href} key={option.id}>
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
        看它如何工作
      </a>
      <a className="button button-secondary" href="#review">
        <Icon name="github" />
        查看审阅流程
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
        <h2 id="how-it-works-title">创建 Workspace 后，写作流程如何展开</h2>
        <p>
          从初始请求到简报、大纲、人物、素材和正文文件，Storyflow 把一次创作任务拆成可追踪的项目结构；
          Agent 可以沿着这些文件推进，写作者再通过 diff 和试稿区审阅落稿。
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
        <h1>写作者的本地 AI 工作台</h1>
        <p>
          把 <strong>正文</strong>、<strong>大纲</strong>、<strong>人物设定</strong>、<strong>素材</strong> 和{" "}
          <strong>Agent 执行</strong> 放在同一个桌面项目里。
          <br />
          从灵感、大纲、章节续写到审阅落稿，让长文本写作连续起来。
          <br />
          适合网文、短篇、连载和任何需要长期维护上下文的创作项目。
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
      <h2>那些写长文本时最烦的事，应该直接顺起来</h2>
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
      {sourceLogos.map((name) => (
        <span title={name} key={name}>
          {name.slice(0, 1)}
        </span>
      ))}
    </div>
  );
}

export function App() {
  return (
    <div className="page-shell">
      <div className="background-pattern" aria-hidden="true" />
      <Header />
      <main className="main-content">
        <Hero />
        <FaqSection />
        <HowItWorksDiagram />

        <TextSection title="不是聊天窗口，而是写作工作台" id="workflow">
          <p>
            Storyflow 的核心不是制造更多对话，而是把资料、文本和任务组织成一个可持续推进的项目。
            左侧是写作资料和章节树，中间是正文，右侧是 Agent 执行、总结和审阅。
          </p>
          <CardGrid cards={sections.workflow} />
          <p className="fine-print">
            下载链接默认指向 story.zjding.com/latest。桌面版适合把本地项目、章节文件、素材和 Agent 工作流稳定地放在一起。
          </p>
        </TextSection>

        <hr className="section-divider" />

        <TextSection title="围绕长文本上下文设计">
          <p>
            小说和连载不是一次问答能解决的问题。你需要反复回到人物、设定、时间线、章节目标和前文伏笔，
            Storyflow 把这些上下文变成工作台的一部分。
          </p>
          <SourceStrip />
          <CardGrid cards={sections.context} />
        </TextSection>

        <TextSection title="数据源和素材可以被 Agent 读取" className="compact-top">
          <p>
            参考资料不应该散落在截图、聊天记录和临时文件里。Storyflow 可以把网文数据源、素材文档和项目说明放进同一个上下文系统，
            让 Agent 在写作前先理解来源、边界和可用信息。
          </p>
          <img className="wide-image inline-image" src={assets.dataSource} alt="Storyflow 数据源与 MCP 文档界面" />
          <section className="section-cards flush-bottom">
            <CardGrid cards={sections.sources} />
          </section>
        </TextSection>

        <TextSection title="多章节推进，不打断写作节奏" className="compact-top">
          <p>
            右侧 Agent 面板可以拆分章节任务、记录生成文件、总结创作进度；中间正文区保持安静，不把写作者拖进一串失控聊天。
          </p>
          <div className="split-section">
            <img src={assets.delivery} alt="Storyflow 多章节任务交付界面" />
            <article className="info-card tall-card">
              <h3>任务可见</h3>
              <p>每个章节任务都有状态、目标和对应文件路径。</p>
              <h3>上下文不断</h3>
              <p>写到第 7 章时，仍然可以回看前几章摘要和设定。</p>
              <h3>结果可落稿</h3>
              <p>生成内容进入候选区，最终由写作者决定是否采用。</p>
            </article>
          </div>
        </TextSection>

        <TextSection title="先探索，再执行" className="compact-top">
          <p>
            写作 Agent 不应该一上来就改正文。先分析目标、对齐章节方向，再进入执行模式完成续写、整理和审阅。
          </p>
        </TextSection>
        <img className="wide-image" src={assets.workspace} alt="Storyflow 探索与执行模式" />
        <section className="section-cards">
          <CardGrid cards={sections.modes} />
        </section>

        <TextSection title="审阅不是泛泛评价" className="compact-top" id="review">
          <p>
            Storyflow 更适合把审阅变成具体修改建议：哪里承接断了、哪里人物动机弱、哪里节奏拖、哪里可以补一个更强的钩子。
          </p>
        </TextSection>
        <img className="wide-image no-shadow" src={assets.reviewDiff} alt="Storyflow 审阅差异与接受拒绝界面" />
        <section className="section-cards">
          <CardGrid cards={sections.review} />
        </section>

        <TextSection title="把你的写作方法沉淀下来" className="compact-top">
          <p>
            章节单元审查、人物设计、大纲生成、剧情因果检查、时间线分析，都可以沉淀成可复用技能。
            不是每次从零提示，而是让工作台逐渐贴合你的写作方法。
          </p>
        </TextSection>
        <img className="wide-image" src={assets.skills} alt="Storyflow 写作技能库界面" />
        <section className="section-cards">
          <CardGrid cards={sections.customize} />
        </section>

        <TextSection title="版本管理，不怕改坏" className="compact-top">
          <p>
            长文本写作最怕回不去。Storyflow 会围绕本地工作区保存关键节点，Agent 写偏了、你改错了，
            都可以回到更早的版本继续推进。
          </p>
        </TextSection>
        <img className="wide-image" src={assets.versionHistory} alt="Storyflow 版本管理与恢复界面" />
        <section className="section-cards">
          <CardGrid cards={sections.versioning} />
        </section>

        <TextSection title="为写作者保留最终判断权" className="compact-top">
          <p>
            Agent 负责扩展可能性、整理上下文、执行重复任务；写作者负责判断、取舍、改写和落稿。
            Storyflow 的界面围绕这个边界设计：AI 是工作台的一部分，不是替代写作者的黑箱。
          </p>
        </TextSection>
      </main>
      <footer className="site-footer">
        <span>© 2026 Storyflow</span>
        <span className="footer-links">
          <a href="#workflow">理解产品</a>
          <a href="#downloads">下载桌面版</a>
        </span>
      </footer>
    </div>
  );
}
