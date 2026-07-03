# Refusal Analysis Report — 2026-07-03

**Total refusals analyzed:** 8
**Unique clusters:** 5

## Clusters by Frequency (Top 20)

| # | Pattern | Reason | Count | Last Seen | Example |
|---|---------|--------|-------|-----------|---------|
| 1 |  | ambiguous | 2 | 2026-07-03 | قیمت طلا در بازار چقدر است؟ |
| 2 |  | out_of_scope | 2 | 2026-07-03 | قیمت طلا در بازار چقدر است؟ |
| 3 | گردش | no_metric | 2 | 2026-07-03 | گردش حساب [REDACTED:FULL_NAME] فرد ۱۴۰۲ |
| 4 | مانده | ambiguous | 1 | 2026-07-03 | مبلغ ۵۰۰۰۰۰۰ تومان مانده داریم یا نه؟ |
| 5 | مانده | no_metric | 1 | 2026-07-03 | مبلغ ۵۰۰۰۰۰۰ تومان مانده داریم یا نه؟ |

## Summary by Refusal Reason

| Reason | Count | % |
|--------|-------|---|
| ambiguous | 3 | 37.5% |
| no_metric | 3 | 37.5% |
| out_of_scope | 2 | 25.0% |

## Recommendations

### no_metric (2 clusters, 3 refusals)
- Review top patterns for potential new MetricDefinition additions
- Each new metric must be verified via Phase 29 oracle before adding to registry

### ambiguous (2 clusters, 3 refusals)
- Improve planner clarify routing or add anchor/excludeSignal to existing metrics

### out_of_scope (1 clusters, 2 refusals)
- These are healthy refusals (non-financial queries). No action needed.
