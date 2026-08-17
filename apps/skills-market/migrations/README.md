# D1 migrations

`0001_initial.sql` creates publisher identity, Skill metadata, and immutable versions; `0002_ai_review.sql` adds admission evidence; `0003_visibility.sql` separates public and company-scoped discovery; `0004_download_metrics.sql` adds atomic popularity counters; `0005_republish_portable_skill_names.sql` moves four existing Skills to importable immutable versions. Package bytes remain in private R2.
