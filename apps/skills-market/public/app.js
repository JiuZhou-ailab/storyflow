// input: Public Skills Market APIs, search/filter events, and author-selected Skill directories
// output: Marketplace catalog/detail UI and Access-gated contribution submissions
// pos: Browser-only presentation adapter; package validation remains authoritative in the Worker

const state = {
  skills: [],
  query: '',
  filter: 'all',
}

const elements = {
  search: document.querySelector('#skill-search'),
  searchStatus: document.querySelector('#search-status'),
  featured: document.querySelector('#featured-grid'),
  catalog: document.querySelector('#skill-grid'),
  count: document.querySelector('#catalog-count'),
  empty: document.querySelector('#empty-state'),
  clear: document.querySelector('#clear-filters'),
  dialog: document.querySelector('#skill-dialog'),
  dialogContent: document.querySelector('#dialog-content'),
  template: document.querySelector('#skill-card-template'),
  studio: document.querySelector('#studio'),
  submissionForm: document.querySelector('#submission-form'),
  directory: document.querySelector('#skill-directory'),
  submissionPreview: document.querySelector('#submission-preview'),
  submissionStatus: document.querySelector('#submission-status'),
  submitSkill: document.querySelector('#submit-skill'),
}

if (location.pathname.startsWith('/studio')) {
  document.querySelector('.intro').hidden = true
  document.querySelector('.catalog-controls').hidden = true
  document.querySelector('#featured-section').hidden = true
  document.querySelector('#catalog').hidden = true
  elements.studio.hidden = false
  setupSubmissionForm()
} else {
  setupCatalog()
}

async function setupCatalog() {
  elements.search.addEventListener('input', () => {
    state.query = elements.search.value.trim().toLocaleLowerCase()
    renderCatalog()
  })
  document.querySelectorAll('[data-filter]').forEach(button => {
    button.addEventListener('click', () => {
      state.filter = button.dataset.filter
      document.querySelectorAll('[data-filter]').forEach(item => item.classList.toggle('is-active', item === button))
      renderCatalog()
    })
  })
  elements.clear.addEventListener('click', () => {
    state.query = ''
    state.filter = 'all'
    elements.search.value = ''
    document.querySelectorAll('[data-filter]').forEach(item => item.classList.toggle('is-active', item.dataset.filter === 'all'))
    renderCatalog()
  })
  elements.dialog.addEventListener('click', event => {
    if (event.target === elements.dialog) elements.dialog.close()
  })

  try {
    const response = await fetch('/api/skills')
    if (!response.ok) throw new Error(`目录请求失败 (${response.status})`)
    const data = await response.json()
    state.skills = Array.isArray(data.skills) ? data.skills : []
    elements.searchStatus.textContent = `${state.skills.length} 个方法 · ${state.skills.filter(skill => skill.sha256).length} 个可安装`
    renderFeatured()
    renderCatalog()
  } catch (error) {
    elements.searchStatus.textContent = error instanceof Error ? error.message : '目录暂时不可用'
    elements.empty.hidden = false
  }
}

function renderFeatured() {
  elements.featured.replaceChildren(...state.skills.filter(skill => skill.featured).slice(0, 6).map(createSkillCard))
}

function renderCatalog() {
  const filtered = state.skills.filter(skill => {
    const installable = Boolean(skill.sha256)
    if (state.filter === 'installable' && !installable) return false
    if (state.filter === 'reference-only' && installable) return false
    if (!state.query) return true
    return [skill.displayName, skill.summary, skill.author, ...(skill.tags ?? []), ...(skill.roots ?? [])]
      .join(' ').toLocaleLowerCase().includes(state.query)
  })
  elements.catalog.replaceChildren(...filtered.map(createSkillCard))
  elements.count.textContent = `${filtered.length} / ${state.skills.length}`
  elements.empty.hidden = filtered.length > 0
}

function createSkillCard(skill) {
  const fragment = elements.template.content.cloneNode(true)
  const card = fragment.querySelector('.skill-card')
  const open = fragment.querySelector('.skill-card__open')
  fragment.querySelector('.skill-card__status').textContent = skill.sha256 ? `可安装 · v${skill.version}` : '仅参考 · 许可待确认'
  fragment.querySelector('.skill-card__title').textContent = skill.displayName
  fragment.querySelector('.skill-card__summary').textContent = skill.summary
  fragment.querySelector('.skill-card__author').textContent = `${skill.author} · ${skill.license}`
  fragment.querySelector('.skill-card__visual').textContent = (skill.roots ?? []).slice(0, 4).map(path => `└─ ${path}/`).join('\n') || '└─ project/'
  open.setAttribute('aria-label', `查看 ${skill.displayName}`)
  open.addEventListener('click', () => openSkillDetail(skill.slug, open))
  card.dataset.slug = skill.slug
  return fragment
}

async function openSkillDetail(slug, trigger) {
  trigger.disabled = true
  try {
    const response = await fetch(`/api/skills/${encodeURIComponent(slug)}`)
    if (!response.ok) throw new Error(`详情请求失败 (${response.status})`)
    renderSkillDialog(await response.json())
    elements.dialog.showModal()
  } catch (error) {
    elements.searchStatus.textContent = error instanceof Error ? error.message : '无法读取 Skill 详情'
  } finally {
    trigger.disabled = false
  }
}

function renderSkillDialog(skill) {
  const head = node('div', 'detail-head')
  const status = node('span', 'detail-status', skill.sha256 ? `可安装 · ${skill.version} · ${shortHash(skill.sha256)}` : '仅参考 · 不提供下载')
  const title = node('h2', '', skill.displayName)
  title.id = 'dialog-title'
  head.append(status, title, node('p', '', skill.summary))

  const rootsTitle = node('h3', '', '会建议怎样的项目目录')
  const roots = node('ul', 'detail-roots')
  ;(skill.roots ?? []).forEach(path => roots.append(node('li', '', `${path}/`)))

  const provenance = node('p', '', `来源：${skill.manifest?.methodology?.sourceName ?? skill.author} · 许可：${skill.license}`)
  const actions = node('div', 'detail-actions')
  if (skill.installUrl) {
    const install = node('a', 'button button--solid', '导入当前项目')
    install.href = skill.installUrl
    actions.append(install)
    const download = node('a', 'button button--outline', '下载包')
    download.href = skill.downloadPath
    actions.append(download)
  }
  const sourceUrl = skill.manifest?.methodology?.sourceUrl
  if (isPublicHttpUrl(sourceUrl)) {
    const source = node('a', 'text-link', '查看原始方法来源 ↗')
    source.href = sourceUrl
    source.target = '_blank'
    source.rel = 'noreferrer'
    actions.append(source)
  }
  elements.dialogContent.replaceChildren(head, rootsTitle, roots, provenance, actions)
}

function setupSubmissionForm() {
  elements.directory.addEventListener('change', () => previewDirectory(elements.directory.files))
  elements.submissionForm.addEventListener('submit', async event => {
    event.preventDefault()
    const files = normalizeSelectedFiles(elements.directory.files)
    if (!files.some(file => file.relativePath === 'SKILL.md') || !files.some(file => file.relativePath === 'storyflow.json')) {
      setSubmissionState('error', '目录必须包含 SKILL.md 和 storyflow.json。')
      return
    }
    setSubmissionState('loading', '正在构建并提交审核包…')
    try {
      const bundleFiles = []
      for (const file of files) {
        const bytes = new Uint8Array(await file.file.arrayBuffer())
        bundleFiles.push({ relativePath: file.relativePath, contentBase64: toBase64(bytes), size: bytes.byteLength })
      }
      const manifest = JSON.parse(await files.find(file => file.relativePath === 'storyflow.json').file.text())
      const bundle = {
        version: 1,
        exportedAt: Date.now(),
        sourceWorkspace: 'Skills Market Publisher Studio',
        resources: { skills: [{ slug: manifest.slug, files: bundleFiles }] },
      }
      const response = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(bundle),
      })
      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.includes('application/json')) throw new Error('需要先通过 Cloudflare Access 登录，再重新提交。')
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? `提交失败 (${response.status})`)
      setSubmissionState('success', `已进入审核队列。版本 ID：${result.versionId}`)
      elements.submissionForm.reset()
      elements.submissionPreview.textContent = '尚未选择目录。'
    } catch (error) {
      setSubmissionState('error', error instanceof Error ? error.message : '提交失败')
    }
  })
}

function previewDirectory(fileList) {
  const files = normalizeSelectedFiles(fileList)
  const bytes = files.reduce((sum, item) => sum + item.file.size, 0)
  const required = ['SKILL.md', 'storyflow.json'].map(name => `${files.some(file => file.relativePath === name) ? '✓' : '×'} ${name}`)
  elements.submissionPreview.textContent = `${files.length} 个文本文件 · ${formatBytes(bytes)}\n${required.join('\n')}`
}

function normalizeSelectedFiles(fileList) {
  return [...(fileList ?? [])].map(file => {
    const parts = (file.webkitRelativePath || file.name).split('/').filter(Boolean)
    return { file, relativePath: parts.length > 1 ? parts.slice(1).join('/') : parts[0] }
  }).filter(item => item.relativePath && !item.relativePath.split('/').some(segment => segment.startsWith('.')))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

function setSubmissionState(status, message) {
  elements.submitSkill.disabled = status === 'loading'
  elements.submitSkill.dataset.state = status
  elements.submitSkill.textContent = status === 'loading' ? '提交中…' : status === 'success' ? '已提交 ✓' : '提交审核'
  elements.submissionStatus.textContent = message
}

function toBase64(bytes) {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

function node(tag, className = '', text = '') {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text) element.textContent = text
  return element
}

function shortHash(value) {
  return `sha256:${value.slice(0, 10)}…`
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function isPublicHttpUrl(value) {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}
