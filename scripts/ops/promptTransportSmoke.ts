import { decodePromptTransportValue, encodePromptTransportBase64 } from './promptTransport'

const prompt = 'در دیتابیس چند سال مالی قرار داره؟ لطفاً برای 1403/01 خلاصه بده.'
const base64 = encodePromptTransportBase64(prompt)
const jsonPayload = JSON.stringify({ promptBase64: base64 })
const mixedPayload = JSON.stringify({ prompt: 'این متن باید نادیده گرفته شود', promptBase64: base64 })

const plainTextResult = decodePromptTransportValue(prompt)
const jsonResult = decodePromptTransportValue(jsonPayload)
const rawBase64Result = decodePromptTransportValue(base64)
const precedenceResult = decodePromptTransportValue(mixedPayload)

if (
  plainTextResult !== prompt ||
  jsonResult !== prompt ||
  rawBase64Result !== prompt ||
  precedenceResult !== prompt
) {
  throw new Error('Prompt transport round-trip failed.')
}

console.log('[prompt-transport-smoke] PASS')
console.log(`[prompt-transport-smoke] PromptLength=${prompt.length}`)
console.log(`[prompt-transport-smoke] Base64Length=${base64.length}`)
console.log('[prompt-transport-smoke] CoveredPaths=plain|json-base64|raw-base64|mixed-precedence')
