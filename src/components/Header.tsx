'use client'
import { Lang, translations } from '@/lib/i18n'

interface HeaderProps {
    lang: Lang
    setLang: (lang: Lang) => void
    wsConnected: boolean
    onLogout: () => void
    streamKey?: string
    publicIp?: string
}

export default function Header({ lang, setLang, wsConnected, onLogout, streamKey, publicIp }: HeaderProps) {
    const t = (key: keyof typeof translations['en']): string => translations[lang][key] || key

    const toggleLang = () => {
        const next = lang === 'de' ? 'en' : 'de'
        setLang(next)
        localStorage.setItem('lang', next)
    }

    return (
        <div className="sticky-nav">
            <div className="flex items-center gap-1">
                <span style={{ fontSize: '1.5rem' }}>⚡</span>
                <h1>ReStream Nexus</h1>
            </div>

            <div className="flex items-center gap-1">
                {publicIp && (
                    <span className="text-muted text-sm font-mono">{t('server')} {publicIp}</span>
                )}
                {streamKey && (
                    <span className="text-muted text-sm font-mono" title="Stream Key">
                        🔑 <code style={{ userSelect: 'all', cursor: 'pointer' }}>{streamKey}</code>
                    </span>
                )}
                <div className="status-badge">
                    <span className="text-muted text-sm">{t('system_status')}</span>
                    <div className={`status-dot ${wsConnected ? 'active' : 'warning'}`} />
                </div>
                <button onClick={toggleLang} className="btn lang-select-btn text-sm" style={{ padding: '0.4rem 0.75rem' }}>
                    {lang === 'de' ? '🇩🇪 DE' : '🇬🇧 EN'}
                </button>
                <button onClick={onLogout} className="btn btn-danger" style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}>
                    {t('logout')}
                </button>
            </div>
        </div>
    )
}
