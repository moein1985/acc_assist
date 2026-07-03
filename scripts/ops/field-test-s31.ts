/**
 * S31.5-S31.7: Field test script — ask questions via debug endpoint
 * Asks valid financial questions + refusal-triggering questions
 * Then reads audit logs to collect refusal data
 */

const questions = [
  // Valid financial questions (should succeed)
  { id: 'q1', prompt: 'فروش ۱۴۰۲ چقدر است؟', expect: 'ok' },
  { id: 'q2', prompt: 'ترازنامه ۱۴۰۲', expect: 'ok' },
  { id: 'q3', prompt: 'سود خالص ۱۴۰۲', expect: 'ok' },
  { id: 'q4', prompt: 'مانده بانکی ۱۴۰۲', expect: 'ok' },
  { id: 'q5', prompt: 'هزینه‌های پرسنلی ۱۴۰۲', expect: 'ok' },
  { id: 'q6', prompt: 'دریافتنی‌های ۱۴۰۲', expect: 'ok' },
  { id: 'q7', prompt: 'پرداختنی‌های ۱۴۰۲', expect: 'ok' },
  { id: 'q8', prompt: 'بهای تمام شده ۱۴۰۲', expect: 'ok' },

  // Out-of-scope questions (should refuse with out_of_scope)
  { id: 'q9', prompt: 'هوای تهران امروز چطور است؟', expect: 'refuse' },
  { id: 'q10', prompt: 'قیمت طلا در بازار چقدر است؟', expect: 'refuse' },
  { id: 'q11', prompt: 'تعداد کارمندان شرکت چقدر است؟', expect: 'refuse' },
  { id: 'q12', prompt: 'چطور فاکتور ثبت کنم در سپیدار؟', expect: 'refuse' },

  // Ambiguous questions (should refuse with ambiguous or clarify)
  { id: 'q13', prompt: 'سود چقدره؟', expect: 'refuse' },
  { id: 'q14', prompt: 'مقایسه کن', expect: 'refuse' },

  // Edge cases that might trigger no_metric
  { id: 'q15', prompt: 'بیمه حقوق پرسنل ۱۴۰۲ چقدر است؟', expect: 'refuse' },
  { id: 'q16', prompt: 'استهلاک ماشین‌آلات ۱۴۰۲', expect: 'ok-or-refuse' },
  { id: 'q17', prompt: 'نرخ بازده سرمایه‌گذاری ۱۴۰۲', expect: 'refuse' },
  { id: 'q18', prompt: 'گردش حساب آقای معین محسنی فرد ۱۴۰۲', expect: 'ok' },

  // PII test — name should be masked in audit
  { id: 'q19', prompt: 'مانده حساب آقای علی رضایی ۱۴۰۲ چقدر است؟', expect: 'ok-or-refuse' },

  // Financial amount PII test
  { id: 'q20', prompt: 'مبلغ ۵۰۰۰۰۰۰ تومان مانده داریم یا نه؟', expect: 'refuse' },
]

async function askQuestion(prompt: string, id: string): Promise<any> {
  const body = JSON.stringify({
    prompt,
    requestId: `s31-${id}-${Date.now()}`,
    conversationId: 's31-field-test'
  })

  const resp = await fetch('http://127.0.0.1:3322/ask', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-debug-token': 'testtoken31'
    },
    body
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`HTTP ${resp.status}: ${text}`)
  }

  return resp.json()
}

async function main(): Promise<void> {
  console.log('=== S31 Field Test: Asking questions via debug endpoint ===\n')

  const results: Array<{ id: string; prompt: string; ok: boolean; textLen: number; textPreview: string; error?: string }> = []

  for (const q of questions) {
    process.stdout.write(`[${q.id}] Asking: ${q.prompt} ... `)
    try {
      const data = await askQuestion(q.prompt, q.id)
      const text = data.result?.finalText ?? ''
      const ok = data.ok === true
      const textLen = text.length
      const textPreview = text.slice(0, 120).replace(/\n/g, ' ')

      console.log(`${ok ? 'OK' : 'FAIL'} (len=${textLen})`)
      console.log(`  → ${textPreview}...`)

      results.push({ id: q.id, prompt: q.prompt, ok, textLen, textPreview })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.log(`ERROR: ${errorMsg}`)
      results.push({ id: q.id, prompt: q.prompt, ok: false, textLen: 0, textPreview: '', error: errorMsg })
    }

    // Small delay between questions
    await new Promise(r => setTimeout(r, 1500))
  }

  console.log('\n=== Summary ===')
  const okCount = results.filter(r => r.ok && !r.error).length
  const failCount = results.filter(r => !r.ok || r.error).length
  console.log(`OK: ${okCount}/${results.length}`)
  console.log(`FAIL/REFUSE: ${failCount}/${results.length}`)

  // Write results to file for analysis
  const { writeFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const outputPath = join(process.cwd(), 'ops', 's31-field-test-results.json')
  writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf8')
  console.log(`\nResults saved to: ${outputPath}`)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
