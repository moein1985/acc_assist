Compacted conversationدرخواستت کاملاً مشخص است؛ الان روی سه بخش همزمان کار می‌کنم: تقویت SYSTEM_PROMPT با schema مالی، افزودن tool جدید `get_database_schema` با اجرای واقعی در چرخه ابزار، و اضافه‌کردن دکمه dry-run در UI چت.

الان قبل از ویرایش، ساختار فعلی UI چت را می‌خوانم تا دکمه dry-run را دقیقاً در همان الگوی فعلی اضافه کنم و رفتار قبلی شکسته نشود.

Read [](file:///c%3A/Users/Moein/Documents/Codes/ACC%20Assist/src/renderer/index.html#1-1), lines 1 to 320

Read [](file:///c%3A/Users/Moein/Documents/Codes/ACC%20Assist/src/renderer/index.html#321-321), lines 321 to 411

اکنون منطق chat renderer را باز می‌کنم تا eventها و flow ارسال پرامپت را بدون شکستن رفتار فعلی به dry-run تعمیم دهم.

Read [](file:///c%3A/Users/Moein/Documents/Codes/ACC%20Assist/src/renderer/src/renderer.ts#1-1), lines 1 to 220

Read [](file:///c%3A/Users/Moein/Documents/Codes/ACC%20Assist/src/renderer/src/renderer.ts#221-221), lines 221 to 520

Read [](file:///c%3A/Users/Moein/Documents/Codes/ACC%20Assist/src/renderer/assets/main.css#1-1), lines 1 to 260

Read [](file:///c%3A/Users/Moein/Documents/Codes/ACC%20Assist/src/renderer/assets/main.css#261-261), lines 261 to 407

ساختار فعلی بررسی شد؛ الان پچ اصلی را اعمال می‌کنم: ارتقای prompt، افزودن tool جدید schema، و اتصال دکمه dry-run به جریان واقعی ابزارها در renderer.

Generating patch (391 lines) in [](file:///c%3A/Users/Moein/Documents/Codes/ACC%20Assist/src/renderer/src/renderer.ts)


```

```


Generating patch (47 lines) in [](file:///c%3A/Users/Moein/Documents/Codes/ACC%20Assist/src/renderer/index.html)


```

```
پچ‌ها اعمال شدند؛ الان typecheck می‌گیرم تا مطمئن شویم ابزار جدید، dry-run UI و prompt توسعه‌یافته بدون هیچ خطای TypeScript بالا می‌آیند.

Ran terminal command: Set-Location "c:\Users\Moein\Documents\Codes\ACC Assist"; npm run typecheck
Completed with input: Set-Location "c:\Users\Moein\Documents\Codes\ACC Assist"; npm run typecheck

Generating patch (11 lines) in [](file:///c%3A/Users/Moein/Documents/Codes/ACC%20Assist/src/renderer/src/renderer.ts)


```

```


Ran terminal command: Set-Location "c:\Users\Moein\Documents\Codes\ACC Assist"; npm run typecheck

Checked workspace, no problems found

تغییرات کامپایل‌پسند شدند؛ الان خطوط دقیق بخش‌های اضافه‌شده را استخراج می‌کنم تا کد نهایی را دقیق و قابل ردیابی تحویلت بدهم.

Searched for regex `FINANCIAL_SCHEMA_GUIDE|RESPONSE_POLICY_GUIDE|SYSTEM_PROMPT|DRY_RUN_PROMPT|get_database_schema|runDryRunBtn|runDryRunDiagnostic|submitChatPrompt|buildDatabaseSchemaQuery` (`**/src/renderer/src/renderer.ts`), 20 results

Searched for regex `runDryRunBtn|/dry-run|Dry-run Tool Flow` (`**/src/renderer/index.html`), 3 results

Searched for regex `async function executeFinancialToolCalls|fetch_financial_data|get_database_schema|buildDatabaseSchemaQuery|readRequiredStringArg|readOptionalStringArg|createToolResponseMessage` (`**/src/renderer/src/renderer.ts`), 20 results

Searched for regex `function buildDatabaseSchemaQuery|function escapeSqlStringLiteral|function readRequiredStringArg|function readOptionalStringArg` (`**/src/renderer/src/renderer.ts`), 4 results

Read [](file:///c%3A/Users/Moein/Documents/Codes/ACC%20Assist/src/renderer/src/renderer.ts#1-1), lines 1 to 130

Read [](file:///c%3A/Users/Moein/Documents/Codes/ACC%20Assist/src/renderer/src/renderer.ts#160-160), lines 160 to 390

Read [](file:///c%3A/Users/Moein/Documents/Codes/ACC%20Assist/src/renderer/src/renderer.ts#430-430), lines 430 to 650

Read [](file:///c%3A/Users/Moein/Documents/Codes/ACC%20Assist/src/renderer/index.html#360-360), lines 360 to 429

Searched for regex `btn-compact|chat-actions` (`**/src/renderer/index.html`), 4 results

تغییرات کامل اعمال شد و کامپایل هم تمیز است.
وضعیت بررسی: npm run typecheck با خروجی موفق.

مرجع تغییرات:
- renderer.ts
- index.html

1. بخش SYSTEM_PROMPT بهینه‌شده + ابزار جدید get_database_schema
مرجع: renderer.ts

~~~ts
const FINANCIAL_SCHEMA_GUIDE = [
  'Database schema context (logical map; verify actual tables and columns before final SELECT):',
  '- Accounts / Chart of Accounts: account_id, account_code (کل/معین/تفضیلی), account_name, account_type, parent_account_id, is_active',
  '- Documents / Voucher Headers: document_id, document_no, document_date, fiscal_year, branch_id, status',
  '- Ledger / Journal Lines: line_id, document_id, account_id, debit_amount, credit_amount, line_description, cost_center_id',
  '- Transactions / Cashflow: transaction_id, transaction_date, amount, direction, account_id, counterparty_id, reference_no',
  '- Parties / Counterparties: party_id, party_code, party_name, category, national_id',
  '- Optional dimensions: project_id, cost_center_id, currency_code, exchange_rate, tax_amount',
  'Date and type handling policy:',
  '- Always identify if dates are Gregorian (DATE/DATETIME) or Shamsi/Persian text values before filtering.',
  '- For Shamsi text dates (e.g. 1403/01/15), keep format-consistent comparisons and avoid unsafe casts.',
  '- For Gregorian datetime columns, use precise range predicates and explicit ORDER BY.',
  '- Validate numeric/text code types (especially account codes) before joins or predicates.'
].join('\n')

const RESPONSE_POLICY_GUIDE = [
  'Tool usage and reporting policy:',
  '- Always use tools when data is required. Never invent rows, totals, or schema fields.',
  '- If unsure about columns or table names, call get_database_schema first, then build the SELECT query.',
  '- Analyze tool responses carefully before writing conclusions or recommendations.',
  '- Return final answers in clean Markdown with sections: Summary, Findings, Evidence, Actions.',
  '- When trend data exists, include a compact text chart (ASCII) plus a short interpretation.',
  '- Explicitly state assumptions about date format, account-code level, and currency.'
].join('\n')

const SYSTEM_PROMPT = [
  'You are ACC Assist, an enterprise financial analyst assistant specialized in SQL Server financial databases.',
  'You can use these tools: fetch_financial_data(sql_query) and get_database_schema(table_name, schema_name?).',
  'Use only read-only SELECT/CTE SELECT queries. Never request UPDATE/DELETE/INSERT/DDL statements.',
  'Before generating SQL, reason about data types, date calendar format (Shamsi vs Gregorian), and account code hierarchy.',
  FINANCIAL_SCHEMA_GUIDE,
  RESPONSE_POLICY_GUIDE
].join('\n\n')

const DRY_RUN_PROMPT =
  'لیست ۵ تراکنش آخر دیتابیس را تحلیل کن. اگر درباره نام جدول یا ستون مطمئن نیستی ابتدا get_database_schema را اجرا کن، سپس از fetch_financial_data استفاده کن و خروجی نهایی را به صورت Markdown با جدول شواهد و نمودار متنی خلاصه ارائه بده.'

const FINANCIAL_TOOLS: GeminiToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'fetch_financial_data',
      description:
        'Execute a read-only SQL SELECT query on the configured SQL Server financial database and return serialized rows.',
      parameters: {
        type: 'object',
        properties: {
          sql_query: {
            type: 'string',
            description:
              'Read-only SQL query. Must be SELECT/CTE SELECT only. Example: SELECT TOP 50 date, amount FROM Ledger ORDER BY date DESC'
          }
        },
        required: ['sql_query'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_database_schema',
      description:
        'Fetch SQL Server table schema metadata (columns, types, nullability, order) for a target table to help build correct SELECT queries.',
      parameters: {
        type: 'object',
        properties: {
          table_name: {
            type: 'string',
            description: 'Target table name to inspect. Example: Ledger or Acc_DocumentLines'
          },
          schema_name: {
            type: 'string',
            description: 'Optional schema name. Example: dbo'
          }
        },
        required: ['table_name'],
        additionalProperties: false
      }
    }
  }
]
~~~

2. Dry-run تشخیصی واقعی در Chat Renderer
مرجع: renderer.ts

~~~ts
async function sendChatPrompt(): Promise<void> {
  const prompt = ui.promptInput.value.trim()

  if (prompt === '/dry-run' || prompt === '/diag') {
    await runDryRunDiagnostic()
    return
  }

  await submitChatPrompt(prompt, 'manual')
}

async function runDryRunDiagnostic(): Promise<void> {
  await submitChatPrompt(DRY_RUN_PROMPT, 'dry-run')
}

async function submitChatPrompt(prompt: string, mode: 'manual' | 'dry-run'): Promise<void> {
  if (!prompt) {
    setAppNotice('Prompt is empty.', 'error')
    return
  }

  appendChatMessage('user', prompt, false)
  state.chatHistory.push({ role: 'user', content: prompt })
  trimChatHistory()
  ui.promptInput.value = ''

  toggleButton(ui.sendPromptBtn, true, mode === 'dry-run' ? 'Running Dry-run...' : 'Analyzing...')
  toggleButton(ui.runDryRunBtn, true, mode === 'dry-run' ? 'Running...' : 'Dry-run Tool Flow')
  setChatToolState(
    true,
    mode === 'dry-run'
      ? 'Dry-run: در حال بررسی کامل مسیر Gemini -> Tool Call -> SQL -> Gemini...'
      : 'در حال ارسال درخواست به هوش مصنوعی...'
  )

  try {
    const result = await resolveAssistantResponseWithTools()

    state.chatHistory = result.history
    trimChatHistory()

    appendChatMessage('assistant', result.finalText, true)
    setAppNotice(
      mode === 'dry-run' ? 'Dry-run completed. End-to-end tool flow is operational.' : 'AI response received.',
      'success'
    )
  } catch (error) {
    const message = toFriendlyChatError(error instanceof Error ? error.message : String(error))
    appendChatMessage('assistant', `### Request failed\n${message}`, true)
    setAppNotice(message, 'error')
  } finally {
    toggleButton(ui.sendPromptBtn, false, 'Send to Gemini')
    toggleButton(ui.runDryRunBtn, false, 'Dry-run Tool Flow')
    setChatToolState(false)
  }
}
~~~

3. منطق اجرای Tool جدید در executeFinancialToolCalls
مرجع: renderer.ts

~~~ts
async function executeFinancialToolCalls(toolCalls: GeminiToolCall[]): Promise<GeminiMessage[]> {
  const toolMessages: GeminiMessage[] = []

  for (const toolCall of toolCalls) {
    const toolName = toolCall.function.name

    try {
      const args = parseToolArguments(toolCall.function.arguments)

      if (toolName === 'fetch_financial_data') {
        const sqlQuery = readRequiredStringArg(args, 'sql_query', 16000)

        const queryResult = await window.api.sql.executeQuery(sqlQuery)
        if (!queryResult.ok || !queryResult.data) {
          toolMessages.push(
            createToolResponseMessage(toolCall, {
              ok: false,
              error: queryResult.error ?? 'Database query execution failed.'
            })
          )
          continue
        }

        const rows = queryResult.data
        const boundedRows = rows.slice(0, MAX_TOOL_ROWS)

        toolMessages.push(
          createToolResponseMessage(toolCall, {
            ok: true,
            row_count: rows.length,
            truncated: rows.length > boundedRows.length,
            rows: boundedRows
          })
        )
        continue
      }

      if (toolName === 'get_database_schema') {
        const tableName = readRequiredStringArg(args, 'table_name', 128)
        const schemaName = readOptionalStringArg(args, 'schema_name', 128)
        const schemaQuery = buildDatabaseSchemaQuery(tableName, schemaName)

        const schemaResult = await window.api.sql.executeQuery(schemaQuery)
        if (!schemaResult.ok || !schemaResult.data) {
          toolMessages.push(
            createToolResponseMessage(toolCall, {
              ok: false,
              error: schemaResult.error ?? 'Schema lookup query failed.'
            })
          )
          continue
        }

        const rows = schemaResult.data
        const boundedRows = rows.slice(0, MAX_SCHEMA_ROWS)

        toolMessages.push(
          createToolResponseMessage(toolCall, {
            ok: true,
            table_name: tableName,
            schema_name: schemaName ?? null,
            row_count: rows.length,
            truncated: rows.length > boundedRows.length,
            rows: boundedRows
          })
        )
        continue
      }

      toolMessages.push(
        createToolResponseMessage(toolCall, {
          ok: false,
          error: `Unsupported tool requested: ${toolName}`
        })
      )
    } catch (error) {
      toolMessages.push(
        createToolResponseMessage(toolCall, {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
      )
    }
  }

  return toolMessages
}

function createToolResponseMessage(toolCall: GeminiToolCall, payload: Record<string, unknown>): GeminiMessage {
  return {
    role: 'tool',
    name: toolCall.function.name,
    toolCallId: toolCall.id,
    content: JSON.stringify(payload)
  }
}

function buildDatabaseSchemaQuery(tableName: string, schemaName: string | null): string {
  const tableValue = escapeSqlStringLiteral(tableName)
  const schemaFilter = schemaName
    ? `  AND c.TABLE_SCHEMA = N'${escapeSqlStringLiteral(schemaName)}'\n`
    : ''

  return `SELECT
  c.TABLE_SCHEMA AS table_schema,
  c.TABLE_NAME AS table_name,
  c.ORDINAL_POSITION AS ordinal_position,
  c.COLUMN_NAME AS column_name,
  c.DATA_TYPE AS data_type,
  c.CHARACTER_MAXIMUM_LENGTH AS character_maximum_length,
  c.NUMERIC_PRECISION AS numeric_precision,
  c.NUMERIC_SCALE AS numeric_scale,
  c.DATETIME_PRECISION AS datetime_precision,
  c.IS_NULLABLE AS is_nullable,
  COLUMNPROPERTY(OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME)), c.COLUMN_NAME, 'IsIdentity') AS is_identity
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.TABLE_NAME = N'${tableValue}'
${schemaFilter}ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION`
}
~~~

4. دکمه Dry-run در UI چت
مرجع: index.html

~~~html
<div class="row chat-actions">
  <button
    id="runDryRunBtn"
    class="btn btn-compact"
    type="button"
    title="Run end-to-end diagnostic: Gemini -> Tool Call -> SQL -> Gemini"
  >
    Dry-run Tool Flow
  </button>
  <button id="sendPromptBtn" class="btn btn-primary" type="button">Send to Gemini</button>
</div>
~~~

و همچنین استایل/هینت اضافه شده:
- index.html
- index.html

اگر بخواهی، در گام بعدی یک سناریوی dry-run با یک پرسش واقعی‌تر مالی هم پیشنهاد می‌دهم که احتمالاً ابتدا get_database_schema را تریگر کند و بعد به fetch_financial_data برسد.

Made changes.