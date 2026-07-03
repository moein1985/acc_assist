# Refusal Analysis Report — 2026-07-03

**Total refusals analyzed:** 5
**Unique clusters:** 5

## Clusters by Frequency (Top 20)

| # | Pattern | Reason | Count | Last Seen | Example |
|---|---------|--------|-------|-----------|---------|
| 1 | ترازنامه | no_metric | 1 | 2026-07-03 | ترازنامه ۱۴۰۲ |
| 2 | طلا+قیمت | out_of_scope | 1 | 2026-07-03 | قیمت طلا در بازار چقدر است؟ |
| 3 | تعداد+کارمندان | out_of_scope | 1 | 2026-07-03 | تعداد کارمندان شرکت چقدر است؟ |
| 4 | گردش | no_metric | 1 | 2026-07-03 | گردش حساب [REDACTED:FULL_NAME] فرد ۱۴۰۲ |
| 5 | مانده | no_metric | 1 | 2026-07-03 | [REDACTED:AMOUNT] تومان مانده داریم یا نه؟ |

## Summary by Refusal Reason

| Reason | Count | % |
|--------|-------|---|
| no_metric | 3 | 60.0% |
| out_of_scope | 2 | 40.0% |

## Recommendations

### no_metric (3 clusters, 3 refusals)
- Review top patterns for potential new MetricDefinition additions
- Each new metric must be verified via Phase 29 oracle before adding to registry

### out_of_scope (2 clusters, 2 refusals)
- These are healthy refusals (non-financial queries). No action needed.
