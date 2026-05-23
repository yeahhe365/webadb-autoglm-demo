import { AlertTriangle, Code2, ExternalLink, Gauge, GitFork, Languages, Monitor, Star } from 'lucide-react'
import type { AppCopy } from '../lib/appCopy'
import { REPOSITORY_URL, type RepositoryStats } from '../lib/repository'
import type { LanguageMode, ThemeMode } from '../lib/settings'

export type SettingsDialogProps = {
  copy: AppCopy
  languageMode: LanguageMode
  maxSteps: number
  onLanguageModeChange: (value: LanguageMode) => void
  onClose: () => void
  onMaxStepsChange: (value: number) => void
  onThemeModeChange: (value: ThemeMode) => void
  repositoryStats: RepositoryStats | null
  repositoryStatsStatus: 'idle' | 'loading' | 'done' | 'error'
  themeMode: ThemeMode
}

export function SettingsDialog({
  copy,
  languageMode,
  maxSteps,
  onLanguageModeChange,
  onClose,
  onMaxStepsChange,
  onThemeModeChange,
  repositoryStats,
  repositoryStatsStatus,
  themeMode,
}: SettingsDialogProps) {
  return (
    <div
      className="settings-page"
      role="dialog"
      aria-modal="true"
      aria-label={copy.settings}
      onClick={onClose}
    >
      <section className="settings-panel" onClick={(event) => event.stopPropagation()}>
        <div className="settings-header">
          <div>
            <p className="eyebrow">{copy.settings}</p>
            <h2>WebDroid Agent</h2>
          </div>
          <button
            type="button"
            className="settings-close"
            onClick={onClose}
            aria-label={copy.closeSettings}
          >
            {copy.close}
          </button>
        </div>
        <label className="settings-field">
          <span>
            <Languages size={16} />
            {copy.language}
          </span>
          <select
            value={languageMode}
            onChange={(event) => onLanguageModeChange(event.target.value as LanguageMode)}
          >
            <option value="system">{copy.languageSystem}</option>
            <option value="zh-CN">{copy.languageChinese}</option>
            <option value="en-US">{copy.languageEnglish}</option>
          </select>
        </label>
        <label className="settings-field">
          <span>
            <Monitor size={16} />
            {copy.theme}
          </span>
          <select
            value={themeMode}
            onChange={(event) => onThemeModeChange(event.target.value as ThemeMode)}
          >
            <option value="system">{copy.themeSystem}</option>
            <option value="light">{copy.themeLight}</option>
            <option value="dark">{copy.themeDark}</option>
          </select>
        </label>
        <label className="settings-field">
          <span>
            <Gauge size={16} />
            {copy.maxSteps}
          </span>
          <input
            type="number"
            min={1}
            max={200}
            value={maxSteps}
            onChange={(event) => onMaxStepsChange(Number(event.target.value))}
          />
        </label>
        <p className="settings-copy">{copy.appDescription}</p>
        <a
          className="repository-link"
          href={REPOSITORY_URL}
          target="_blank"
          rel="noreferrer"
          aria-label={copy.githubRepository}
        >
          <Code2 size={18} />
          <span>{REPOSITORY_URL}</span>
          <ExternalLink size={15} />
        </a>
        <div className="repository-stats" aria-label={copy.repositoryStats}>
          <div>
            <Star size={18} />
            <strong>
              {repositoryStatsStatus === 'loading'
                ? '...'
                : (repositoryStats?.stars.toLocaleString() ?? '-')}
            </strong>
            <span>{copy.stars}</span>
          </div>
          <div>
            <GitFork size={18} />
            <strong>
              {repositoryStatsStatus === 'loading'
                ? '...'
                : (repositoryStats?.forks.toLocaleString() ?? '-')}
            </strong>
            <span>{copy.forks}</span>
          </div>
          <div>
            <AlertTriangle size={18} />
            <strong>
              {repositoryStatsStatus === 'loading'
                ? '...'
                : (repositoryStats?.openIssues.toLocaleString() ?? '-')}
            </strong>
            <span>{copy.openIssues}</span>
          </div>
        </div>
        {repositoryStatsStatus === 'error' ? (
          <p className="settings-error">{copy.githubStatsError}</p>
        ) : null}
      </section>
    </div>
  )
}
