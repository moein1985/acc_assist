export function localizeInfraErrorFa(error: string): string {
  const normalized = error.toLowerCase()

  if (normalized.includes('login failed')) {
    return 'احراز هویت SQL ناموفق بود. نام کاربری یا رمز عبور را بررسی کنید.'
  }

  if (normalized.includes('econnrefused') || normalized.includes('connection refused')) {
    return 'اتصال به سرور رد شد. آدرس میزبان، پورت و فعال بودن SQL Server را بررسی کنید.'
  }

  if (normalized.includes('enotfound') || normalized.includes('getaddrinfo') || normalized.includes('dns')) {
    return 'میزبان پیدا نشد یا DNS پاسخ نداد. آدرس میزبان و DNS را بررسی کنید.'
  }

  if (
    normalized.includes('ehostunreach') ||
    normalized.includes('network is unreachable') ||
    normalized.includes('no route to host')
  ) {
    return 'مسیر شبکه به مقصد در دسترس نیست. اتصال شبکه/VPN/روتینگ را بررسی کنید.'
  }

  if (normalized.includes('timeout') || normalized.includes('etimedout') || normalized.includes('timed out')) {
    return 'مهلت اتصال تمام شد. شبکه، فایروال، پورت یا تاخیر تونل SSH را بررسی کنید.'
  }

  if (
    normalized.includes('certificate') ||
    normalized.includes('self-signed') ||
    normalized.includes('trustservercertificate') ||
    normalized.includes('unable to verify the first certificate')
  ) {
    return 'خطای گواهی TLS رخ داد. تنظیمات Encrypt و Trust Server Certificate را بازبینی کنید.'
  }

  if (normalized.includes('unsupported protocol') || normalized.includes('openssl_internal:unsupported_protocol')) {
    return 'نسخه پروتکل TLS/SSL بین کلاینت و SQL Server سازگار نیست. Encrypt را غیرفعال و Trust Server Certificate را فعال کنید.'
  }

  if (normalized.includes('all configured authentication methods failed')) {
    return 'احراز هویت SSH ناموفق بود. رمز عبور یا کلید خصوصی/Passphrase را بررسی کنید.'
  }

  if (normalized.includes('unable to start ssh tunnel')) {
    return 'شروع تونل SSH انجام نشد. تنظیمات SSH و دسترسی سرور را بررسی کنید.'
  }

  if (normalized.includes('connection reset') || normalized.includes('econnreset')) {
    return 'اتصال شبکه در میانه مسیر قطع شد. پایداری شبکه یا تونل را بررسی کنید.'
  }

  return `خطا: ${error}`
}

export function localizeChatErrorFa(error: string): string {
  const normalized = error.toLowerCase()

  if (normalized.includes('api key is empty') || normalized.includes('کلید api')) {
    return 'کلید API تنظیم نشده است. ابتدا در تب تنظیمات کلید را وارد و ذخیره کنید.'
  }

  if (normalized.includes('request canceled by user') || normalized.includes('request cancelled by user')) {
    return 'درخواست توسط کاربر متوقف شد.'
  }

  if (normalized.includes('agent_request_cancelled')) {
    return 'درخواست توسط کاربر متوقف شد.'
  }

  if (normalized.includes('timeout')) {
    return 'مهلت پاسخ سرویس هوش مصنوعی تمام شد. دوباره تلاش کنید یا اندازه درخواست را کمتر کنید.'
  }

  if (normalized.includes('401') || normalized.includes('403') || normalized.includes('unauthorized')) {
    return 'احراز هویت سرویس هوش مصنوعی رد شد. API Key و Base URL را بررسی کنید.'
  }

  if (normalized.includes('429') || normalized.includes('too many requests')) {
    return 'محدودیت نرخ درخواست فعال شده است. کمی بعد دوباره تلاش کنید.'
  }

  if (normalized.includes('404') || normalized.includes('not found')) {
    return 'مسیر سرویس یا مدل یافت نشد. Base URL و نام مدل را بررسی کنید.'
  }

  if (normalized.includes('500') || normalized.includes('502') || normalized.includes('503') || normalized.includes('504')) {
    return 'سرویس هوش مصنوعی موقتا در دسترس نیست. کمی بعد دوباره تلاش کنید.'
  }

  if (normalized.includes('econnrefused') || normalized.includes('enotfound') || normalized.includes('ehostunreach')) {
    return 'اتصال به سرویس هوش مصنوعی برقرار نشد. شبکه، DNS یا Base URL را بررسی کنید.'
  }

  return error
}