// 伺服器的錯誤字串 → 給人看的句子。
//
// API 回的是固定的英文短句（見 server/index.mjs），翻譯放在前端而不是後端，後端才不用
// 管語言。認不得的（網路斷線、500）一律退回一句通則，不要把原始英文丟到玩家臉上。
//
// 一份、兩個畫面共用：登入／註冊在 LoginApp，改信箱與改 PIN 在 PlayerProfileApp。同一個
// 錯誤在兩個畫面上該是同一句話，各抄一份的話總有一邊會漏掉新加的錯誤碼。
const KNOWN = {
  'wrong account or pin': 'errorWrongCredentials',
  'wrong pin': 'errorWrongPin',
  'account is required': 'errorAccountRequired',
  'account already taken': 'errorAccountTaken',
  'a valid email is required': 'errorEmailInvalid',
  'email already taken': 'errorEmailTaken',
  // Google 登入那條路的幾種結果。'email already registered' 不是失敗，是「這個信箱已經
  // 有帳號了，請先用帳號 + PIN 登入再綁定」—— 不自動接的理由見後端。
  'email already registered': 'errorEmailRegistered',
  'google account not linked': 'errorGoogleNotLinked',
  'google sign-in failed': 'errorGoogleFailed',
  'google sign-in is not configured': 'errorGoogleOff',
  'google account already linked': 'errorGoogleLinkedElsewhere',
  'player signs in with google': 'errorPlayerUsesGoogle',
  'name is required': 'errorNameRequired',
  'claimCode is required': 'errorClaimCodeRequired',
  'claim code not found': 'errorClaimNotFound',
  'claim code already used': 'errorClaimUsed',
  'claim code expired': 'errorClaimExpired'
}

/** `t` 由呼叫端傳進來 —— 這個模組不該自己去碰 i18n 的實例。 */
export function translateApiError(message, t) {
  if (KNOWN[message]) return t(`account.${KNOWN[message]}`)
  // 長度要求帶著數字（「pin must be at least 8 characters」），比對不了全句。
  if (message?.startsWith('pin must be at least')) return t('account.errorPinTooShort')
  return t('account.errorGeneric')
}
