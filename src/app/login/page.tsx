'use client'
import { useState } from 'react'
import axios from 'axios'
import Cookies from 'js-cookie'

export default function LoginPage() {
    const [key, setKey] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError('')
        try {
            // Validate key against a lightweight API endpoint
            await axios.get('/api/targets', { headers: { 'x-stream-key': key } })
            Cookies.set('streamKey', key, { expires: 30 })
            window.location.href = '/'
        } catch {
            setError('Ungültiger Stream-Key. Bitte erneut versuchen.')
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen flex-center">
            <div className="card" style={{ width: '100%', maxWidth: '400px' }}>
                <h1 className="login-title">ReStream Nexus</h1>
                <p className="text-muted text-sm mb-2">Bitte gib deinen Stream-Key ein, um fortzufahren.</p>

                <form onSubmit={handleLogin}>
                    <div className="form-group">
                        <label className="text-muted text-sm">Stream-Key</label>
                        <input
                            type="password"
                            value={key}
                            onChange={(e) => setKey(e.target.value)}
                            className="form-control"
                            placeholder="SerienSkylan_StreamKey"
                            required
                            autoFocus
                        />
                    </div>
                    {error && <p className="text-sm mb-1" style={{ color: 'var(--danger)' }}>{error}</p>}
                    <button type="submit" className="btn btn-primary w-full" disabled={loading}>
                        {loading ? 'Wird überprüft...' : 'Anmelden'}
                    </button>
                </form>
            </div>
        </div>
    )
}
