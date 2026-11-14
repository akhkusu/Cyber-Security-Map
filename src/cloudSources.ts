import type { Source } from './guideCatalog';
const source = (title: string, url: string, scope: string): Source => ({ title, url, scope, checked: '2026-11-13', reviewMethod: 'official-documentation' });
export const CLOUD_SOURCES = {
  protonPassExtension: source('Proton · Browser extension', 'https://proton.me/support/pass-browser-extension', 'Personal Proton Account / browser extension / create, save and fill'),
  protonPassIos: source('Proton · iPhone / iPad setup', 'https://proton.me/support/pass-setup-ios', 'iOS / iPadOS / official app and autofill'),
  protonPassAndroid: source('Proton · Android', 'https://proton.me/support/use-pass-android', 'Android / manufacturer differences / create and fill'),
  protonPassIosUse: source('Proton · iPhone / iPad use', 'https://proton.me/support/use-pass-ios', 'Mobile login item / password generation / save and fill'),
  protonPassExtra: { ...source('Proton · Optional extra password', 'https://proton.me/support/pass-extra-password', 'Optional Pass secret / extension, iOS, Android / minimum eight characters / initial setup signs all Pass sessions out'), checked: '2026-11-14' },
  protonRecoveryMethods: source('Proton · Account and encrypted data recovery', 'https://proton.me/support/set-account-recovery-methods', 'Password reset is separate from decrypting existing data'),
  protonRecoveryPhrase: source('Proton · Recovery phrase', 'https://proton.me/support/recovery-phrase', '12 words / one-time recovery / independent storage outside Proton'),
  protonRecoveryFile: source('Proton · Recovery file', 'https://proton.me/support/recovery-file', 'Encrypted backup keychain / download and preserve / no voiding'),
  protonResetRecovery: source('Proton · Email and SMS recovery', 'https://proton.me/support/email-sms-recovery', 'Verified password-reset destinations / does not recover encrypted data alone'),
  nordAccount: source('NordPass · Passwords and codes', 'https://support.nordpass.com/hc/en-us/articles/360008866077-Passwords-and-codes', 'Nord Account, Master Password, vault Recovery Code and MFA codes are different'),
  nordCreate: source('NordPass · Create an account', 'https://support.nordpass.com/hc/en-us/articles/360006698698-Creating-a-New-Account', 'Personal Nord Account / email verification / separate vault Master Password'),
  nordMaster: source('NordPass · Set up Master Password', 'https://support.nordpass.com/hc/en-us/articles/360008851138-How-to-set-up-the-Master-Password', 'Personal Master Password mode / existing accounts are not reset'),
  nordMasterStrength: source('NordPass · Master Password guidance', 'https://support.nordpass.com/hc/en-us/articles/360002376637-How-to-change-my-Master-Password', 'Recommends at least 12 characters / uniqueness / character types'),
  nordRecovery: source('NordPass · Vault Recovery Code', 'https://support.nordpass.com/hc/en-us/articles/360002376557-How-to-generate-a-new-Recovery-Code', 'Personal vault / Reset Recovery Code invalidates earlier codes'),
  nordMfa: source('NordPass · MFA on Nord Account', 'https://support.nordpass.com/hc/en-us/articles/360002770497-How-to-enable-Multi-Factor-Authentication-MFA', 'Authenticator / key / shared with NordVPN and NordLocker'),
  nordMfaCodes: source('Nord · MFA backup codes', 'https://support.nordvpn.com/hc/en-us/articles/30047757775249-NordVPN-MFA-backup-codes', 'Nord Account / 10 one-time codes / View codes / keep current codes'),
  nordDesktop: source('NordPass · Desktop use', 'https://support.nordpass.com/hc/en-us/articles/360006638797-How-to-use-NordPass-on-desktop-devices', 'Browser extension / saved login / Master Password'),
  nordFillIos: source('NordPass · iOS autofill', 'https://support.nordpass.com/hc/en-us/articles/360004303777-How-to-enable-NordPass-autofill-on-iOS', 'Settings / General / AutoFill & Passwords'),
  nordFillAndroid: source('NordPass · Android autofill', 'https://support.nordpass.com/hc/en-us/articles/360005811278-How-to-enable-NordPass-autofill-on-Android', 'Profile / Settings / Autofill / Open Device Settings'),
  nordGenerate: source('NordPass · Desktop generator', 'https://support.nordpass.com/hc/en-us/articles/40492968030353-How-to-use-Password-Generator-in-NordPass-on-desktop-devices', 'Tools / Password Generator / preserve old credentials before website change'),
  nordGenerateMobile: source('NordPass · Mobile generator', 'https://support.nordpass.com/hc/en-us/articles/360002775398-How-to-use-Password-Generator-in-NordPass-on-mobile-devices', 'Mobile / generator / item creation'),
  nordGenerateExtension: source('NordPass · Extension generator', 'https://support.nordpass.com/hc/en-us/articles/40185212545553-How-to-use-Password-Generator-with-NordPass-browser-extension', 'Browser extension / Tools / Password Generator / Copy Password'),
  nordAddMobile: source('NordPass · Mobile items', 'https://support.nordpass.com/hc/en-us/articles/360006678277-How-to-add-items-to-NordPass-on-mobile-devices', 'iOS 18+ / Android 9+ / Add item / Save'),
  nordAddExtension: source('NordPass · Extension items', 'https://support.nordpass.com/hc/en-us/articles/40612713367569-How-to-add-items-to-NordPass-browser-extension', 'Add item / Save / existing item or new item'),
  nordPasswordStrength: source('NordPass · Password practices', 'https://nordpass.com/blog/password-management-best-practices/', '2026-10-26 / at least 15 characters / unique generated passwords / no routine rotation'),
  nordPassword: source('Nord · Account password change', 'https://support.nordvpn.com/hc/en-us/articles/19476698905617-How-can-I-change-my-NordVPN-password', 'Nord Account / Account settings / Change password / emailed link / not the vault Master Password'),
  nordConnected: source('Nord · Account settings', 'https://support.nordvpn.com/hc/en-us/articles/19629327624593-Managing-my-Nord-Account-settings', 'Account details / connected Google and Apple / no unlinking'),
  nordSso: source('NordPass · Passkeys and connected sign-in', 'https://support.nordpass.com/hc/en-us/articles/12984678202641-Passkeys-FAQs', 'Google SSO dependency / independent Google access / avoid keeping the only credential in the dependent vault'),
  protonPasswordStrength: source('Proton · Password strength', 'https://proton.me/blog/how-to-create-a-strong-password', 'Proton Pass default 16 characters / random unique passwords / passphrases for vault access'),
  effDice: source('EFF · Dice-generated passphrases', 'https://www.eff.org/dice', 'At least 6 randomly selected words from the 7776-word long list / physical dice'),
};
export function cloudRouteSources(product: string, route: string): (keyof typeof CLOUD_SOURCES)[] {
  if (route.startsWith('cloud-extra-')) return ['protonPassExtra', 'protonRecoveryMethods', 'effDice'];
  if (route === 'cloud-sso-unavailable' || route === 'cloud-account-method') return ['nordConnected', 'nordSso', 'nordAccount'];
  if (route === 'cloud-recovery') return ['nordRecovery', 'nordAccount'];
  if (route === 'cloud-master-review' || route === 'cloud-master-needs-change') return ['nordMasterStrength', 'nordRecovery', 'effDice'];
  if (route === 'cloud-phrase') return ['protonRecoveryPhrase', 'protonRecoveryMethods'];
  if (route === 'cloud-reset') return ['protonResetRecovery', 'protonRecoveryMethods'];
  if (route === 'cloud-file') return ['protonRecoveryFile', 'protonRecoveryMethods'];
  return product === 'nordpass' ? ['nordCreate', 'nordAccount', 'nordAddMobile', 'nordDesktop'] : ['protonPassIos', 'protonPassAndroid', 'protonPassExtension', 'protonPassExtra'];
}
