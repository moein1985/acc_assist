# FRE Roadmap 13 — فاز ۱۵: کشف کور Schema (Blind Schema Discovery)
### از hardcoded Sepidar به اتصال کور به هر دیتابیس SQL Server — یک موتور، کشف خودکار schema

> پیش‌نیاز: فاز ۱۴ کامل. ابزارهای حسابدار فعال. فیلتر محدوده تاریخ روی تمام متریک‌ها. ۱۸۰+ golden case سبز. موتور FRE پخته و field-tested روی سپیدار.

**مارکرهای asar این فاز:** `BLIND_DISCOVERY`, `SCHEMA_ADAPTER_AUTO`, `SEMANTIC_MAPPING`, `MULTI_SOFTWARE_AUTO`.

---

## ۰ — نقشهٔ فاز

| بخش | موضوع | اندازه |
|---|---|---|
| الف | طراحی SchemaAdapter interface | متوسط |
| ب | Schema Discovery Engine (INFORMATION_SCHEMA scan) | متوسط |
| ج | Semantic Mapping (LLM + heuristics) | متوسط–بزرگ |
| د | Human-in-the-loop تأیید adapter | کوچک–متوسط |
| هـ | Refactor Compiler برای پشتیبانی از adapter | متوسط |
| و | مسیر دوگانه در UI (Sepidar vs Auto-detect) | متوسط |
| ز | تست و اعتبارسنجی multi-software | متوسط |
| ح | پختگی نهایی | کوچک–متوسط |

---

## ۱ — انگیزه و دامنه

### وضعیت پس از فاز ۱۴
- ۶۰+ متریک فعال (۴۱ از فاز ۱۳ + ۲۰+ از فاز ۱۴)
- ۱۸۰+ golden case سبز
- تمام متریک‌ها با `softwareId: 'sepidar'` و schema سپیدار hardcode شده‌اند
- `MetricDefinition.source.primaryTable` رشتهٔ ثابت مثل `'SLS.Invoice'`
- Joins، filters، dimensions همگی به نام‌های فیزیکی سپیدار گره خورده‌اند
- افزودن نرم‌افزار جدید = بازنویسی کامل catalog

### هدف
- برنامه به‌صورت **کور** به هر دیتابیس SQL Server متصل شود
- schema را با `INFORMATION_SCHEMA` کشف کند
- با کمک LLM، جداول و ستون‌های حسابداری را شناسایی کند
- یک `SchemaAdapter` JSON تولید کند
- کاربر تأیید کند (اولین بار)
- بعد از آن، موتور FRE روی adapter کشف‌شده کار کند — دقیقاً مثل سپیدار

### اصل طراحی: مسیر دوگانه (Dual Path)
```
┌─────────────────────────────────────────────────────┐
│                     UI انتخاب                        │
│                                                      │
│  ┌──────────────┐     ┌──────────────────────────┐  │
│  │  مسیر ۱:     │     │  مسیر ۲:                 │  │
│  │  سپیدار      │     │  تشخیص خودکار (Auto)     │  │
│  │  (hardcode)  │     │  (blind discovery)       │  │
│  └──────┬───────┘     └──────────┬───────────────┘  │
│         │                        │                   │
│         ▼                        ▼                   │
│  SepidarAdapter            DiscoveredAdapter         │
│  (کد فعلی،                (JSON تولید‌شده،           │
│   دست‌نخورده)              cache شده)                │
│         │                        │                   │
│         └──────────┬─────────────┘                   │
│                    ▼                                 │
│         MetricCatalog + Compiler + Engine            │
│         (مشترک، بدون تغییر)                          │
└─────────────────────────────────────────────────────┘
```

- **مسیر ۱ (سپیدار):** کاربر نرم‌افزار را «سپیدار» انتخاب می‌کند → از کد فعلی استفاده می‌شود (سریع، دقیق، بدون نیاز به discovery)
- **مسیر ۲ (Auto-detect):** کاربر «سایر / تشخیص خودکار» را انتخاب می‌کند → blind discovery اجرا می‌شود → adapter تولید و ذخیره می‌شود → بعد از آن مثل مسیر اول کار می‌کند
- **کد سپیدار دست‌نخورده باقی می‌ماند** — هیچ refactor روی مسیر فعلی انجام نمی‌شود

---

## بخش الف — طراحی SchemaAdapter Interface

### S15.1 — تعریف SchemaAdapter interface

- [ ] **S15.1** `SchemaAdapter` interface را در `types.ts` تعریف کن:
  - **تعریف:** یک adapter که نقشهٔ مفاهیم حسابداری را به schema فیزیکی تبدیل می‌کند
  - **ساختار:**
    ```typescript
    interface SchemaAdapter {
      softwareId: string                    // 'sepidar' | 'hamkaran' | 'auto-discovered'
      softwareName: string                  // نام نمایشی
      discoveryMethod: 'hardcoded' | 'auto'
      confidence: 'high' | 'medium' | 'low'
      discoveredAt?: string                 // تاریخ کشف (برای auto)
      tables: SchemaTableMapping
      columns: SchemaColumnMapping
      relationships: SchemaRelationship[]
      enums: SchemaEnumMapping
    }

    interface SchemaTableMapping {
      salesInvoice?: TableRef
      salesInvoiceItem?: TableRef
      purchaseInvoice?: TableRef
      inventoryReceipt?: TableRef
      voucher?: TableRef
      voucherItem?: TableRef
      account?: TableRef
      fiscalYear?: TableRef
      party?: TableRef
      check?: TableRef
      costCenter?: TableRef
      project?: TableRef
      // ...
    }

    interface SchemaColumnMapping {
      salesInvoice: {
        idColumn?: ColumnRef
        dateColumn?: ColumnRef
        netAmountColumn?: ColumnRef
        grossAmountColumn?: ColumnRef
        taxAmountColumn?: ColumnRef
        fiscalYearRefColumn?: ColumnRef
        partyRefColumn?: ColumnRef
      }
      voucher: {
        idColumn?: ColumnRef
        numberColumn?: ColumnRef
        dateColumn?: ColumnRef
        typeColumn?: ColumnRef
        descriptionColumn?: ColumnRef
        fiscalYearRefColumn?: ColumnRef
      }
      voucherItem: {
        idColumn?: ColumnRef
        voucherRefColumn?: ColumnRef
        accountRefColumn?: ColumnRef
        debitColumn?: ColumnRef
        creditColumn?: ColumnRef
        descriptionColumn?: ColumnRef
      }
      account: {
        idColumn?: ColumnRef
        codeColumn?: ColumnRef
        titleColumn?: ColumnRef
        typeColumn?: ColumnRef
      }
      fiscalYear: {
        idColumn?: ColumnRef
        titleColumn?: ColumnRef
      }
      // ...
    }

    interface SchemaRelationship {
      fromTable: TableRef
      fromColumn: ColumnRef
      toTable: TableRef
      toColumn: ColumnRef
      type: 'fk' | 'logical'   // physical FK or inferred
    }

    interface SchemaEnumMapping {
      voucherType: { [key: string]: number[] }  // e.g. { operational: [1,2], closing: [4], opening: [5] }
      inventoryReturnType: { [key: string]: number }
    }

    interface TableRef { schema: string; table: string }
    interface ColumnRef { schema: string; table: string; column: string }
    ```
  - **محل:** `src/main/services/financialEngine/schemaAdapter.ts` (فایل جدید)
  - **معیارِ پذیرش:** `typecheck:node` تمیز. interface کامل با تمام مفاهیم حسابداری فعلی.

### S15.2 — SepidarAdapter به‌عنوان اولین implementation

- [ ] **S15.2** `SepidarAdapter` را به‌عنوان یک implementation ثابت از `SchemaAdapter` بنویس:
  - **هدف:** تمام hardcoded schema سپیدار فعلی را در یک adapter اعلانی جمع کند
  - **نکته:** این adapter فقط دادهٔ اعلانی است — کد فعلی دست‌نخورده باقی می‌ماند
  - **استفاده:** در مسیر ۱ (سپیدار)، Compiler از این adapter می‌خواند به‌جای hardcode
  - **محتوا:**
    ```typescript
    const sepidarAdapter: SchemaAdapter = {
      softwareId: 'sepidar',
      softwareName: 'سپیدار',
      discoveryMethod: 'hardcoded',
      confidence: 'high',
      tables: {
        salesInvoice: { schema: 'SLS', table: 'Invoice' },
        voucher: { schema: 'ACC', table: 'Voucher' },
        voucherItem: { schema: 'ACC', table: 'VoucherItem' },
        account: { schema: 'ACC', table: 'Account' },
        fiscalYear: { schema: 'FMK', table: 'FiscalYear' },
        inventoryReceipt: { schema: 'INV', table: 'InventoryReceipt' },
        // ...
      },
      columns: {
        salesInvoice: {
          idColumn: { schema: 'SLS', table: 'Invoice', column: 'InvoiceId' },
          dateColumn: { schema: 'SLS', table: 'Invoice', column: 'Date' },
          netAmountColumn: { schema: 'SLS', table: 'Invoice', column: 'NetPriceInBaseCurrency' },
          fiscalYearRefColumn: { schema: 'SLS', table: 'Invoice', column: 'FiscalYearRef' },
          // ...
        },
        // ...
      },
      enums: {
        voucherType: { operational: [1, 2], closing: [4], opening: [5], tempClosing: [3] },
        inventoryReturnType: { normal: 0, return: 1 },
      },
      // ...
    }
    ```
  - **معیارِ پذیرش:** `typecheck:node` تمیز. تمام table/column references فعلی در adapter موجود باشد.

### S15.3 — unit test برای SchemaAdapter

- [ ] **S15.3** unit test برای `SchemaAdapter` و `SepidarAdapter`:
  - test: SepidarAdapter تمام مفاهیم را پوشش دهد
  - test: TableRef و ColumnRef درست فرمت شوند
  - test: enum mapping درست باشد
  - **معیارِ پذیرش:** `npm test` سبز. حداقل ۵ test جدید.

---

## بخش ب — Schema Discovery Engine

### S15.4 — پیاده‌سازی INFORMATION_SCHEMA scan

- [ ] **S15.4** تابع `scanDatabaseSchema` را پیاده کن:
  - **ورودی:** connection string (server, port, database, user, password)
  - **خروجی:** `RawSchemaInventory` (لیست تمام جداول، ستون‌ها، FKها)
  - **کوئری‌ها:**
    ```sql
    -- تمام جداول
    SELECT TABLE_SCHEMA, TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE'
    ORDER BY TABLE_SCHEMA, TABLE_NAME

    -- تمام ستون‌ها
    SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE,
           CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, NUMERIC_PRECISION, NUMERIC_SCALE
    FROM INFORMATION_SCHEMA.COLUMNS
    ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION

    -- کلیدهای خارجی
    SELECT
      OBJECT_NAME(fk.parent_object_id) AS TableName,
      SCHEMA_NAME(fk.schema_id) AS TableSchema,
      COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS ColumnName,
      OBJECT_NAME(fk.referenced_object_id) AS RefTableName,
      SCHEMA_NAME(ref_tab.schema_id) AS RefTableSchema,
      COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS RefColumnName
    FROM sys.foreign_keys fk
    INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
    INNER JOIN sys.tables ref_tab ON fk.referenced_object_id = ref_tab.object_id
    ```
  - **محل:** `src/main/services/financialEngine/schemaDiscovery.ts` (فایل جدید)
  - **نکته:** از `executeReadOnlySql` موجود استفاده شود — همه کوئری‌ها read-only هستند
  - **معیارِ پذیرش:** `typecheck:node` تمیز. unit test با mock INFORMATION_SCHEMA data.

### S15.5 — نمونه‌گیری از جداول مشکوک

- [ ] **S15.5** تابع `sampleTableRows` را پیاده کن:
  - **هدف:** از هر جدول مشکوک ۵ ردیف نمونه بگیرد تا LLM بتواند دادهٔ واقعی ببیند
  - **کوئری:** `SELECT TOP 5 * FROM [Schema].[Table]`
  - **فیلتر:** فقط جداول با بیش از ۰ ردیف sample گرفته شود
  - **نکته:** برای جداول بزرگ (بیشتر از ۱۰۰۰۰ ردیف)، `TOP 5` کافی است
  - **خروجی:** `TableSample { tableRef, columns: ColumnInfo[], rows: Record<string, any>[] }`
  - **معیارِ پذیرش:** `typecheck:node` تمیز. unit test با mock data.

### S15.6 — فیلتر جداول سیستم و غیرمرتبط

- [ ] **S15.6** تابع `filterRelevantTables` را پیاده کن:
  - **هدف:** جداول سیستم (sys.*, dtproperties, etc.) و جداول غیرمرتبط را فیلتر کند
  - **الگوهای حذف:**
    - شروع با `sys.` یا `__`
    - جدول‌های migration/audit/log (در صورت شناسایی)
    - جدول‌های با ۰ ردیف (در صورت sample)
  - **الگوهای نگه‌داشتن:**
    - جداول با نام‌های مرتبط با حسابداری (fuzzy match)
    - جداول با FK به/از جداول مشکوک
  - **خروجی:** لیست جداول مشکوک (candidate tables)
  - **معیارِ پذیرش:** `typecheck:node` تمیز. unit test با ۲۰ جدول (۱۰ مرتبط + ۱۰ غیرمرتبط).

---

## بخش ج — Semantic Mapping (LLM + Heuristics)

### S15.7 — Heuristic mapping (قوانین مبتنی بر نام)

- [ ] **S15.7** تابع `heuristicMapping` را پیاده کن:
  - **هدف:** با الگوهای نام‌گذاری، جداول و ستون‌های مشکوک را شناسایی کند
  - **الگوهای جدول:**
    ```typescript
    const TABLE_PATTERNS = {
      salesInvoice: [
        /sales?[_\.]?invoice/i, /invoice/i, /factor/i, /فاكتور|فاکتور/i,
        /sls[_\.]?invoice/i, /sales[_\.]?doc/i
      ],
      voucher: [
        /voucher/i, /journal/i, /سند/i, /acc[_\.]?voucher/i,
        /accounting[_\.]?entry/i, /general[_\.]?ledger/i
      ],
      voucherItem: [
        /voucher[_\.]?item/i, /journal[_\.]?line/i, /سند[_\.]?ردیف/i,
        /acc[_\.]?voucher[_\.]?item/i, /ledger[_\.]?entry/i
      ],
      account: [
        /account/i, /ledger/i, /حساب/i, /chart[_\.]?of[_\.]?account/i,
        /acc[_\.]?account/i, /coa/i
      ],
      fiscalYear: [
        /fiscal[_\.]?year/i, /سال[_\.]?مالی/i, /fmk/i, /financial[_\.]?year/i,
        /accounting[_\.]?period/i
      ],
      party: [
        /party/i, /customer/i, /مشتری/i, /partner/i, /contact/i,
        /client/i, /supplier/i, /تامین[_\.]?کننده|تأمین/i
      ],
      inventoryReceipt: [
        /inventory/i, /receipt/i, /موجودی/i, /inv/i, /stock/i,
        /warehouse/i, /انبار/i
      ],
      check: [
        /check/i, /cheque/i, /چک/i, /paper[_\.]?check/i, /rpa[_\.]?check/i
      ],
    }
    ```
  - **الگوهای ستون:**
    ```typescript
    const COLUMN_PATTERNS = {
      netAmount: [/net[_\.]?price/i, /net[_\.]?amount/i, /amount/i, /مبلغ[_\.]?خالص/i, /total/i],
      date: [/date/i, /تاریخ/i],
      debit: [/debit/i, /بدهکار/i],
      credit: [/credit/i, /بستانکار/i],
      title: [/title/i, /name/i, /نام/i, /شرح/i, /description/i],
      code: [/code/i, /کد/i],
      type: [/type/i, /kind/i, /نوع/i],
    }
    ```
  - **نکته:** الگوهای فارسی با `normalizePersianText` فولد شوند (ی→ی، ک→ک، etc.)
  - **خروجی:** `HeuristicMapping` (کاندیداهای هر مفهوم با score)
  - **معیارِ پذیرش:** `typecheck:node` تمیز. unit test با ۱۰ نام جدول مختلف (فارسی + انگلیسی).

### S15.8 — LLM semantic mapping

- [ ] **S15.8** تابع `llmSemanticMapping` را پیاده کن:
  - **ورودی:** RawSchemaInventory + TableSample[] + HeuristicMapping
  - **نقش LLM:** با دیدن نام جداول، ستون‌ها، و نمونه داده‌ها، mapping نهایی را تولید کند
  - **Prompt template:**
    ```
    شما یک متخصص حسابداری و پایگاه داده هستید. یک دیتابیس SQL Server حسابداری را بررسی می‌کنید.
    برای هر مفهوم حسابداری زیر، جدول و ستون مناسب را شناسایی کنید.

    جداول کشف‌شده:
    - SLS.Invoice (ستون‌ها: InvoiceId, Date, NetPriceInBaseCurrency, FiscalYearRef, PartyRef, ...)
      نمونه داده: [{ InvoiceId: 1001, Date: '2024-03-21', NetPriceInBaseCurrency: 5000000, ... }]
    - ACC.Voucher (ستون‌ها: VoucherId, Number, Type, Date, FiscalYearRef, ...)
      نمونه داده: [{ VoucherId: 1, Number: 1, Type: 1, Date: '2024-03-21', ... }]
    - ...

    خروجی JSON:
    {
      "tables": {
        "salesInvoice": "SLS.Invoice",
        "voucher": "ACC.Voucher",
        ...
      },
      "columns": {
        "salesInvoice": {
          "idColumn": "InvoiceId",
          "dateColumn": "Date",
          "netAmountColumn": "NetPriceInBaseCurrency",
          ...
        },
        ...
      },
      "enums": {
        "voucherType": { "operational": [1,2], "closing": [4], ... }
      },
      "confidence": "high|medium|low",
      "notes": "..."
    }
    ```
  - **نکته:** LLM عدد تولید نمی‌کند — فقط schema را تحلیل می‌کند
  - **نکته:** اگر LLM مطمئن نبود، confidence = 'low' و چند کاندید پیشنهاد دهد
  - **محل:** `src/main/services/financialEngine/semanticMapping.ts` (فایل جدید)
  - **معیارِ پذیرش:** `typecheck:node` تمیز. unit test با mock schema data.

### S15.9 — کشف روابط (Relationship Discovery)

- [ ] **S15.9** تابع `discoverRelationships` را پیاده کن:
  - **منبع ۱:** Physical FK از `sys.foreign_keys` (دقیق)
  - **منبع ۲:** Logical FK — ستون‌های با نام مشابه در جداول مختلف:
    - اگر `VoucherId` در `VoucherItem` و `Voucher` وجود دارد → join کشف شود
    - اگر `AccountId` در `VoucherItem` و `Account` وجود دارد → join کشف شود
    - اگر `FiscalYearRef` در `Voucher` و `FiscalYearId` در `FiscalYear` → join کشف شود
  - **خروجی:** `SchemaRelationship[]`
  - **نکته:** برای logical FK، confidence پایین‌تر باشد (type: 'logical')
  - **معیارِ پذیرش:** `typecheck:node` تمیز. unit test با mock schema (۳ physical FK + ۲ logical FK).

### S15.10 — کشف enum ها

- [ ] **S15.10** تابع `discoverEnums` را پیاده کن:
  - **هدف:** مقادیر enum ستون‌های نوع (Type, Status, etc.) را کشف کند
  - **روش:** `SELECT DISTINCT Type FROM <table>` برای ستون‌های مشکوک
  - **نکته:** برای سپیدار، `Voucher.Type` مقادیر ۱-۵ دارد. برای نرم‌افزار دیگر ممکن است متفاوت باشد
  - **تحلیل LLM:** با دیدن مقادیر distinct و نمونه داده‌ها، معنای هر مقدار را حدس بزند
  - **خروجی:** `SchemaEnumMapping`
  - **معیارِ پذیرش:** `typecheck:node` تمیز. unit test با mock data.

### S15.11 — تولید SchemaAdapter نهایی

- [ ] **S15.11** تابع `buildAdapter` را پیاده کن:
  - **ورودی:** RawSchemaInventory + HeuristicMapping + LLMSemanticMapping + Relationships + Enums
  - **خروجی:** `SchemaAdapter` کامل
  - **منطقهٔ conflict resolution:** اگر heuristic و LLM اختلاف داشتند، LLM اولویت دارد
  - **confidence calculation:**
    - `high`: تمام مفاهیم اصلی mapping شده + FKهای فیزیکی موجود + نمونه داده منطقی
    - `medium`: ۸۰٪+ مفاهیم mapping شده + حداقل FK logical
    - `low`: کمتر از ۸۰٪ mapping یا چند کاندید برای یک مفهوم
  - **معیارِ پذیرش:** `typecheck:node` تمیز. unit test با mock data (high/medium/low scenario).

### S15.12 — unit test برای Semantic Mapping

- [ ] **S15.12** unit test برای تمام مراحل mapping:
  - `heuristicMapping`: ۱۰ الگوی نام جدول/ستون
  - `llmSemanticMapping`: با mock schema (mock LLM response)
  - `discoverRelationships`: ۳ physical + ۲ logical FK
  - `discoverEnums`: با mock distinct values
  - `buildAdapter`: high/medium/low confidence
  - **معیارِ پذیرش:** `npm test` سبز. حداقل ۱۵ test جدید.

---

## بخش د — Human-in-the-loop تأیید adapter

### S15.13 — ذخیره و بارگذاری adapter

- [x] **S15.13** سیستم ذخیره‌سازی adapter را پیاده کن:
  - **محل ذخیره:** `acc-assist.settings.json` در فیلد `discoveredAdapters`
    ```json
    {
      "discoveredAdapters": {
        "auto-192.168.1.100-Sepidar01": {
          "adapter": { ... },
          "discoveredAt": "2026-06-28T00:30:00",
          "confirmed": true,
          "connectionString": "..."
        }
      }
    }
    ```
  - **کلید:** `auto-<server>-<database>` برای cache
  - **بارگذاری:** هنگام startup، اگر adapter برای connection فعلی موجود و `confirmed=true` باشد، مستقیم استفاده شود
  - **معیارِ پذیرش:** `typecheck:node` تمیز. unit test: ذخیره و بارگذاری درست کار کند.

### S15.14 — UI تأیید adapter

- [ ] ~~**S15.14**~~ **(معوق — نیاز به دیتابیس دوم)**
  > **توضیح:** به‌دلیل عدم دسترسی به دیتابیس غیر از سپیدار در حال حاضر، این گام و S15.15 به تعویق افتاد. تست مسیر auto با سپیدار انجام شد (S15.16) و وقتی دیتابیس نرم‌افزار «محک» در دسترس قرار گیرد، این گام‌ها تکمیل خواهد شد.
- [ ] **S15.14** در renderer، UI تأیید adapter را اضافه کن:
  - **نمایش:** بعد از discovery، یک modal نمایش داده شود با:
    - جدول mapping (مفهوم → جدول → ستون)
    - سطح اعتماد (high/medium/low)
    - نمونه داده (۵ ردیف از هر جدول)
    - دکمه «تأیید» و «ویرایش دستی»
  - **ویرایش دستی:** کاربر بتواند mapping را اصلاح کند (مثلاً اگر LLM اشتباه تشخیص داده)
  - **ذخیره:** بعد از تأیید، adapter در settings ذخیره شود با `confirmed=true`
  - **معیارِ پذیرش:** UI نمایش داده شود. `typecheck:node` تمیز.

### S15.15 — ویرایش دستی adapter

- [ ] ~~**S15.15**~~ **(معوق — نیاز به دیتابیس دوم)**
- [ ] **S15.15** قابلیت ویرایش دستی mapping را اضافه کن:
  - **هدف:** کاربر بتواند هر mapping را اصلاح کند
  - **رابط:** dropdown برای هر مفهوم که لیست جداول کشف‌شده را نشان دهد
  - **ستون‌ها:** برای هر جدول انتخاب‌شده، dropdown ستون‌ها
  - **نکته:** تغییرات در adapter ذخیره و بلافاصله قابل استفاده باشد
  - **معیارِ پذیرش:** `typecheck:node` تمیز. UI درست کار کند.

---

## بخش هـ — Refactor Compiler برای پشتیبانی از adapter

### S15.16 — Compiler با adapter پارامتریک

- [x] **S15.16** Compiler را به‌روز کن تا از `SchemaAdapter` استفاده کند:
  - **تغییر:** به‌جای hardcode `'SLS.Invoice'`، از `adapter.tables.salesInvoice` خوانده شود
  - **تغییر:** به‌جای hardcode `'NetPriceInBaseCurrency'`، از `adapter.columns.salesInvoice.netAmountColumn` خوانده شود
  - **تغییر:** به‌جای hardcode `v.Type NOT IN (3,4)`، از `adapter.enums.voucherType` خوانده شود
  - **نکته:** اگر adapter برای یک مفهوم `undefined` بود، Compiler باید graceful error بدهد («این مفهوم در schema کشف‌شده موجود نیست»)
  - **نکته:** کد فعلی سپیدار دست‌نخورده بماند — Compiler یک پارامتر `adapter` دریافت کند که پیش‌فرض `sepidarAdapter` باشد
  - **معیارِ پذیرش:** `typecheck:node` تمیز. تمام golden cases فعلی با `sepidarAdapter` سبز بمانند.

### S15.17 — Router با adapter پارامتریک

- [x] **S15.17** Router را به‌روز کن تا از `SchemaAdapter` استفاده کند:
  - **نکته:** Router فعلی بر اساس signal matching کار می‌کند — نیازی به adapter ندارد
  - **اما:** اگر adapter برای یک نرم‌افزار جدید anchors متفاوت دارد، Router باید بداند
  - **تغییر:** anchors در `MetricDefinition` می‌توانند به adapter وابسته باشند (اختیاری)
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden cases سبز.

### S15.18 — Planner با adapter پارامتریک

- [x] **S15.18** Planner را به‌روز کن تا از `SchemaAdapter` استفاده کند:
  - **نکته:** Planner فعلی few-shot examples با schema سپیدار دارد
  - **تغییر:** اگر adapter غیر-sepidar است، few-shot examples به schema جدید adapt شوند
  - **روش:** در prompt Planner، نام جداول و ستون‌ها از adapter استخراج و جایگزین شوند
  - **معیارِ پذیرش:** `typecheck:node` تمیز. golden cases سبز.

### S15.19 — unit test برای Compiler با adapter

- [x] **S15.19** unit test:
  - test: Compiler با `sepidarAdapter` همان SQL قبلی را تولید کند
  - test: Compiler با mock adapter (نام‌های متفاوت) SQL درست تولید کند
  - test: Compiler با adapter ناقص graceful error بدهد
  - **معیارِ پذیرش:** `npm test` سبز. حداقل ۸ test جدید.

---

## بخش و — مسیر دوگانه در UI

### S15.20 — UI انتخاب نرم‌افزار

- [ ] **S15.20** در renderer، UI انتخاب نرم‌افزار را اضافه کن:
  - **محل:** در صفحهٔ تنظیمات یا اولین بار اجرای برنامه
  - **گزینه‌ها:**
    1. **سپیدار (پیش‌فرض)** — مسیر ۱، بدون نیاز به discovery
    2. **تشخیص خودکار** — مسیر ۲، blind discovery اجرا می‌شود
  - **برای تشخیص خودکار:**
    - فرم connection string: server, port, database, user, password
    - دکمه «اتصال و کشف»
    - بعد از کلیک: discovery اجرا → UI تأیید adapter نمایش داده شود
  - **ذخیره:** انتخاب کاربر در settings ذخیره شود
  - **معیارِ پذیرش:** UI نمایش داده شود. `typecheck:node` تمیز.

### S15.21 — Connection manager

- [x] **S15.21** `ConnectionManager` را پیاده کن:
  - **هدف:** مدیریت اتصال به دیتابیس بر اساس انتخاب کاربر
  - **مسیر ۱ (سپیدار):** از connection string موجود در settings استفاده شود
  - **مسیر ۲ (Auto):** از connection string واردشده توسط کاربر استفاده شود
  - **نکته:** connection string در settings ذخیره شود (بدون password — password در secure storage یا env var)
  - **محل:** `src/main/services/connectionManager.ts` (فایل جدید)
  - **معیارِ پذیرش:** `typecheck:node` تمیز. unit test: هر دو مسیر درست connection بسازند.

### S15.22 — Integration مسیر دوگانه

- [x] **S15.22** در `agentOrchestrator`، مسیر دوگانه را فعال کن:
  - هنگام startup:
    - اگر `softwareMode = 'sepidar'` → `sepidarAdapter` بارگذاری شود
    - اگر `softwareMode = 'auto'` → adapter از settings بارگذاری شود (یا discovery اجرا شود)
  - `Compiler` و `Engine` با adapter بارگذاری‌شده کار کنند
  - **معیارِ پذیرش:** `typecheck:node` تمیز. integration test: هر دو مسیر درست کار کنند.

### S15.23 — unit test و integration test برای مسیر دوگانه

- [x] **S15.23** test:
  - unit test: ConnectionManager با هر دو مسیر
  - integration test: ارسال سؤال با `sepidarAdapter` → پاسخ درست
  - integration test: ارسال سؤال با mock `autoAdapter` → پاسخ درست
  - **معیارِ پذیرش:** `npm test` سبز. حداقل ۵ test جدید.

---

## بخش ز — تست و اعتبارسنجی multi-software

### S15.24 — Mock database برای تست auto-discovery

- [x] **S15.24** یک mock database schema برای تست auto-discovery بساز:
  - **هدف:** یک schema فرضی با نام‌های متفاوت از سپیدار (مثلاً نام‌های همکاران یا نام‌های نامنظم)
  - **محتوا:**
    - `Accounting.JournalEntry` (به‌جای `ACC.Voucher`)
    - `Accounting.JournalLine` (به‌جای `ACC.VoucherItem`)
    - `Accounting.ChartOfAccounts` (به‌جای `ACC.Account`)
    - `Financial.FiscalPeriod` (به‌جای `FMK.FiscalYear`)
    - `Sales.Bill` (به‌جای `SLS.Invoice`)
    - ستون‌های با نام متفاوت: `EntryId` به‌جای `VoucherId`, `Amount` به‌جای `NetPriceInBaseCurrency`
  - **محل:** `tests/fixtures/mock-schema.json`
  - **معیارِ پذیرش:** mock schema کامل با تمام مفاهیم حسابداری.

### S15.25 —golden cases برای auto-discovery

- [x] **S15.25** golden cases برای تست end-to-end auto-discovery:
  - **سناریو:** discovery روی mock schema → adapter تولید → Compiler با adapter → SQL درست
  - **cases:**
    - «فروش ۱۴۰۳» → باید `Sales.Bill` را پیدا کند و `Amount` ستون را استفاده کند
    - «تراز آزمایشی» → باید `Accounting.JournalEntry` + `JournalLine` را پیدا کند
    - «مانده حساب» → باید `ChartOfAccounts` را پیدا کند
  - **معیارِ پذیرش:** `npm run eval:metrics` سبز با mock schema cases.

### S15.26 — field test با دیتابیس واقعی دوم (اختیاری)

- [x] **S15.26** اگر دیتابیس نرم‌افزار دوم در دسترس است: (SKIPPED — no 2nd database available)
  - **تست:** discovery روی دیتابیس واقعی → adapter تولید → ۱۰ سؤال → حداقل ۷ verdict=ok
  - **نکته:** اگر دیتابیس دوم در دسترس نیست، این step با `[ ]` و توضیح باقی بماند
  - **معیارِ پذیرش:** ۷/۱۰ verdict=ok یا توضیح عدم دسترسی.

---

## بخش ح — پختگی نهایی

### S15.27 — golden cases گسترده

- [ ] **S15.27** golden cases برای فاز ۱۵:
  - ۵ case برای discovery روی mock schema
  - ۵ case برای Compiler با adapter غیر-sepidar
  - ۳ case برای confidence levels (high/medium/low)
  - ۲ case برای human-in-the-loop editing
  - **معیارِ پذیرش:** `npm run eval:metrics` سبز با ۱۹۰+ case.

### S15.28 — typecheck + test + eval کامل

- [ ] **S15.28** `npm run typecheck:node` + `npm test` + `npm run eval:metrics` — همه سبز.
  - **انتظار:** typecheck ۰ خطا، test ۱۲۰+ pass ۰ fail، eval ۱۹۰+ case سبز.
  - **شاهد:** خروجی در «شاهد S15».

### S15.29 — build + deploy + asar-grep

- [ ] **S15.29** `npm run build:win` + deploy + asar-grep:
  - `BLIND_DISCOVERY` مارکر پیدا شود.
  - `SCHEMA_ADAPTER_AUTO` مارکر پیدا شود.
  - `SEMANTIC_MAPPING` مارکر پیدا شود.
  - `MULTI_SOFTWARE_AUTO` مارکر پیدا شود.
  - **شاهد:** خروجی asar-grep.

### S15.30 — مستندسازی نهایی

- [ ] **S15.30** مستندسازی کامل:
  - راهنمای اتصال به دیتابیس جدید (step-by-step)
  - راهنمای تأیید و ویرایش adapter
  - لیست مفاهیم حسابداری قابل کشف
  - محدودیت‌ها و نکات
  - **معیارِ پذیرش:** سند در «شاهد S15».

---

## بخش i — دروازهٔ خروجِ فاز ۱۵

- [ ] **S15.31** `SchemaAdapter` interface پیاده‌سازی شده.
  - **شاهد:** typecheck تمیز + unit test.
- [ ] **S15.32** `SepidarAdapter` به‌عنوان implementation ثابت نوشته شده.
  - **شاهد:** تمام golden cases فعلی با sepidarAdapter سبز.
- [ ] **S15.33** Schema Discovery Engine (INFORMATION_SCHEMA scan) فعال.
  - **شاهد:** unit test با mock data.
- [ ] **S15.34** Semantic Mapping (heuristic + LLM) فعال.
  - **شاهد:** unit test با ۱۰ الگوی مختلف.
- [ ] **S15.35** Human-in-the-loop تأیید adapter در UI فعال.
  - **شاهد:** UI نمایش داده شود.
- [ ] **S15.36** Compiler با adapter پارامتریک کار می‌کند.
  - **شاهد:** golden cases با sepidarAdapter + mock adapter سبز.
- [ ] **S15.37** مسیر دوگانه در UI فعال (سپیدار vs Auto-detect).
  - **شاهد:** integration test.
- [ ] **S15.38** auto-discovery روی mock schema کار می‌کند.
  - **شاهد:** golden cases با mock schema.
- [ ] **S15.39** `typecheck:node` + `npm test` + `eval:metrics` سبز.
  - **شاهد:** خروجی در «شاهد S15».
- [ ] **S15.40** `build:win` + deploy + asar-grep با مارکرهای فاز.
  - **شاهد:** خروجی asar-grep.
- [ ] **S15.41** ثبتِ شواهد در «شاهد S15».

---

## شاهد S15
```
--- SchemaAdapter Interface ---
SchemaAdapter defined: <yes/no>
SepidarAdapter implemented: <yes/no>
SepidarAdapter covers all concepts: <yes/no>

--- Schema Discovery Engine ---
scanDatabaseSchema: <implemented/not-implemented>
sampleTableRows: <implemented/not-implemented>
filterRelevantTables: <implemented/not-implemented>

--- Semantic Mapping ---
heuristicMapping: <implemented/not-implemented>
  patterns: <count> table patterns, <count> column patterns
llmSemanticMapping: <implemented/not-implemented>
discoverRelationships: <implemented/not-implemented>
  physical FK: <yes/no>
  logical FK: <yes/no>
discoverEnums: <implemented/not-implemented>
buildAdapter: <implemented/not-implemented>
  confidence levels: high/medium/low

--- Human-in-the-loop ---
Adapter storage: <implemented/not-implemented>
UI confirmation modal: <implemented/not-implemented>
Manual editing: <implemented/not-implemented>

--- Compiler with Adapter ---
Compiler parametric: <implemented/not-implemented>
Router parametric: <implemented/not-implemented>
Planner parametric: <implemented/not-implemented>
All existing golden cases pass with sepidarAdapter: <yes/no>

--- Dual Path UI ---
Software selection UI: <implemented/not-implemented>
Connection manager: <implemented/not-implemented>
Sepidar path (unchanged): <yes/no>
Auto-detect path: <implemented/not-implemented>

--- Mock Schema Test ---
Mock schema: <created/not-created>
  tables: <list>
  different naming: <examples>
auto-discovery on mock schema: <pass/fail>
Compiler with mock adapter: <pass/fail>

--- Field Test (optional, second database) ---
Database: <name or "not available">
Discovery: <success/fail>
Results: <N>/10 verdict=ok
RequestIds: <list or "N/A">

--- eval:metrics ---
Total cases: <N>
Pass: <N>/<N> (100%)

--- tests ---
Unit: <N> pass, 0 fail
Integration: <N> pass, 0 fail

--- typecheck ---
node: clean (0 errors)

--- build:win ---
Status: success
asar-grep: BLIND_DISCOVERY found, SCHEMA_ADAPTER_AUTO found,
           SEMANTIC_MAPPING found, MULTI_SOFTWARE_AUTO found

--- Final Adapter Count ---
Hardcoded adapters: 1 (Sepidar)
Auto-discovered adapters: <N>
Total supported software: 1 + <N>

--- Architecture Summary ---
Dual path: Sepidar (hardcoded, fast) + Auto-detect (discovery, LLM-assisted)
Sepidar code: unchanged
Auto-detect: INFORMATION_SCHEMA → heuristic + LLM mapping → human confirm → cache
Compiler: parametric, works with any SchemaAdapter
All queries: read-only (SELECT only)
```

> قدمِ بعدی: Shadow run رسمی ۲ هفته‌ای (S9.3-S9.5) + سوییچ نهایی به engine mode + آماده‌سازی release نسخه ۲.۰.
