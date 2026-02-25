'use client'

import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import Cookies from 'js-cookie'

// --- i18n Dictionary ---
const translations = {
    de: {
        system_status: "System-Status:", logout: "Logout", command_center: "Kommandozentrale",
        incoming_obs: "Eingehendes OBS-Signal", waiting_obs: "Warte auf OBS", obs_receiving: "Daten empfangen",
        server: "Server:", streamkey: "Streamkey:", env_config: "(Deine .env Konfiguration)",
        outgoing_cast: "Ausgehende Übertragung", offline: "Offline", live_on_platforms: "Live auf Plattformen",
        preview_warning: "Nur Preview-Modus aktiv (Keine externen Ziele gewählt)",
        fallback_videos: "Fallback-Videos", fallback_desc: "Backup-Videos für den Fall eines Stream-Ausfalls.",
        video_select: "Video Auswählen", active_backup: "Aktives Backup", no_backup: "Kein Backup geladen",
        media_library: "Mediathek", target_management: "Ziel-Verwaltung", select_platform: "Plattform auswählen",
        custom: "Custom", rtmp_server_url: "RTMP Server-URL", stream_key_label: "Stream-Key",
        active_platforms: "Aktive Plattformen", zero_targets: "0 Ziele", targets_count: "Ziele", active_count: "Aktiv",
        edit: "Bearbeiten", analytics_stats: "Analytics & Statistiken", server_obs_in: "Server (OBS Eingang)",
        bitrate: "Bitrate:", uptime: "Uptime:", add_targets_msg: "Füge Ziele hinzu, um hier Plattform-Statistiken zu sehen.",
        video_library: "Video Mediathek", manage_platforms: "Plattformen verwalten",
        source_obs: "Quelle: Live OBS Feed", source_fallback: "Quelle: Fallback Video-Loop!",
        current_broadcast_source: "Aktuelle Sende-Quelle", obs_live_feed: "OBS Live Feed",
        obs_live_sub: "Dein OBS Stream wird gesendet.", fallback_video: "Fallback Video", fallback_sub: "Stream Offline - Loop läuft.",
        not_broadcasting: "Nicht auf Sendung", not_broadcasting_sub: "Übertragung an Plattformen ist pausiert.",
        start_broadcast: "Übertragung Starten (Rendern)", stop_broadcast: "Übertragung Beenden", reconnect: "Reconnect",
        no_videos_server: "Keine Videos auf dem Server. Bitte lade eine .mp4 Datei hoch.",
        is_active: "Ist Aktiv", set_loop: "Als Loop setzen", delete_video: "Video löschen",
        no_targets_defined: "Keine Übertragungsziele definiert.",
        enabled: "Aktiviert", paused: "Pausiert", remove: "Entfernen",
        viewers: "Zuschauer:", status: "Status:", sending: "Sende",
        uploading: "Lädt hoch...", upload_error: "Fehler beim Upload. Bitte versuche es später."
    },
    en: {
        system_status: "System-Status:", logout: "Logout", command_center: "Command Center",
        incoming_obs: "Incoming OBS Signal", waiting_obs: "Waiting for OBS", obs_receiving: "Receiving Data",
        server: "Server:", streamkey: "Streamkey:", env_config: "(Your .env Config)",
        outgoing_cast: "Outgoing Broadcast", offline: "Offline", live_on_platforms: "Live on Platforms",
        preview_warning: "Preview Mode Active (No external targets selected)",
        fallback_videos: "Fallback Videos", fallback_desc: "Backup videos in case the stream drops.",
        video_select: "Select Video", active_backup: "Active Backup", no_backup: "No backup loaded",
        media_library: "Media Library", target_management: "Target Management", select_platform: "Select Platform",
        custom: "Custom", rtmp_server_url: "RTMP Server URL", stream_key_label: "Stream Key",
        active_platforms: "Active Platforms", zero_targets: "0 Targets", targets_count: "Targets", active_count: "Active",
        edit: "Edit", analytics_stats: "Analytics & Statistics", server_obs_in: "Server (OBS Input)",
        bitrate: "Bitrate:", uptime: "Uptime:", add_targets_msg: "Add targets to see platform statistics here.",
        video_library: "Video Library", manage_platforms: "Manage Platforms",
        source_obs: "Source: Live OBS Feed", source_fallback: "Source: Fallback Video Loop!",
        current_broadcast_source: "Current Broadcast Source", obs_live_feed: "OBS Live Feed",
        obs_live_sub: "Your OBS stream is broadcasting.", fallback_video: "Fallback Video", fallback_sub: "Stream Offline - Loop running.",
        not_broadcasting: "Off-Air", not_broadcasting_sub: "Broadcast to platforms is paused.",
        start_broadcast: "Start Broadcast (Render)", stop_broadcast: "Stop Broadcast", reconnect: "Reconnect",
        no_videos_server: "No videos on the server. Please upload an .mp4 file.",
        is_active: "Active", set_loop: "Set as Loop", delete_video: "Delete Video",
        no_targets_defined: "No broadcast targets defined.",
        enabled: "Enabled", paused: "Paused", remove: "Remove",
        viewers: "Viewers:", status: "Status:", sending: "Live",
        uploading: "Uploading...", upload_error: "Upload failed. Please try again later."
    }
}

export default function Dashboard() {
    const [lang, setLang] = useState<'de' | 'en'>('de')
    const [isAuthenticated, setIsAuthenticated] = useState(false)

    const [state, setState] = useState({ obsConnected: false, broadcastActive: false, currentSource: null, publicIp: '' })
    const [targets, setTargets] = useState<any[]>([])
    const [videos, setVideos] = useState<string[]>([])
    const [activeVideo, setActiveVideo] = useState('')
    const [wsConnected, setWsConnected] = useState(false)

    // Realtime Polling
    const [obsStats, setObsStats] = useState({ bitrate: 0, fps: 0, width: 0, height: 0 })

    // Modal States
    const [modalVideos, setModalVideos] = useState(false)
    const [modalTargets, setModalTargets] = useState(false)

    // Form States for adding a new target
    const [newTargetName, setNewTargetName] = useState('Twitch')
    const [newTargetUrl, setNewTargetUrl] = useState('rtmp://live.twitch.tv/app')
    const [newTargetKey, setNewTargetKey] = useState('')

    const wsRef = useRef<WebSocket | null>(null)

    const t = (key: keyof typeof translations['en']) => {
        return translations[lang][key] || key
    }

    useEffect(() => {
        const saved = localStorage.getItem('lang') as 'de' | 'en'
        if (saved && translations[saved]) setLang(saved)

        const cookieKey = Cookies.get('streamKey')
        if (cookieKey) {
            setIsAuthenticated(true)
            connectWs(cookieKey)
            fetchTargets()
            fetchVideos()
        } else {
            window.location.href = '/login'
        }

        const interval = setInterval(fetchStreamStats, 2000)
        return () => clearInterval(interval)
    }, [])

    const connectWs = (key: string) => {
        const host = window.location.hostname
        const ws = new WebSocket(`ws://${host}:3000?key=${key}`)
        ws.onopen = () => setWsConnected(true)
        ws.onclose = () => {
            setWsConnected(false)
            setTimeout(() => connectWs(key), 3000)
        }
        ws.onmessage = (e) => {
            const data = JSON.parse(e.data)
            if (data.type === 'STATE') {
                setState(data.payload)
            }
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

    const fetchStreamStats = async () => {
        try {
            const host = window.location.hostname
            const { data } = await axios.get(`http://${host}:8000/api/streams`)
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
        await axios.post('/api/targets', { name: newTargetName, url: newTargetUrl, key: newTargetKey })
        setNewTargetKey('')
        fetchTargets()
    }

    const handleToggleBroadcast = () => {
        if (wsRef.current && wsConnected) {
            wsRef.current.send(JSON.stringify({ type: state.broadcastActive ? 'STOP_BROADCAST' : 'START_BROADCAST' }))
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
            await axios.post('/api/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
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

    return (
        <div className="app-container">
            <header className="sticky-nav">
                <h1>ReStream Nexus</h1>
                <div className="flex-center gap-15">
                    <div className="status-badge">
                        <span>{t('system_status')}</span>
                        <span className={`status-dot ${wsConnected ? 'active' : 'danger'}`}></span>
                    </div>
                    <select
                        value={lang}
                        onChange={(e: any) => {
                            setLang(e.target.value)
                            localStorage.setItem('lang', e.target.value)
                        }}
                        className="btn p-04-10 text-xs lang-select-btn"
                        title="Language"
                    >
                        <option value="de">🇩🇪 DE</option>
                        <option value="en">🇬🇧 EN</option>
                    </select>
                    <button onClick={() => { Cookies.remove('streamKey'); window.location.href = '/login' }} className="btn btn-danger p-04-10 text-xs">{t('logout')}</button>
                </div>
            </header>

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
                                    <span>{t('streamkey')}</span> <span className="text-primary font-mono">{t('env_config')}</span>
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
                                        setNewTargetName(e.target.value)
                                        if (e.target.value === 'Twitch') setNewTargetUrl('rtmp://live.twitch.tv/app')
                                        else if (e.target.value === 'YouTube') setNewTargetUrl('rtmp://a.rtmp.youtube.com/live2')
                                        else if (e.target.value === 'Kick') setNewTargetUrl('rtmps://fa723fc1b171.global-contribute.live-video.net:443/app/')
                                        else setNewTargetUrl('')
                                    }}
                                    className="form-control" title="Plattform"
                                >
                                    <option value="Twitch">Twitch</option>
                                    <option value="YouTube">YouTube</option>
                                    <option value="Kick">Kick</option>
                                    <option value="Custom">{t('custom')}</option>
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
