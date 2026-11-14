import { ChevronDown, ShieldCheck } from 'lucide-react';
import type { Language } from './models';
export const tx = (language: Language, en: string, ja: string) => language === 'ja' ? ja : en;
export function Brand() { return <span className="brand"><span className="brand-mark"><ShieldCheck size={23} /></span><strong>Cyber-Security-Map</strong></span>; }
export function LanguagePicker({ language, onChange }: { language: Language; onChange: (language: Language) => void }) {
  return <label className="language-picker"><span className="sr-only">Language / 言語</span><select value={language} onChange={e => onChange(e.target.value as Language)}><option value="ja">日本語</option><option value="en">English</option></select><ChevronDown size={14} aria-hidden="true" /></label>;
}
