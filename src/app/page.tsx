'use client'

import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import Cookies from 'js-cookie'
import { useTranslations, Lang } from '@/lib/i18n'
import Header from '@/components/Header'


export default function Dashboard() {
    const [lang, setLang] = useState<Lang>('de')
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const [streamKey, setStreamKey] = useState('')
    const [showTutorial, setShowTutorial] = useState(false)

    const [state, setState] = useState({ obsConnected: false, broadcastActive: false, currentSource: null, publicIp: '' })
    const [targets, setTargets] = useState<any[]>([])
    const [videos, setVideos] = useState<string[]>([])
    const [activeVideo, setActiveVideo] = useState('')
    const [wsConnected, setWsConnected] = useState(false)

    // Realtime Polling
    const [obsStats, setObsStats] = useState({ bitrate: 0, fps: 0, width: 0, height: 0 })
    const [qualitySettings, setQualitySettings] = useState({ resolution: '1920x1080', fps: 60, bitrate: 6000 })
    const [isSavingQuality, setIsSavingQuality] = useState(false)

    // Modal States
    const [modalVideos, setModalVideos] = useState(false)
    const [modalTargets, setModalTargets] = useState(false)

    // Form States for adding a new target
    const [newTargetName, setNewTargetName] = useState('Twitch')
    const [newTargetUrl, setNewTargetUrl] = useState('rtmp://live.twitch.tv/app')
    const [newTargetKey, setNewTargetKey] = useState('')

    const wsRef = useRef<WebSocket | null>(null)
    const t = useTranslations(lang)

    useEffect(() => {
        const saved = localStorage.getItem('lang') as Lang
        if (saved && (saved === 'de' || saved === 'en')) setLang(saved)

        // Always check setup status FIRST — regardless of any cookie
        axios.get('/api/setup/status')
            .then(async ({ data }) => {
                if (!data.setupComplete) {
                    window.location.href = '/setup'
                    return
                }

                // Setup is done — check cookie
                const cookieKey = Cookies.get('streamKey')
                if (!cookieKey) {
                    window.location.href = '/login'
                    return
                }

                // Validate cookie key against DB (clears stale .env-era cookies)
                try {
                    await axios.get('/api/targets', { headers: { 'x-stream-key': cookieKey } })
                    // Key is valid
                    setStreamKey(cookieKey)
                    setIsAuthenticated(true)
                    connectWs(cookieKey)
                    fetchTargets()
                    fetchVideos()
                    fetchQualitySettings()
                    if (!localStorage.getItem('tutorial_shown')) {
                        setShowTutorial(true)
                        localStorage.setItem('tutorial_shown', '1')
                    }
                } catch {
                    // Stale/wrong cookie — clear it and send to login
                    Cookies.remove('streamKey')
                    window.location.href = '/login'
                }
            })
            .catch(() => { window.location.href = '/login' })

        const interval = setInterval(fetchStreamStats, 2000)
        return () => clearInterval(interval)
    }, [])

    const connectWs = (key: string) => {
        // Prevent multiple simultaneous connections
        if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
            return;
        }

        const host = window.location.host // Includes port
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const ws = new WebSocket(`${protocol}//${host}/ws?key=${key}`)

        ws.onopen = () => {
            if (wsRef.current === ws) {
                console.log('[WS] Connection established');
                setWsConnected(true)
            } else {
                ws.close(); // Close stray/stale connections
            }
        }

        ws.onclose = (event) => {
            if (wsRef.current === ws) {
                console.log('[WS] Connection closed:', event.code, event.reason);
                setWsConnected(false)
                // Only reconnect if this is still the active socket ref
                setTimeout(() => connectWs(key), 3000)
            }
        }

        ws.onmessage = (e) => {
            if (wsRef.current !== ws) return;
            try {
                const data = JSON.parse(e.data)
                if (data.type === 'STATE') {
                    setState(data.payload)
                }
            } catch (err) {
                console.error('[WS] Error parsing message:', err);
            }
        }

        ws.onerror = (err) => {
            console.error('[WS] Connection error:', err);
        }

        wsRef.current = ws
    }

    const fetchTargets = async () => {
        try {
            const { data } = await axios.get('/api/targets')
            setTargets(data || [])
        } catch (e) { }
    }

    const fetchVideos = async () => {
        try {
            const { data } = await axios.get('/api/videos')
            setVideos(data.files || [])
            setActiveVideo(data.activeVideo || '')
        } catch (e) { }
    }

    const fetchQualitySettings = async () => {
        try {
            const { data } = await axios.get('/api/settings/fallback')
            if (data) setQualitySettings(data)
        } catch (e) { }
    }

    const fetchStreamStats = async () => {
        try {
            const { data } = await axios.get('/api/nms/streams')
            if (data?.live) {
                const streamKey = Object.keys(data.live)[0]
                if (streamKey) {
                    const pub = data.live[streamKey]?.publisher
                    if (pub) {
                        setObsStats({
                            fps: pub.video?.fps || 0,
                            width: pub.video?.width || 0,
                            height: pub.video?.height || 0,
                            bitrate: pub.video?.profile || 0
                        })
                    }
                }
            } else {
                setObsStats({ bitrate: 0, fps: 0, width: 0, height: 0 })
            }
        } catch (e) { }
    }

    if (!isAuthenticated) return null

    const activeCount = targets.filter(t => t.enabled).length

    // Handlers
    const handleToggleTarget = async (id: number, enabled: boolean) => {
        await axios.put(`/api/targets/${id}/toggle`, { enabled: !enabled })
        fetchTargets()
    }

    const handleDeleteTarget = async (id: number) => {
        await axios.delete(`/api/targets/${id}`)
        fetchTargets()
    }

    const handleAddTarget = async (e: React.FormEvent) => {
        e.preventDefault()
        await axios.post('/api/targets', { name: newTargetName, url: newTargetUrl, stream_key: newTargetKey })
        setNewTargetKey('')
        fetchTargets()
    }

    const handleToggleBroadcast = () => {
        const socket = wsRef.current;
        const isReady = socket && socket.readyState === WebSocket.OPEN;

        console.log('[Dashboard] Toggle Broadcast clicked');
        console.log('[Dashboard] Current state.broadcastActive:', state.broadcastActive);
        console.log('[Dashboard] WebSocket state (React):', wsConnected ? 'Connected' : 'Disconnected');
        console.log('[Dashboard] WebSocket actual (Native):', socket ? (socket.readyState === 1 ? 'OPEN' : socket.readyState) : 'NULL');

        if (socket && isReady) {
            const message = JSON.stringify({ type: state.broadcastActive ? 'STOP_BROADCAST' : 'START_BROADCAST' });
            console.log('[Dashboard] Sending message:', message);
            socket.send(message);
        } else {
            console.warn('[Dashboard] Cannot send: WebSocket is not ready.');
            alert('WebSocket ist nicht bereit! Bitte lade die Seite neu, falls das Problem bestehen bleibt.\nStatus: ' + (socket ? socket.readyState : 'Keine Verbindung'));
        }
    }

    const handleReconnect = () => {
        if (wsRef.current && wsConnected) {
            wsRef.current.send(JSON.stringify({ type: 'RECONNECT_BROADCAST' }))
        }
    }

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.length) return
        const formData = new FormData()
        formData.append('video', e.target.files[0])
        try {
            await axios.post('/api/videos/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
            fetchVideos()
        } catch (err) {
            console.error(err)
        }
    }

    const handleSetLoop = async (file: string) => {
        await axios.post('/api/videos/active', { filename: file })
        fetchVideos()
    }

    const handleDeleteVideo = async (file: string) => {
        await axios.delete(`/api/videos/${file}`)
        fetchVideos()
    }

    const handleSaveQuality = async () => {
        setIsSavingQuality(true)
        try {
            await axios.post('/api/settings/fallback', qualitySettings)
            alert(t('quality_saved'))
        } catch (e) {
            alert('Error saving quality settings')
        } finally {
            setIsSavingQuality(false)
        }
    }

    return (
        <div className="app-container">
            {/* Tutorial Modal (shown once on first visit) */}
            {showTutorial && (
                <div className="modal open">
                    <div className="modal-backdrop" onClick={() => setShowTutorial(false)} />
                    <div className="modal-content card max-w-600" style={{ textAlign: 'center', padding: '2.5rem' }}>
                        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚡</div>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1rem' }}>So funktioniert ReStream Nexus</h2>
                        <div style={{ textAlign: 'left', marginBottom: '1.5rem' }}>
                            <div style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid var(--primary)', borderRadius: '12px', padding: '1rem', marginBottom: '0.75rem' }}>
                                <strong>Schritt 1 — OBS Stream starten</strong>
                                <p className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>Starte deinen Stream in OBS. ReStream Nexus empfängt das Signal automatisch via RTMP.</p>
                            </div>
                            <div style={{ background: 'rgba(46,213,115,0.1)', border: '1px solid var(--success)', borderRadius: '12px', padding: '1rem', marginBottom: '0.75rem' }}>
                                <strong>Schritt 2 — Übertragung auf der Website starten</strong>
                                <p className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>Klicke auf "Übertragung Starten" in der Kommandozentrale. Der Stream wird an alle aktiven Plattformen weitergeleitet.</p>
                            </div>
                            <div style={{ background: 'rgba(255,165,2,0.1)', border: '1px solid var(--warning)', borderRadius: '12px', padding: '1rem' }}>
                                <strong>Wichtig: Stream läuft solange die Übertragung aktiv ist</strong>
                                <p className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>Der Stream zu den Plattformen läuft solange du auf der Seite auf "Übertragung Beenden" klickst – auch wenn OBS getrennt wird (dann läuft das Fallback-Video).</p>
                            </div>
                        </div>
                        <button className="btn btn-primary" onClick={() => setShowTutorial(false)}>Verstanden, los geht&apos;s! 🚀</button>
                    </div>
                </div>
            )}

            <Header
                lang={lang}
                setLang={setLang}
                wsConnected={wsConnected}
                publicIp={state.publicIp}
                streamKey={streamKey}
                onLogout={() => { Cookies.remove('streamKey'); window.location.href = '/login' }}
            />

            <main>
                {/* Kommandozentrale */}
                <div className="mb-2">
                    <section className="card h-full flex-col">
                        <h2 className="card-title">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                                strokeLinecap="round" strokeLinejoin="round">
                                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                            </svg>
                            <span>{t('command_center')}</span>
                        </h2>

                        {/* Signals Row */}
                        <div className="signal-panels mb-2">

                            {/* OBS Input Panel */}
                            <div className="signal-card">
                                <div className="text-muted mb-05 text-sm">{t('incoming_obs')}</div>
                                <div className="text-lg text-bold items-center gap-075 flex">
                                    <div className={`status-dot ${state.obsConnected ? 'active' : 'danger'}`}></div>
                                    <span>{state.obsConnected ? t('obs_receiving') : t('waiting_obs')}</span>
                                </div>
                                <div className="text-muted text-sm mt-075">
                                    <span>{t('server')}</span> <span className="server-ip-display text-primary font-mono">rtmp://{state.publicIp}/live</span>
                                </div>
                                <div className="text-muted text-sm mt-025">
                                    <span>{t('streamkey')}</span> <span className="text-primary font-mono" style={{ fontSize: '0.78rem', wordBreak: 'break-all' }}>{streamKey || '—'}</span>
                                </div>
                            </div>

                            {/* Outgoing Broadcast Panel */}
                            <div className="signal-card">
                                <div className="text-muted mb-05 text-sm">{t('outgoing_cast')}</div>
                                <div className="text-lg text-bold items-center gap-075 flex">
                                    <div className={`status-dot ${state.broadcastActive ? 'warning' : 'danger'}`}></div>
                                    <span>{state.broadcastActive ? t('live_on_platforms') : t('offline')}</span>
                                </div>
                                {state.broadcastActive && (
                                    <div className="broadcast-source-text">
                                        <span className="text-primary">{t('current_broadcast_source')}: </span>
                                        {state.currentSource === 'obs' ? t('source_obs') : t('source_fallback')}
                                    </div>
                                )}

                                {/* Control Buttons */}
                                <div className="flex gap-1 mt-1">
                                    <button onClick={handleToggleBroadcast} className={`btn ${state.broadcastActive ? 'btn-danger' : 'btn-primary'} flex-1 p-05 text-sm`}>
                                        {state.broadcastActive ? t('stop_broadcast') : t('start_broadcast')}
                                    </button>
                                    {state.broadcastActive && (
                                        <button onClick={handleReconnect} className="btn btn-warning p-05 text-sm flex-center" title={t('reconnect')} style={{ background: '#f59e0b', color: '#000' }}>
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M23 4v6h-6"></path>
                                                <path d="M1 20v-6h6"></path>
                                                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"></path>
                                                <path d="M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                                            </svg>
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Manual Quality Control Panel */}
                            <div className="signal-card">
                                <div className="text-muted mb-05 text-sm">{t('quality_settings')}</div>
                                <div className="grid-form gap-05">
                                    <div className="form-group mb-0">
                                        <label className="text-xs">{t('resolution')}</label>
                                        <select
                                            value={qualitySettings.resolution}
                                            onChange={(e) => setQualitySettings({ ...qualitySettings, resolution: e.target.value })}
                                            className="form-control p-025 text-sm"
                                        >
                                            <option value="1920x1080">1920x1080 (FullHD)</option>
                                            <option value="1280x720">1280x720 (HD)</option>
                                            <option value="854x480">854x480 (480p)</option>
                                        </select>
                                    </div>
                                    <div className="flex gap-05">
                                        <div className="form-group mb-0 flex-1">
                                            <label className="text-xs">{t('fps')}</label>
                                            <input
                                                type="number"
                                                value={qualitySettings.fps}
                                                onChange={(e) => setQualitySettings({ ...qualitySettings, fps: parseInt(e.target.value) })}
                                                className="form-control p-025 text-sm"
                                            />
                                        </div>
                                        <div className="form-group mb-0 flex-1">
                                            <label className="text-xs">{t('bitrate_k')}</label>
                                            <input
                                                type="number"
                                                value={qualitySettings.bitrate}
                                                step="500"
                                                onChange={(e) => setQualitySettings({ ...qualitySettings, bitrate: parseInt(e.target.value) })}
                                                className="form-control p-025 text-sm"
                                            />
                                        </div>
                                    </div>
                                    <button
                                        onClick={handleSaveQuality}
                                        disabled={isSavingQuality}
                                        className="btn btn-primary p-04 text-xs mt-025 w-full"
                                    >
                                        {isSavingQuality ? '...' : t('save_quality')}
                                    </button>
                                    <div className="text-xs text-muted italic mt-025" style={{ fontSize: '0.65rem' }}>
                                        {t('quality_hint')}
                                    </div>
                                </div>
                            </div>

                        </div>
                    </section>
                </div>

                {/* Two Columns: Fallback & Targets */}
                <div className="grid-cols-1-1 mb-2">

                    {/* Fallback Videos Section */}
                    <section className="card h-full flex-col justify-between">
                        <h2 className="card-title">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                                strokeLinecap="round" strokeLinejoin="round">
                                <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
                                <line x1="7" y1="2" x2="7" y2="22"></line>
                                <line x1="17" y1="2" x2="17" y2="22"></line>
                                <line x1="2" y1="12" x2="22" y2="12"></line>
                                <line x1="2" y1="7" x2="7" y2="7"></line>
                                <line x1="2" y1="17" x2="7" y2="17"></line>
                                <line x1="17" y1="17" x2="22" y2="17"></line>
                                <line x1="17" y1="7" x2="22" y2="7"></line>
                            </svg>
                            <span>{t('fallback_videos')}</span>
                        </h2>

                        <div className="h-full flex-col justify-between">
                            <p className="text-muted text-sm mb-1">{t('fallback_desc')}</p>

                            <div className="flex-between items-center mt-1">
                                <div>
                                    <div className="text-sm text-muted">{t('active_backup')}</div>
                                    <div className="text-md text-bold text-primary mt-025">
                                        {activeVideo ? activeVideo : t('no_backup')}
                                    </div>
                                </div>
                                <button onClick={() => setModalVideos(true)} className="btn btn-primary p-075" title="Videos Verwalten">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                                        strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
                                    </svg>
                                    <span>{t('media_library')}</span>
                                </button>
                            </div>
                        </div>
                    </section>

                    {/* Ziel-Verwaltung */}
                    <section className="card h-full flex-col justify-between">
                        <h2 className="card-title">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                                strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                            </svg>
                            <span>{t('target_management')}</span>
                        </h2>

                        <div className="flex-between items-center mb-1">
                            <div>
                                <div className="text-sm text-muted">{t('active_platforms')}</div>
                                <div className="text-lg text-bold text-primary mt-025">
                                    {targets.length} {t('targets_count')} ({activeCount} {t('active_count')})
                                </div>
                            </div>
                            <button onClick={() => setModalTargets(true)} className="btn btn-primary p-075" title="Ziele Verwalten">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                                    strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 20h9"></path>
                                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                                </svg>
                                <span>{t('edit')}</span>
                            </button>
                        </div>
                    </section>
                </div>

                {/* Analytics Dashboard */}
                <section className="card mt-2">
                    <h2 className="card-title">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                            strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="20" x2="18" y2="10"></line>
                            <line x1="12" y1="20" x2="12" y2="4"></line>
                            <line x1="6" y1="20" x2="6" y2="14"></line>
                        </svg>
                        <span>{t('analytics_stats')}</span>
                    </h2>

                    <div className="stats-grid mt-15">
                        {/* General OBS Stats */}
                        <div className="stat-card">
                            <div className="text-muted text-sm mb-1">{t('server_obs_in')}</div>
                            <div className="flex-between mb-05">
                                <span className="text-sm">{t('bitrate')}</span>
                                <span className="text-bold text-primary">{obsStats.bitrate > 0 ? `${obsStats.bitrate} kbps` : '-- kbps'}</span>
                            </div>
                            <div className="flex-between mb-05">
                                <span className="text-sm">Video:</span>
                                <span className="font-mono text-sm">{obsStats.width > 0 ? `${obsStats.width}x${obsStats.height} @ ${obsStats.fps}fps` : '-- fps'}</span>
                            </div>
                            <div className="flex-between">
                                <span className="text-sm">{t('uptime')}</span>
                                <span className="font-mono text-sm text-muted">00:00:00</span>
                            </div>
                        </div>

                        {/* Target Stats */}
                        <div className="platform-stats grid-cols-3">
                            {targets.length === 0 ? (
                                <div className="stat-card no-targets-msg">
                                    <div className="text-muted text-sm text-center">{t('add_targets_msg')}</div>
                                </div>
                            ) : (
                                targets.map(tgt => {
                                    const isLive = state.broadcastActive && tgt.enabled
                                    const statusColor = isLive ? 'var(--success)' : 'var(--text-muted)'
                                    const statusText = isLive ? t('sending') : t('paused')
                                    return (
                                        <div key={tgt.id} className="stat-card" style={{ opacity: tgt.enabled ? 1 : 0.5 }}>
                                            <div className="flex-between mb-1">
                                                <div className="text-bold">{tgt.name}</div>
                                                <div className="status-dot" style={{ background: statusColor, boxShadow: `0 0 10px ${statusColor}`, marginRight: 0 }}></div>
                                            </div>
                                            <div className="flex-between mb-05">
                                                <span className="text-sm text-muted">{t('viewers')}</span>
                                                <span className="text-bold">--</span>
                                            </div>
                                            <div className="flex-between">
                                                <span className="text-sm text-muted">{t('status')}</span>
                                                <span className="text-sm text-muted">{statusText}</span>
                                            </div>
                                        </div>
                                    )
                                })
                            )}
                        </div>
                    </div>
                </section>
            </main>

            {/* Target Management Modal */}
            {modalTargets && (
                <div className="modal open">
                    <div className="modal-backdrop" onClick={() => setModalTargets(false)}></div>
                    <div className="modal-content card">
                        <div className="flex-between items-center mb-2">
                            <h2 className="card-title mb-0">{t('manage_platforms')}</h2>
                            <button onClick={() => setModalTargets(false)} className="btn-icon" title="Schließen">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                            </button>
                        </div>

                        <form onSubmit={handleAddTarget} className="grid-form gap-1 items-end mb-2">
                            <div className="form-group mb-0">
                                <label>{t('select_platform')}</label>
                                <select
                                    value={newTargetName}
                                    onChange={(e) => {
                                        const p = e.target.value
                                        setNewTargetName(p)
                                        const map: Record<string, string> = {
                                            Twitch: 'rtmp://live.twitch.tv/app',
                                            YouTube: 'rtmp://a.rtmp.youtube.com/live2',
                                            Facebook: 'rtmps://live-api-s.facebook.com:443/rtmp',
                                            Kick: 'rtmps://fa723fc1b171.global-contribute.live-video.net/app',
                                            Trovo: 'rtmp://live.trovo.live/live',
                                            DLive: 'rtmp://stream.dlive.tv/live',
                                            VK: 'rtmp://ovsu.mycdn.me/input/',
                                            'OK.ru': 'rtmp://rtmp.ok.ru/live',
                                            Custom: ''
                                        }
                                        setNewTargetUrl(map[p] || '')
                                    }}
                                    className="form-control" title="Plattform"
                                >
                                    {['Twitch', 'YouTube', 'Facebook', 'Kick', 'TikTok', 'Instagram', 'Trovo', 'DLive', 'VK', 'OK.ru', 'Custom'].map(p => (
                                        <option key={p} value={p}>{t(`platform_${p.toLowerCase().replace('.', '')}` as any)}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group mb-0">
                                <label>{t('rtmp_server_url')}</label>
                                <input required type="text" value={newTargetUrl} onChange={(e) => setNewTargetUrl(e.target.value)} className="form-control" placeholder="rtmp://" disabled={newTargetName !== 'Custom'} />
                            </div>
                            <div className="form-group mb-0">
                                <label>{t('stream_key_label')}</label>
                                <input required type="password" value={newTargetKey} onChange={(e) => setNewTargetKey(e.target.value)} className="form-control" placeholder="live_" />
                            </div>
                            <button type="submit" className="btn btn-primary p-075" title="Ziel Hinzufügen">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                            </button>
                        </form>

                        <div className="target-list">
                            {targets.map(tgt => (
                                <div key={tgt.id} className="target-item flex-between items-center" style={{ opacity: tgt.enabled ? 1 : 0.5 }}>
                                    <div className="target-info">
                                        <h4>{tgt.name}</h4>
                                        <p>{tgt.url}</p>
                                    </div>
                                    <div className="items-center gap-1 flex">
                                        <button onClick={() => handleToggleTarget(tgt.id, tgt.enabled)} type="button" className={`btn btn-toggle p-04-10 text-sm target-btn-${tgt.enabled ? 'active' : 'paused'}`}>
                                            {tgt.enabled ? t('enabled') : t('paused')}
                                        </button>
                                        <button onClick={() => handleDeleteTarget(tgt.id)} type="button" className="btn-icon btn-delete" title={t('remove')}>
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Videos Modal */}
            {modalVideos && (
                <div className="modal open">
                    <div className="modal-backdrop" onClick={() => setModalVideos(false)}></div>
                    <div className="modal-content card max-w-600">
                        <div className="flex-between items-center mb-2">
                            <h2 className="card-title mb-0">{t('video_library')}</h2>
                            <button onClick={() => setModalVideos(false)} className="btn-icon" title="Schließen">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                            </button>
                        </div>
                        <div className="mb-2 pb-2 border-b">
                            <input type="file" id="upload-file" accept="video/mp4" onChange={handleFileUpload} className="display-none" />
                            <label htmlFor="upload-file" id="upload-label" className="btn btn-primary w-full p-1 flex-center gap-05 upload-label-btn">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                                <span>{t('video_select')}</span>
                            </label>
                        </div>
                        <div className="flex-col gap-05">
                            {videos.map(v => (
                                <div key={v} className={`target-item flex-between items-center ${activeVideo === v ? 'active' : ''}`}>
                                    <div className="target-info"><h4>{v}</h4></div>
                                    <div className="items-center gap-1 flex">
                                        {activeVideo === v ? (
                                            <span className="text-success text-sm flex gap-05 items-center">
                                                <div className="status-dot active"></div> {t('is_active')}
                                            </span>
                                        ) : (
                                            <button onClick={() => handleSetLoop(v)} className="btn p-04-10 text-sm" style={{ background: 'rgba(255,255,255,0.05)', color: 'white' }}>{t('set_loop')}</button>
                                        )}
                                        <button onClick={() => handleDeleteVideo(v)} className="btn-icon btn-delete" title={t('delete_video')}>
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

        </div>
    )
}
