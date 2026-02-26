'use client'
import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import Header from '@/components/Header'
import { Lang, useTranslations } from '@/lib/i18n'
import { useToast } from '@/components/Toast'

// Steps: 1=Password, 2=KeyDisplay+OBS+Test, 3=Targets, 4=Video, 5=Finalizing
type Step = 1 | 2 | 3 | 4 | 5

const TOTAL_STEPS = 5

const setupCss = `
.setup-wrap { display: flex; align-items: center; justify-content: center; padding: 2rem; min-height: calc(100vh - 80px); }
.setup-card { width: 100%; max-width: 560px; }
.setup-steps { display: flex; gap: 0.4rem; margin-bottom: 2rem; }
.setup-step-dot { flex: 1; height: 4px; border-radius: 99px; background: rgba(255,255,255,0.1); transition: background 0.3s; }
.setup-step-dot.done { background: var(--primary); }
.setup-step-dot.active { background: var(--success); }
.step-title { font-size: 1.6rem; font-weight: 700; margin-bottom: 0.5rem;
  background: linear-gradient(135deg, #fff 0%, #a5b4fc 100%);
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.step-sub { color: var(--text-muted); margin-bottom: 1.5rem; font-size: 0.95rem; }
.rtmp-box { font-family: monospace; background: rgba(0,0,0,0.4); border: 1px solid var(--border-color);
  border-radius: 12px; padding: 1rem; margin-bottom: 1rem; word-break: break-all; }
.rtmp-box .rtmp-label { color: var(--text-muted); font-size: 0.8rem; margin-bottom: 0.25rem; }
.rtmp-box .rtmp-val { color: var(--primary); font-weight: 600; font-size: 0.95rem; }
.obs-waiting { display:flex; flex-direction:column; align-items:center; gap:0.75rem; padding: 1.25rem 0; }
.spinner { width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.1); border-top-color: var(--success);
  border-radius: 50%; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.success-icon { font-size: 2.5rem; animation: pop 0.4s cubic-bezier(0.175,0.885,0.32,1.275) forwards; }
@keyframes pop { from{transform:scale(0)} to{transform:scale(1)} }
.progress-bar-wrap { width: 100%; height: 6px; background: rgba(255,255,255,0.1); border-radius: 99px; overflow:hidden; margin-top:1rem; }
.progress-bar-fill { height: 100%; background: linear-gradient(90deg, var(--primary), var(--success)); border-radius: 99px;
  transition: width 0.5s ease; }
.finalizing { display:flex; flex-direction:column; align-items:center; gap: 0.75rem; padding: 2rem 0; text-align:center; }
`

export default function SetupPage() {
    const [step, setStep] = useState<Step>(1)
    const [ready, setReady] = useState(false)
    const [lang, setLang] = useState<Lang>('de')
    const t = useTranslations(lang)
    const { addToast } = useToast()
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [pwError, setPwError] = useState('')
    const [streamKey, setStreamKey] = useState('')
    const [publicIp, setPublicIp] = useState('...')
    const [obsDetected, setObsDetected] = useState(false)
    const [obsCountdown, setObsCountdown] = useState(5)
    const [targets, setTargets] = useState<any[]>([])
    const [addingTarget, setAddingTarget] = useState({ name: 'Twitch', url: 'rtmp://live.twitch.tv/app', key: '' })
    const [videos, setVideos] = useState<string[]>([])
    const [activeVideo, setActiveVideo] = useState('')
    const [progress, setProgress] = useState(0)
    const [loading, setLoading] = useState(false)
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

    // On mount: check setup status, resume at currentStep, get public IP
    useEffect(() => {
        const saved = localStorage.getItem('lang') as Lang
        if (saved && (saved === 'de' || saved === 'en')) setLang(saved)

        axios.get('/api/setup/status')
            .then(({ data }) => {
                if (data.setupComplete) { window.location.href = '/login'; return }
                const s = data.currentStep as Step
                if (s && s > 1) setStep(s)
                setReady(true)
            })
            .catch(() => setReady(true))

        fetch('https://api.ipify.org?format=json')
            .then(r => r.json())
            .then((d: { ip: string }) => setPublicIp(d.ip))
            .catch(() => setPublicIp('localhost'))
    }, [])

    // Step 2: load existing key first (resume), or generate new one
    useEffect(() => {
        if (step !== 2) return
        if (streamKey) return
        axios.get('/api/setup/stream-key')
            .then(({ data }) => {
                if (data.streamKey) { setStreamKey(data.streamKey); return }
                return axios.post('/api/setup/stream-key').then(({ data: d }) => setStreamKey(d.streamKey))
            })
            .catch(() => { })
    }, [step])

    // Step 2: poll /api/nms/streams every 2s to detect OBS (with new key as auth header)
    useEffect(() => {
        if (step !== 2) return
        if (obsDetected) return
        if (!streamKey) return

        pollRef.current = setInterval(async () => {
            try {
                const { data } = await axios.get('/api/nms/streams', {
                    headers: { 'x-stream-key': streamKey }
                })
                if (data?.live && Object.keys(data.live).length > 0) {
                    setObsDetected(true)
                    if (pollRef.current) clearInterval(pollRef.current)
                }
            } catch { }
        }, 2000)

        return () => { if (pollRef.current) clearInterval(pollRef.current) }
    }, [step, streamKey, obsDetected])

    // Countdown after OBS detected, then call obs-verified + auto-advance
    useEffect(() => {
        if (!obsDetected) return
        if (obsCountdown <= 0) {
            axios.post('/api/setup/obs-verified').catch(() => { })
            setStep(3)
            return
        }
        const t = setTimeout(() => setObsCountdown(c => c - 1), 1000)
        return () => clearTimeout(t)
    }, [obsDetected, obsCountdown])

    // ── Handlers ──────────────────────────────────────────────────────────────
    const handleSetPassword = async () => {
        if (password.length < 6) { setPwError('Mindestens 6 Zeichen erforderlich.'); return }
        if (password !== confirmPassword) { setPwError('Passwörter stimmen nicht überein.'); return }
        setLoading(true)
        try {
            await axios.post('/api/setup/password', { password })
            setStep(2)
        } catch { setPwError('Fehler beim Speichern.') }
        setLoading(false)
    }

    const handleAddTarget = async () => {
        if (!addingTarget.key || !addingTarget.url) return
        await axios.post('/api/targets', {
            name: addingTarget.name, url: addingTarget.url, stream_key: addingTarget.key
        }, { headers: { 'x-stream-key': streamKey } })
        const { data } = await axios.get('/api/targets', { headers: { 'x-stream-key': streamKey } })
        setTargets(data)
        setAddingTarget({ name: 'Twitch', url: 'rtmp://live.twitch.tv/app', key: '' })
    }

    const platformMap: Record<string, string> = {
        Twitch: 'rtmp://live.twitch.tv/app',
        YouTube: 'rtmp://a.rtmp.youtube.com/live2',
        Facebook: 'rtmps://live-api-s.facebook.com:443/rtmp',
        Kick: 'rtmps://fa723fc1b171.global-contribute.live-video.net/app',
        Trovo: 'rtmp://live.trovo.live/live',
        DLive: 'rtmp://stream.dlive.tv/live',
        VK: 'rtmp://ovsu.mycdn.me/input/',
        Custom: ''
    }
    const platforms = Object.keys(platformMap)

    const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!(e.target as HTMLInputElement).files?.length) return
        const fd = new FormData()
        fd.append('video', (e.target as HTMLInputElement).files![0])
        await axios.post('/api/videos/upload', fd, {
            headers: { 'Content-Type': 'multipart/form-data', 'x-stream-key': streamKey }
        })
        const { data } = await axios.get('/api/videos', { headers: { 'x-stream-key': streamKey } })
        setVideos(data.files || [])
        if (!activeVideo && data.files?.[0]) setActiveVideo(data.files[0])
    }

    const handleSetActiveVideo = async (file: string) => {
        await axios.post('/api/videos/active', { filename: file }, { headers: { 'x-stream-key': streamKey } })
        setActiveVideo(file)
    }

    const handleFinalize = async () => {
        setStep(5)
        for (let i = 0; i <= 100; i += 10) {
            await new Promise(r => setTimeout(r, 200))
            setProgress(i)
        }
        await axios.post('/api/setup/complete')
        window.location.href = '/'
    }

    const dots = Array.from({ length: TOTAL_STEPS }, (_, i) => {
        const n = i + 1
        if (n < step) return 'done'
        if (n === step) return 'active'
        return ''
    })

    if (!ready) return (
        <div className="app-container flex-center" style={{ height: '100vh' }}>
            <div className="spinner" />
        </div>
    )

    return (
        <>
            <style>{setupCss}</style>
            <div className="app-container">
                <Header lang={lang} setLang={setLang} wsConnected={false} onLogout={() => { }} />

                <div className="setup-wrap">
                    <div className="setup-card card">
                        <div className="setup-steps">
                            {dots.map((cls, i) => <div key={i} className={`setup-step-dot ${cls}`} />)}
                        </div>

                        {/* ── Step 1: Password ───────────────────────────────── */}
                        {step === 1 && (
                            <div>
                                <div className="step-title">{t('setup_welcome')}</div>
                                <div className="step-sub">{t('setup_welcome_sub')}</div>
                                <div className="form-group">
                                    <label>{t('setup_password')}</label>
                                    <input type="password" className="form-control" value={password}
                                        onChange={e => { setPassword((e.target as HTMLInputElement).value); setPwError('') }}
                                        onKeyDown={e => e.key === 'Enter' && handleSetPassword()}
                                        placeholder={t('setup_password_placeholder')} autoFocus />
                                </div>
                                <div className="form-group">
                                    <label>{t('setup_password_confirm')}</label>
                                    <input type="password" className="form-control" value={confirmPassword}
                                        onChange={e => { setConfirmPassword((e.target as HTMLInputElement).value); setPwError('') }}
                                        onKeyDown={e => e.key === 'Enter' && handleSetPassword()}
                                        placeholder={t('setup_password_repeat')} />
                                </div>
                                {pwError && <p className="text-sm mb-1" style={{ color: 'var(--danger)' }}>{t(pwError as any) || pwError}</p>}
                                <button className="btn btn-primary w-full" disabled={loading} onClick={handleSetPassword}>
                                    {loading ? t('setup_saving') : t('setup_next')}
                                </button>
                            </div>
                        )}

                        {/* ── Step 2: Stream Key + OBS Config + Connection Test ─ */}
                        {step === 2 && (
                            <div>
                                <div className="step-title">{t('setup_obs_test')}</div>
                                <div className="step-sub">{t('setup_obs_test_sub')}</div>

                                {!streamKey ? (
                                    <div className="obs-waiting"><div className="spinner" /><span className="text-muted">{t('setup_generating_key')}</span></div>
                                ) : (
                                    <>
                                        <div className="rtmp-box">
                                            <div className="rtmp-label">{t('setup_rtmp_url')}</div>
                                            <div className="rtmp-val">rtmp://{publicIp}/live</div>
                                        </div>
                                        <div className="rtmp-box">
                                            <div className="rtmp-label">{t('setup_stream_key_copy')}</div>
                                            <div className="rtmp-val" style={{ wordBreak: 'break-all', cursor: 'pointer', userSelect: 'all' }} title="Klicken zum Markieren">{streamKey}</div>
                                        </div>

                                        <div className="obs-waiting">
                                            {!obsDetected ? (
                                                <>
                                                    <div className="spinner" />
                                                    <span className="text-muted text-sm">{t('setup_waiting_obs')}</span>
                                                </>
                                            ) : (
                                                <>
                                                    <div className="success-icon">✅</div>
                                                    <span className="text-success" style={{ fontWeight: 700 }}>{t('setup_obs_connected')}</span>
                                                    <span className="text-muted text-sm">{t('setup_continue_in')} {obsCountdown}s...</span>
                                                </>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {/* ── Step 3: Targets ───────────────────────────────── */}
                        {step === 3 && (
                            <div>
                                <div className="step-title">{t('setup_targets_title')}</div>
                                <div className="step-sub">{t('setup_targets_sub')}</div>

                                {targets.length > 0 && (
                                    <div className="target-list mb-1">
                                        {targets.map((t: any) => (
                                            <div key={t.id} className="target-item">
                                                <div className="target-info"><h4>{t.name}</h4><p>{t.url}</p></div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div className="flex-col gap-05 mb-1">
                                    <select title={t('platform')} className="form-control" value={addingTarget.name}
                                        onChange={e => {
                                            setAddingTarget(a => ({ ...a, name: (e.target as HTMLSelectElement).value, url: platformMap[(e.target as HTMLSelectElement).value] || '' }))
                                        }}>
                                        {platforms.map(p => <option key={p} value={p}>{t(`platform_${p.toLowerCase().replace('.', '')}` as any)}</option>)}
                                    </select>
                                    <input className="form-control" placeholder={t('rtmp_server_url')} value={addingTarget.url}
                                        onChange={e => setAddingTarget(a => ({ ...a, url: (e.target as HTMLInputElement).value }))} />
                                    <input className="form-control" placeholder={t('stream_key_label')} value={addingTarget.key}
                                        onChange={e => setAddingTarget(a => ({ ...a, key: (e.target as HTMLInputElement).value }))} />
                                    <button className="btn btn-primary" onClick={handleAddTarget}>{t('setup_add_target')}</button>
                                </div>

                                <button className="btn btn-danger w-full mt-1" onClick={() => setStep(4)}>
                                    {targets.length > 0 ? t('setup_targets_saved') : t('setup_skip')}
                                </button>
                            </div>
                        )}

                        {/* ── Step 4: Fallback Video ────────────────────────── */}
                        {step === 4 && (
                            <div>
                                <div className="step-title">{t('setup_fallback_title')}</div>
                                <div className="step-sub">{t('setup_fallback_sub_wizard')}</div>

                                <label className="btn upload-label-btn w-full flex-center gap-05 mb-1">
                                    <span>{t('setup_upload_video')}</span>
                                    <input type="file" accept="video/mp4" style={{ display: 'none' }} onChange={handleVideoUpload} />
                                </label>

                                {videos.length > 0 && (
                                    <div className="target-list mb-1">
                                        {videos.map(v => (
                                            <div key={v} className={`target-item ${v === activeVideo ? 'active' : ''}`}>
                                                <div className="target-info">
                                                    <h4>{v}</h4>
                                                    {v === activeVideo && <p className="text-success">{t('setup_active_v')}</p>}
                                                </div>
                                                <button className="btn btn-primary text-sm" style={{ padding: '0.4rem 0.75rem' }}
                                                    onClick={() => handleSetActiveVideo(v)}>{t('setup_as_loop')}</button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <button className="btn btn-danger w-full" onClick={handleFinalize}>
                                    {videos.length > 0 ? t('setup_finish') : t('setup_skip_finish')}
                                </button>
                            </div>
                        )}

                        {/* ── Step 5: Finalizing ────────────────────────────── */}
                        {step === 5 && (
                            <div className="finalizing">
                                <div className="spinner" />
                                <div className="step-title" style={{ WebkitTextFillColor: 'white' }}>{t('setup_finalizing_title')}</div>
                                <div className="progress-bar-wrap w-full">
                                    <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
                                </div>
                                <p className="text-muted text-sm">{t('setup_saving_data')}</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    )
}
