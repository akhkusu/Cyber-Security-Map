import { useState } from 'react';
import type { Language } from './models';
import { tx } from './ui';

/** Public, catalogued address only; never a token-bearing or user-entered URL. */
export function OfficialAddress({ url, language }: { url: string; language: Language }) {
  const [message, setMessage] = useState('');
  return <div className="official-address">
    <label>{tx(language, 'Official sign-in address', '正規のログインURL')}
      <input type="url" readOnly value={url} onFocus={e => e.currentTarget.select()} />
    </label>
    <button className="button secondary" onClick={async () => {
      try { await navigator.clipboard.writeText(url); setMessage(tx(language, 'Address copied', 'URLをコピーしました')); }
      catch { setMessage(tx(language, 'Select the address field and copy it manually.', 'URL欄を選択して、手動でコピーしてください。')); }
    }}>{tx(language, 'Copy this address', 'このURLをコピーする')}</button>
    <p role="status">{message}</p>
  </div>;
}
