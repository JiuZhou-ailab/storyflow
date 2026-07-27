# Screenplay format and quality contract

## Exact Markdown form

Write each `scripts/NNN.md` as:

```markdown
# 第 1 集｜本集标题

> 本集概要：一到两句说明本集触发、选择和结果。

## 1-1 地点 内 夜

人物：林夏、周远

▲ 林夏停在门前，攥紧钥匙。

林夏（低声）：我回来了。

林夏 [OS]：只要推开这扇门，一切就再也回不去了。

旁白 [VO]：三年前，她也是在这样的雨夜离开。
```

Rules:

- Use `# 第 N 集｜标题` once.
- Use `## N-M 地点 内/外 时间` for each scene.
- Number scenes consecutively from `N-1`.
- Put `人物：` immediately after each scene heading.
- Start visible action with `▲`.
- Write dialogue as `角色（可选语气）：台词`.
- Use `[OS]` only for the character's unspoken immediate thought.
- Use `[VO]` for narration, remembered narration, telephone/radio/recording
  heard off screen, or another non-immediate-thought voice.
- Keep ordinary spoken dialogue unmarked.
- Use `【闪回】` and `【闪出】` as paired standalone lines.

Speaker and scene-character labels use explicit names or identities. They must
not be “我、你、他、她、它” or other pronouns. Non-named groups use stable
numbered labels such as `工作人员1`.

Dialogue text is different from its label: keep natural “我、你” and forms of
address inside the spoken content.

## Deterministic validation

Run:

```bash
python3 scripts/screenplay_project.py validate PROJECT_DIR EPISODE_INDEX
```

The validator checks:

- episode and scene numbering;
- required scene headings and character lists;
- action/dialogue placement;
- speaker membership in the scene;
- pronoun speaker labels;
- paired flashback markers;
- conversion-mode length budget.

Fix every `error`. Review each `warning`; a length warning may remain when
necessary causality or context justifies it.

## Semantic review

The local validator cannot judge story truth. Review manually:

### Causality

- Every choice has a visible pressure or motive.
- Every reversal has setup.
- Every consequence follows an action or revelation.
- Removed prose did not remove a required causal bridge.

### Character continuity

- Goals, knowledge, relationships, injuries, possessions, locations, and
  speech patterns agree with `continuity.md`.
- A character does not know information before learning it.
- Names and identity labels remain stable.

### Shootability

- Internal narration has been externalized where possible.
- Actions are playable and visible.
- Scenes do not exist only to restate information.
- Locations and time changes are explicit.

### Dialogue

- Each line performs pressure, concealment, testing, attack, defense, choice,
  reversal, or relationship change.
- Characters retain distinct voices.
- Exposition sounds motivated rather than delivered for the audience.

### Episode ending

- The ending visibly changes risk, goal, information, relationship, or
  consequence.
- Its setup exists earlier in the episode.

Only mark an episode complete after deterministic and semantic review both
pass.
