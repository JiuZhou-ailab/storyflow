# Wangwen BigData

网文大数据 MCP 服务器，提供番茄小说、红果短剧、抖音漫剧等平台的数据查询与分析能力。通过 ClickHouse SQL 查询访问数据。

默认资源不内置 API Key；需要正式查询时，请先在数据源设置里配置可用凭证。

## 可用逻辑表（必须使用 `lg_` 前缀）

| 逻辑表名 | 说明 | 数据域 |
|---|---|---|
| `lg_anime_rank` | 抖音漫剧排行榜 | 漫剧 |
| `lg_douyin_anime_snapshot` | 抖音漫剧快照详情 | 漫剧 |
| `lg_fanqie_novel_snapshot` | 番茄小说榜单快照 | 小说 |
| `lg_hongguo_video_snapshot` | 红果短剧快照详情 | 短剧 |
| `lg_novel_analysis` | 番茄小说深度分析（标签、情绪、人物、故事弧等） | 小说 |
| `lg_novel_tag_detail` | 番茄小说标签明细（按维度拆解） | 小说 |
| `lg_novel_tag_wide` | 番茄小说标签宽表（多维度汇总） | 小说 |
| `lg_novel_to_video` | 小说改编短剧关联表 | 小说+短剧 |
| `lg_video_analysis` | 红果短剧深度分析（标签、情绪、人物、故事弧等） | 短剧 |
| `lg_video_tag_detail` | 红果短剧标签明细（按维度拆解） | 短剧 |
| `lg_video_tag_wide` | 红果短剧标签宽表（多维度汇总） | 短剧 |

## 查询规则

- **只允许 SELECT / WITH 语句**，不支持 SHOW、DESC 等命令
- **表名必须使用 `lg_` 前缀**，原始物理表名不在白名单中
- 系统会自动注入 LIMIT，默认上限 100
- 使用 `format: "json"` 可获取结构化 JSON 输出，适合程序化处理

## 表字段概览

### lg_anime_rank — 抖音漫剧排行榜

| 字段 | 说明 |
|---|---|
| `stat_date` | 统计日期 |
| `rank_name` | 榜单名称（如"抖音热播榜-月榜"） |
| `rank_num` | 排名序号 |
| `series_id` | 漫剧系列ID |
| `series_name` | 漫剧名称 |
| `description` | 漫剧简介 |
| `tags` | 标签（如"逆袭, 架空, 剧情, 系统, 重生"） |
| `subtype` | 类型（2d_animation, 3d_animation, ai_real_narration） |
| `nick_name` | 作者/账号昵称 |
| `episode_count` | 集数 |
| `play_count` | 播放量 |
| `play_inc` | 播放增量 |
| `heat_value` | 热度值 |
| `media` | 平台标识（dy = 抖音） |

### lg_douyin_anime_snapshot — 抖音漫剧快照

| 字段 | 说明 |
|---|---|
| `dt` | 快照日期 |
| `series_id` / `series_name` | 漫剧系列ID/名称 |
| `douyin_id` | 抖音ID |
| `nick_name` | 昵称 |
| `follower_count` / `favorite_count` | 粉丝数/获赞数 |
| `episode_count` | 集数 |
| `play_count` / `like_count` / `comment_count` / `collect_count` / `share_count` | 播放/点赞/评论/收藏/分享数 |
| `play_inc` | 播放增量 |
| `subtype` | 类型（2d_animation 等） |
| `video_tags` | 标签 |
| `video_cover_url` | 封面图URL |

### lg_fanqie_novel_snapshot — 番茄小说榜单快照

核心字段包括：`release_date`（发布日期）、`rank_name` / `rank_type` / `rank_category`（榜单层级）、`rank_num`（排名）、`book_id` / `book_name`（书籍ID/名称）、`abstract`（简介）、`author_name` / `author_level`（作者信息）、`score` / `score_count`（评分）、`word_count` / `word_range`（字数）、`gender`（频道：男频/女频）、`category` / `tags`（分类标签）、`reader_uv_sum_daily` / `reader_uv_14day` / `read_dcnt_30d`（阅读UV数据）、`add_shelf_count_14d`（新增收藏）、`read_10w_rate` ~ `read_100w_rate`（阅读留存率）、`is_related_video` / `video_names` / `video_count`（关联短剧信息）。

### lg_hongguo_video_snapshot — 红果短剧快照

核心字段包括：`release_date`、`series_id` / `video_name`（系列ID/名称）、`category` / `video_tags`（分类标签）、`episode_count` / `episode_range`（集数）、`video_duration`（时长）、`score_fq` / `score_hg`（番茄/红果评分）、`heat_value_fq` / `heat_value_hg`（热度值）、`play_count_fq` / `play_count_hg`（播放量）、`followed_count_fq` / `followed_count_hg`（追剧数）、`actor_ids` / `actor_names` / `role_names` / `actor_info`（演员信息）、`book_id` / `book_name`（原著信息）、`gender` / `genre`（频道/题材）。

### lg_novel_analysis — 番茄小说深度分析

包含 AI 生成的分析数据：
- `core_tags_analysis` — 核心标签分析（受众、氛围标签、故事钩子、世界观标签、金手指等）
- `emotion_conflict_analysis` — 情绪与冲突分析（虐点、爽点、核心冲突、情绪节奏）
- `character_profile_analysis` — 人物画像分析（角色、关系、成长弧线等）
- `story_arc_analysis` — 故事弧线分析（各剧情段落的关键事件）
- `worldview_analysis` — 世界观分析（势力体系、地理、核心规则、力量体系等）
- `golden_three_chapters_analysis` — 黄金三章分析
- `usage` — 分析数据使用量

### lg_novel_tag_detail / lg_novel_tag_wide — 番茄小说标签

- **tag_detail**：按维度拆解（`dimension` + `tag_value`），维度包括 identity_tags、relationship、world_tags、hook_tags、vibe_tags、gold_finger 等
- **tag_wide**：多维度汇总宽表，将各维度标签聚合展示，含 `summary` 概述

### lg_novel_to_video — 小说改编短剧关联

关联小说与短剧/漫剧的改编关系，包含 `video_ids`、`video_names`、`playlet_ids`、`playlet_names`、`ai_video_ids`、`ai_video_names` 等字段。

### lg_video_analysis — 红果短剧深度分析

与 novel_analysis 类似，包含核心标签、情绪冲突、人物画像、故事弧线、世界观分析。

### lg_video_tag_detail / lg_video_tag_wide — 红果短剧标签

与小说标签表结构相同，维度包括 audience、genre、identity_tags、relationship、world_tags、hook_tags、vibe_tags、gold_finger_tags。

## 常用查询示例

### 查看抖音漫剧月榜 Top 10
```sql
SELECT series_name, rank_num, play_count, heat_value, tags, subtype
FROM lg_anime_rank
WHERE rank_name = '抖音热播榜-月榜'
ORDER BY rank_num
LIMIT 10
```

### 查看番茄小说女频新书榜
```sql
SELECT book_name, rank_num, author_name, score, word_count, tags
FROM lg_fanqie_novel_snapshot
WHERE rank_type = 'B端-女频新书榜'
ORDER BY rank_num
LIMIT 20
```

### 查看红果短剧播放量 Top 10
```sql
SELECT video_name, play_count_hg, heat_value_hg, episode_count, video_tags
FROM lg_hongguo_video_snapshot
ORDER BY play_count_hg DESC
LIMIT 10
```

### 查看小说改编短剧情况
```sql
SELECT book_name, video_names, video_num, playlet_names, playlet_num
FROM lg_novel_to_video
WHERE video_num > 0
ORDER BY video_num DESC
LIMIT 20
```

### 查看特定小说的深度分析
```sql
SELECT book_name, core_tags_analysis, emotion_conflict_analysis
FROM lg_novel_analysis
WHERE book_name = '寒门贵子'
LIMIT 1
```

### 查看特定题材的小说标签
```sql
SELECT book_name, audience, genre, identity_tags, relationship, world_tags, hook_tags, vibe_tags, gold_finger_tags, summary
FROM lg_novel_tag_wide
WHERE genre = '古代言情'
LIMIT 20
```

### 查看短剧的人物分析
```sql
SELECT series_name, character_profile_analysis
FROM lg_video_analysis
WHERE series_name = '民间故事'
LIMIT 1
```

## Guidelines

- 查询时注意数据量，先用小 LIMIT 探索再逐步扩大
- 时间字段：大部分表有 `ctime` / `dt` / `release_date` / `stat_date` 等日期字段，可用于时间范围筛选
- 分析类表（novel_analysis / video_analysis）的 JSON 字段较大，建议只 SELECT 需要的字段
- 标签宽表（tag_wide）比明细表（tag_detail）更适合快速概览
- `media` / `platform` 字段标识来源平台：dy=抖音，fq=番茄小说
