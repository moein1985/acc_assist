import type { PythonOutputPlan } from './types'

// ---------------------------------------------------------------------------
// S18.9 — Template engine for default Python code generation
// ---------------------------------------------------------------------------

/**
 * Generate Python code from a PythonOutputPlan.
 * If plan.code is present, use it directly.
 * Otherwise, generate code based on outputType and chartType.
 */
export function generatePythonCode(plan: PythonOutputPlan, metricId: string): string {
  if (plan.code) return plan.code
  void metricId // reserved for future metric-specific templates

  switch (plan.outputType) {
    case 'chart':
      return generateChartTemplate(plan)
    case 'excel':
      return generateExcelTemplate(plan)
    case 'pdf':
      return generatePdfTemplate(plan)
    case 'csv':
      return generateCsvTemplate(plan)
    case 'html':
      return generateHtmlTemplate(plan)
    case 'table':
      return generateTableTemplate(plan)
    default:
      return generateTableTemplate(plan)
  }
}

function generateChartTemplate(plan: PythonOutputPlan): string {
  const title = plan.title || 'نمودار'
  const xLabel = plan.xAxis || 'X'
  const yLabel = plan.yAxis || 'Y'

  switch (plan.chartType) {
    case 'line':
      return [
        'import matplotlib.pyplot as plt',
        'import pandas as pd',
        '',
        'df = pd.DataFrame(rows)',
        'fig, ax = plt.subplots(figsize=(10, 6))',
        `ax.plot(df['${xLabel}'], df['${yLabel}'], marker='o', linewidth=2)`,
        `ax.set_title('${title}')`,
        `ax.set_xlabel('${xLabel}')`,
        `ax.set_ylabel('${yLabel}')`,
        'ax.grid(True, alpha=0.3)',
        'plt.tight_layout()',
        "plt.savefig(output_dir + '/chart.png', dpi=150)",
        "_output_files = ['chart.png']"
      ].join('\n')

    case 'bar':
      return [
        'import matplotlib.pyplot as plt',
        'import pandas as pd',
        '',
        'df = pd.DataFrame(rows)',
        'fig, ax = plt.subplots(figsize=(10, 6))',
        `ax.bar(df['${xLabel}'], df['${yLabel}'], color='#4a90d9')`,
        `ax.set_title('${title}')`,
        `ax.set_xlabel('${xLabel}')`,
        `ax.set_ylabel('${yLabel}')`,
        'plt.tight_layout()',
        "plt.savefig(output_dir + '/chart.png', dpi=150)",
        "_output_files = ['chart.png']"
      ].join('\n')

    case 'pie':
      return [
        'import matplotlib.pyplot as plt',
        'import pandas as pd',
        '',
        'df = pd.DataFrame(rows)',
        'fig, ax = plt.subplots(figsize=(8, 8))',
        `ax.pie(df['${yLabel}'], labels=df['${xLabel}'], autopct='%1.1f%%', startangle=90)`,
        `ax.set_title('${title}')`,
        'plt.tight_layout()',
        "plt.savefig(output_dir + '/chart.png', dpi=150)",
        "_output_files = ['chart.png']"
      ].join('\n')

    case 'scatter':
      return [
        'import matplotlib.pyplot as plt',
        'import pandas as pd',
        '',
        'df = pd.DataFrame(rows)',
        'fig, ax = plt.subplots(figsize=(10, 6))',
        `ax.scatter(df['${xLabel}'], df['${yLabel}'], alpha=0.6)`,
        `ax.set_title('${title}')`,
        `ax.set_xlabel('${xLabel}')`,
        `ax.set_ylabel('${yLabel}')`,
        'ax.grid(True, alpha=0.3)',
        'plt.tight_layout()',
        "plt.savefig(output_dir + '/chart.png', dpi=150)",
        "_output_files = ['chart.png']"
      ].join('\n')

    case 'area':
      return [
        'import matplotlib.pyplot as plt',
        'import pandas as pd',
        '',
        'df = pd.DataFrame(rows)',
        'fig, ax = plt.subplots(figsize=(10, 6))',
        `ax.fill_between(df['${xLabel}'], df['${yLabel}'], alpha=0.3)`,
        `ax.plot(df['${xLabel}'], df['${yLabel}'], linewidth=2)`,
        `ax.set_title('${title}')`,
        `ax.set_xlabel('${xLabel}')`,
        `ax.set_ylabel('${yLabel}')`,
        'ax.grid(True, alpha=0.3)',
        'plt.tight_layout()',
        "plt.savefig(output_dir + '/chart.png', dpi=150)",
        "_output_files = ['chart.png']"
      ].join('\n')

    default:
      return [
        'import matplotlib.pyplot as plt',
        'import pandas as pd',
        '',
        'df = pd.DataFrame(rows)',
        'fig, ax = plt.subplots(figsize=(10, 6))',
        `ax.plot(df['${xLabel}'], df['${yLabel}'], marker='o')`,
        `ax.set_title('${title}')`,
        'plt.tight_layout()',
        "plt.savefig(output_dir + '/chart.png', dpi=150)",
        "_output_files = ['chart.png']"
      ].join('\n')
  }
}

function generateExcelTemplate(plan: PythonOutputPlan): string {
  const title = plan.title || 'گزارش'
  return [
    'import pandas as pd',
    '',
    'df = pd.DataFrame(rows)',
    "df.to_excel(output_dir + '/report.xlsx', index=False, sheet_name='" + title + "')",
    "_output_files = ['report.xlsx']"
  ].join('\n')
}

function generatePdfTemplate(plan: PythonOutputPlan): string {
  const title = plan.title || 'گزارش'
  return [
    'from reportlab.lib.pagesizes import A4',
    'from reportlab.platypus import SimpleDocTemplate, Table, Paragraph, Spacer',
    'from reportlab.lib.styles import getSampleStyleSheet',
    'import pandas as pd',
    '',
    'df = pd.DataFrame(rows)',
    "doc = SimpleDocTemplate(output_dir + '/report.pdf', pagesize=A4)",
    'styles = getSampleStyleSheet()',
    'elements = []',
    "elements.append(Paragraph('" + title + "', styles['Title']))",
    'elements.append(Spacer(1, 12))',
    '',
    'cols = list(df.columns)',
    'data = [cols] + df.values.tolist()',
    'table = Table(data)',
    'table.setStyle([("GRID", (0,0), (-1,-1), 0.5, "grey"), ("FONTSIZE", (0,0), (-1,0), 10)])',
    'elements.append(table)',
    'doc.build(elements)',
    "_output_files = ['report.pdf']"
  ].join('\n')
}

function generateCsvTemplate(plan: PythonOutputPlan): string {
  void plan
  return [
    'import pandas as pd',
    '',
    'df = pd.DataFrame(rows)',
    "df.to_csv(output_dir + '/report.csv', index=False, encoding='utf-8-sig')",
    "_output_files = ['report.csv']"
  ].join('\n')
}

function generateHtmlTemplate(plan: PythonOutputPlan): string {
  const title = plan.title || 'گزارش'
  return [
    'import pandas as pd',
    '',
    'df = pd.DataFrame(rows)',
    "html = df.to_html(index=False, border=1, classes='table table-striped')",
    `full_html = '<html><head><meta charset="utf-8"><title>${title}</title></head><body><h2>${title}</h2>' + html + '</body></html>'`,
    "with open(output_dir + '/report.html', 'w', encoding='utf-8') as f:",
    '    f.write(full_html)',
    "_output_files = ['report.html']"
  ].join('\n')
}

function generateTableTemplate(plan: PythonOutputPlan): string {
  void plan
  return [
    'import pandas as pd',
    '',
    'df = pd.DataFrame(rows)',
    '_output_data = df.to_dict(orient="records")',
    '_output_files = []'
  ].join('\n')
}
