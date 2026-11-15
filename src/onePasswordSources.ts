const source=(title:string,path:string,scope:string)=>({title,url:`https://support.1password.com/${path}/`,scope,checked:'2026-11-15',reviewMethod:'official-documentation' as const});
export const ONEPASSWORD_SOURCES={
 opSignin:source('1Password · Sign-in address','sign-in-troubleshooting','Existing Account / actual region and organization'),
 opSsoLinked:source('1Password · Link an app or browser with SSO','sso-linked-apps-browsers','Member operation / existing linked source / target app'),
 opSso:source('1Password · Unlock with SSO','sso','Business / IdP instead of account password and Secret Key'),
 opPasskeyBeta:source('1Password · Existing passkey test account','cs/passkeys','Existing beta only / new accounts unavailable / recovery'),
 opAccountRecovery:source('1Password · Account recovery','recovery','Family organizer / team administrator / member recovery'),
};
