import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import type { Language } from './models';
import type { Finding } from './rules';

const tx = (language: Language, en: string, ja: string) => language === 'ja' ? ja : en;

export function SecurityExplanation({ finding, language, depth = 'action' }: {
  finding: Finding;
  language: Language;
  depth?: 'action' | 'why' | 'technical';
}) {
  const [whyOpen, setWhyOpen] = useState(depth !== 'action');
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [technicalOpen, setTechnicalOpen] = useState(depth === 'technical');
  useEffect(() => {
    setWhyOpen(depth !== 'action');
    setTechnicalOpen(depth === 'technical');
  }, [depth]);
  return <div className="security-explanation">
    <button className="explanation-toggle" aria-expanded={whyOpen} onClick={() => setWhyOpen(!whyOpen)}>
      {whyOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{tx(language, 'Why is this important?', 'なぜ重要？')}
    </button>
    {whyOpen && <div className="explanation-body">
      <p>{finding.why}</p>
      <div className="evidence-note"><strong>{tx(language, 'Assessment:', '評価の根拠：')}</strong> {finding.evidence === 'user-confirmed'
        ? tx(language, 'You personally checked this setting in the guided flow. The app did not independently inspect the device or account.', 'ガイドに沿ってご自身で設定を確認しました。アプリが端末やアカウントを独立して検査したわけではありません。')
        : finding.evidence === 'unknown'
          ? tx(language, 'You marked this as not sure. This is an assessment task, not evidence of a vulnerability.', '「わからない」と回答した項目です。評価のための確認であり、脆弱性の証拠ではありません。')
          : finding.evidence === 'not-assessed'
            ? tx(language, 'This setting has not been assessed. The recommendation is a check, not evidence of a vulnerability.', 'この設定は未評価です。これは確認の提案であり、脆弱性が見つかったという意味ではありません。')
            : tx(language, 'This is based on your self-reported assessment, not an independent scan.', '自己申告の評価に基づいています。独立した検査結果ではありません。')}</div>
      <div className="explanation-example"><strong>{tx(language, 'Example', '例')}</strong><span>{finding.threatScenario}</span></div>
      <p className="mitigation-copy">{finding.mitigationMechanism}</p>
      <button className="explanation-toggle explanation-priority-toggle" aria-expanded={priorityOpen} onClick={() => setPriorityOpen(!priorityOpen)}>
        {priorityOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{tx(language, 'Why is this prioritized?', 'なぜ優先されている？')}
      </button>
      {priorityOpen && <p className="priority-explanation">{finding.priorityRationale}</p>}
      <button className="explanation-toggle technical-toggle" aria-expanded={technicalOpen} onClick={() => setTechnicalOpen(!technicalOpen)}>
        {technicalOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{tx(language, 'Technical details', '技術的な解説')}
      </button>
      {technicalOpen && <div className="technical-explanation"><p>{finding.technicalExplanation}</p><p>{finding.limitations}</p>{finding.referenceSources.length > 0 && <ul>{finding.referenceSources.map((reference) => <li key={reference.url}><a href={reference.url} target="_blank" rel="noreferrer">{reference.title[language]}<ExternalLink size={12} /></a></li>)}</ul>}</div>}
    </div>}
  </div>;
}
