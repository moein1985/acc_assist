import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { generatePythonCode } from '../../src/main/services/financialEngine/pythonTemplates'
import { pythonOutputPlanSchema } from '../../src/main/services/financialEngine/types'
import type { PythonOutputPlan } from '../../src/main/services/financialEngine/types'

// ─── S18.13 — Unit tests for Python sandbox components ─────────────────────

describe('S18.7: PythonOutputPlan schema', () => {
  test('valid PythonOutputPlan passes Zod validation', () => {
    const plan: PythonOutputPlan = {
      enabled: true,
      outputType: 'chart',
      chartType: 'line',
      title: 'Sales Trend'
    }
    const result = pythonOutputPlanSchema.safeParse(plan)
    assert.ok(result.success, 'should pass validation')
  })

  test('invalid outputType fails Zod validation', () => {
    const plan = {
      enabled: true,
      outputType: 'invalid_type'
    }
    const result = pythonOutputPlanSchema.safeParse(plan)
    assert.ok(!result.success, 'should fail validation')
  })

  test('missing enabled field fails Zod validation', () => {
    const plan = {
      outputType: 'chart'
    }
    const result = pythonOutputPlanSchema.safeParse(plan)
    assert.ok(!result.success, 'should fail validation')
  })

  test('all output types are valid', () => {
    const types = ['chart', 'excel', 'pdf', 'csv', 'html', 'table']
    for (const outputType of types) {
      const result = pythonOutputPlanSchema.safeParse({
        enabled: true,
        outputType
      })
      assert.ok(result.success, `${outputType} should be valid`)
    }
  })

  test('all chart types are valid', () => {
    const chartTypes = ['line', 'bar', 'pie', 'scatter', 'area', 'heatmap']
    for (const chartType of chartTypes) {
      const result = pythonOutputPlanSchema.safeParse({
        enabled: true,
        outputType: 'chart',
        chartType
      })
      assert.ok(result.success, `${chartType} should be valid`)
    }
  })
})

// ─── S18.9: Template engine tests ──────────────────────────────────────────

describe('S18.9: generatePythonCode', () => {
  test('uses plan.code directly when provided', () => {
    const plan: PythonOutputPlan = {
      enabled: true,
      outputType: 'table',
      code: 'print("custom code")'
    }
    const code = generatePythonCode(plan, 'net_sales')
    assert.equal(code, 'print("custom code")')
  })

  test('generates line chart template', () => {
    const plan: PythonOutputPlan = {
      enabled: true,
      outputType: 'chart',
      chartType: 'line',
      title: 'Sales',
      xAxis: 'year',
      yAxis: 'value'
    }
    const code = generatePythonCode(plan, 'net_sales')
    assert.ok(code.includes('matplotlib'))
    assert.ok(code.includes('ax.plot'))
    assert.ok(code.includes('Sales'))
    assert.ok(code.includes('chart.png'))
  })

  test('generates bar chart template', () => {
    const plan: PythonOutputPlan = {
      enabled: true,
      outputType: 'chart',
      chartType: 'bar',
      title: 'Revenue',
      xAxis: 'month',
      yAxis: 'amount'
    }
    const code = generatePythonCode(plan, 'net_sales')
    assert.ok(code.includes('ax.bar'))
    assert.ok(code.includes('Revenue'))
  })

  test('generates pie chart template', () => {
    const plan: PythonOutputPlan = {
      enabled: true,
      outputType: 'chart',
      chartType: 'pie',
      title: 'Distribution'
    }
    const code = generatePythonCode(plan, 'net_sales')
    assert.ok(code.includes('ax.pie'))
    assert.ok(code.includes('autopct'))
  })

  test('generates scatter chart template', () => {
    const plan: PythonOutputPlan = {
      enabled: true,
      outputType: 'chart',
      chartType: 'scatter',
      title: 'Correlation',
      xAxis: 'x',
      yAxis: 'y'
    }
    const code = generatePythonCode(plan, 'net_sales')
    assert.ok(code.includes('ax.scatter'))
  })

  test('generates area chart template', () => {
    const plan: PythonOutputPlan = {
      enabled: true,
      outputType: 'chart',
      chartType: 'area',
      title: 'Trend',
      xAxis: 'date',
      yAxis: 'value'
    }
    const code = generatePythonCode(plan, 'net_sales')
    assert.ok(code.includes('fill_between'))
  })

  test('generates excel template', () => {
    const plan: PythonOutputPlan = {
      enabled: true,
      outputType: 'excel',
      title: 'Report'
    }
    const code = generatePythonCode(plan, 'net_sales')
    assert.ok(code.includes('to_excel'))
    assert.ok(code.includes('report.xlsx'))
  })

  test('generates pdf template', () => {
    const plan: PythonOutputPlan = {
      enabled: true,
      outputType: 'pdf',
      title: 'PDF Report'
    }
    const code = generatePythonCode(plan, 'net_sales')
    assert.ok(code.includes('reportlab'))
    assert.ok(code.includes('report.pdf'))
  })

  test('generates csv template', () => {
    const plan: PythonOutputPlan = {
      enabled: true,
      outputType: 'csv'
    }
    const code = generatePythonCode(plan, 'net_sales')
    assert.ok(code.includes('to_csv'))
    assert.ok(code.includes('report.csv'))
  })

  test('generates html template', () => {
    const plan: PythonOutputPlan = {
      enabled: true,
      outputType: 'html',
      title: 'HTML Report'
    }
    const code = generatePythonCode(plan, 'net_sales')
    assert.ok(code.includes('to_html'))
    assert.ok(code.includes('report.html'))
  })

  test('generates table template', () => {
    const plan: PythonOutputPlan = {
      enabled: true,
      outputType: 'table'
    }
    const code = generatePythonCode(plan, 'net_sales')
    assert.ok(code.includes('to_dict'))
    assert.ok(code.includes('_output_data'))
  })

  test('default chart type falls back to line', () => {
    const plan: PythonOutputPlan = {
      enabled: true,
      outputType: 'chart',
      chartType: 'heatmap',
      title: 'Test',
      xAxis: 'x',
      yAxis: 'y'
    }
    const code = generatePythonCode(plan, 'net_sales')
    assert.ok(code.includes('ax.plot'), 'heatmap (unsupported) should fall back to line')
  })

  test('all generated code uses _output_files', () => {
    const plans: PythonOutputPlan[] = [
      { enabled: true, outputType: 'chart', chartType: 'line', xAxis: 'x', yAxis: 'y' },
      { enabled: true, outputType: 'excel' },
      { enabled: true, outputType: 'pdf' },
      { enabled: true, outputType: 'csv' },
      { enabled: true, outputType: 'html' },
      { enabled: true, outputType: 'table' }
    ]
    for (const plan of plans) {
      const code = generatePythonCode(plan, 'net_sales')
      assert.ok(code.includes('_output_files'), `${plan.outputType} should set _output_files`)
    }
  })
})

// ─── S18.3: PythonRunnerService tests ──────────────────────────────────────

describe('S18.3: PythonRunnerService', () => {
  test('PythonRunnerService can be imported', async () => {
    const mod = await import('../../src/main/services/pythonRunnerService')
    assert.ok(mod.PythonRunnerService, 'PythonRunnerService should be exported')
    assert.ok(typeof mod.validatePythonCode === 'function', 'validatePythonCode should be exported')
    assert.ok(typeof mod.runPythonCode === 'function', 'runPythonCode should be exported')
  })

  test('PythonRunnerService isAvailable returns boolean', async () => {
    const { PythonRunnerService } = await import('../../src/main/services/pythonRunnerService')
    const runner = new PythonRunnerService()
    const available = runner.isAvailable()
    assert.equal(typeof available, 'boolean')
  })

  test('ALLOWED_IMPORTS includes pandas and matplotlib', async () => {
    const { ALLOWED_IMPORTS } = await import('../../src/main/services/pythonRunnerService')
    assert.ok(ALLOWED_IMPORTS.has('pandas'), 'pandas should be in allowed imports')
    assert.ok(ALLOWED_IMPORTS.has('matplotlib'), 'matplotlib should be in allowed imports')
    assert.ok(ALLOWED_IMPORTS.has('numpy'), 'numpy should be in allowed imports')
  })

  test('BLOCKED_BUILTINS includes eval and exec', async () => {
    const { BLOCKED_BUILTINS } = await import('../../src/main/services/pythonRunnerService')
    assert.ok(BLOCKED_BUILTINS.has('eval'), 'eval should be blocked')
    assert.ok(BLOCKED_BUILTINS.has('exec'), 'exec should be blocked')
    assert.ok(BLOCKED_BUILTINS.has('open'), 'open should be blocked')
  })
})
