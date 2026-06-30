/**
 * S21.4-S21.5 — Interactive Chart.js integration + auto-selection
 */
import {
  Chart,
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  PieController,
  DoughnutController,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  Title,
  type ChartConfiguration,
  type ChartType
} from 'chart.js'

Chart.register(
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  PieController,
  DoughnutController,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  Title
)

export interface ChartSeriesData {
  labels: string[]
  values: number[]
  dimensionColumn: string
  metricColumn: string
  sourceTool: string
}

let activeChart: Chart | null = null

/**
 * S21.5 — Auto-select chart type based on data characteristics
 */
export function autoSelectChartType(data: ChartSeriesData): ChartType {
  const { labels, values } = data

  // Pie/doughnut for percentage-like data (all positive, sum ~100, <=6 categories)
  if (labels.length <= 6 && values.every((v) => v > 0)) {
    const sum = values.reduce((a, b) => a + b, 0)
    if (sum > 0 && values.every((v) => v / sum <= 0.5)) {
      return 'doughnut'
    }
  }

  // Line chart for time-series (labels look like years/months)
  const yearLike = labels.every((l) => /^\d{4}$/.test(l.trim()) || /^(14|13)\d{2}$/.test(l.trim()))
  const monthLike = labels.every((l) => /^(فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند)/.test(l.trim()))
  if (yearLike || monthLike) {
    return 'line'
  }

  // Bar chart for comparison (default)
  return 'bar'
}

/**
 * S21.4 — Render interactive chart on canvas
 */
export function renderInteractiveChart(
  canvas: HTMLCanvasElement,
  data: ChartSeriesData,
  chartType?: ChartType | 'auto'
): void {
  if (activeChart) {
    activeChart.destroy()
    activeChart = null
  }

  const type: ChartType = chartType === 'auto' || !chartType
    ? autoSelectChartType(data)
    : chartType

  const isCircular = type === 'pie' || type === 'doughnut'

  const config: ChartConfiguration = {
    type,
    data: {
      labels: data.labels,
      datasets: [
        {
          label: `${data.metricColumn} (${data.dimensionColumn})`,
          data: data.values,
          backgroundColor: isCircular
            ? generateColorPalette(data.values.length)
            : 'rgba(24, 128, 160, 0.7)',
          borderColor: isCircular
            ? generateColorPalette(data.values.length)
            : 'rgba(15, 109, 140, 1)',
          borderWidth: 1,
          tension: 0.3,
          fill: type === 'line' ? false : undefined
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        tooltip: {
          enabled: true,
          rtl: true,
          callbacks: {
              label: (ctx) => {
              const value = ctx.parsed.y ?? ctx.parsed
              return `${data.metricColumn}: ${formatNumber(value)}`
            }
          }
        },
        legend: {
          display: true,
          position: 'top',
          labels: { font: { size: 11 } }
        }
      },
      scales: isCircular
        ? {}
        : {
            x: {
              title: { display: true, text: data.dimensionColumn, font: { size: 11 } },
              ticks: { font: { size: 10 } }
            },
            y: {
              title: { display: true, text: data.metricColumn, font: { size: 11 } },
              ticks: { font: { size: 10 } },
              beginAtZero: true
            }
          }
    }
  }

  activeChart = new Chart(canvas, config)
}

/**
 * S21.4 — Export chart as PNG image
 */
export function exportChartAsPng(): string | null {
  if (!activeChart) {
    return null
  }
  return activeChart.toBase64Image('image/png', 1)
}

/**
 * Destroy active chart (cleanup)
 */
export function destroyChart(): void {
  if (activeChart) {
    activeChart.destroy()
    activeChart = null
  }
}

function generateColorPalette(count: number): string[] {
  const colors = [
    'rgba(24, 128, 160, 0.8)',
    'rgba(59, 130, 246, 0.8)',
    'rgba(139, 92, 246, 0.8)',
    'rgba(236, 72, 153, 0.8)',
    'rgba(245, 158, 11, 0.8)',
    'rgba(16, 185, 129, 0.8)',
    'rgba(239, 68, 68, 0.8)',
    'rgba(168, 85, 247, 0.8)',
    'rgba(20, 184, 166, 0.8)',
    'rgba(132, 204, 22, 0.8)'
  ]
  return Array.from({ length: count }, (_, i) => colors[i % colors.length])
}

function formatNumber(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) {
    return (value / 1_000_000_000).toFixed(2) + 'B'
  }
  if (Math.abs(value) >= 1_000_000) {
    return (value / 1_000_000).toFixed(2) + 'M'
  }
  if (Math.abs(value) >= 1_000) {
    return (value / 1_000).toFixed(1) + 'K'
  }
  return value.toLocaleString('en-US')
}
